import { ENV } from "../_core/env";
import { getClient } from "../s3";
import { calculateBucketSize, renameFile } from "../s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import {
  deleteFileMetadata,
  getFileMetadata,
  getTopAccessedFiles,
  incrementAccessCount,
  listFilesMetadata,
  markWorkerTracked,
  upsertFileMetadata,
} from "../db";
import { deleteFile, getDownloadPresignedUrl, getUploadPresignedUrl, listFiles } from "../s3";
import { notifyWorker } from "../worker";

export const filesRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional().default(""),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(1).max(100).optional().default(20),
        prefix: z.string().optional().default(""),
      })
    )
    .query(async ({ input }) => {
      const isSearching = input.search.trim().length > 0;
      // A search looks across the whole bucket; plain browsing is scoped
      // to the current folder (prefix).
      const s3Prefix = isSearching ? "" : input.prefix;

      const [s3Result, dbResult] = await Promise.all([
        listFiles(s3Prefix, 1000),
        listFilesMetadata(input.prefix, input.search, input.page, input.pageSize),
      ]);

      // merge s3 data with db metadata
      const s3Map = new Map(s3Result.items.map((f) => [f.key, f]));
      const enriched = dbResult.items.map((meta) => {
        const s3 = s3Map.get(meta.s3Key);
        return {
          ...meta,
          lastModified: s3?.lastModified ?? meta.uploadedAt,
          etag: s3?.etag,
          existsInS3: s3Map.has(meta.s3Key),
        };
      });

      // include s3 files not yet in db
      const dbKeys = new Set(dbResult.items.map((m) => m.s3Key));
      const s3Only = s3Result.items
        .filter((f) => !dbKeys.has(f.key))
        .filter((f) => !input.search || f.filename.toLowerCase().includes(input.search.toLowerCase()))
        .map((f) => ({
          id: -1,
          s3Key: f.key,
          filename: f.filename,
          size: f.size,
          mimeType: null,
          uploadedBy: null,
          uploadedAt: f.lastModified,
          lastAccessed: null,
          accessCount: 0,
          workerTracked: false,
          lastModified: f.lastModified,
          etag: f.etag,
          existsInS3: true,
        }));

      const allItems = [...enriched, ...s3Only];
      return {
        items: allItems,
        total: dbResult.total + s3Only.length,
        page: input.page,
        pageSize: input.pageSize,
        // Subfolders of the current prefix. Empty while searching, since a
        // search flattens results across the whole bucket.
        folders: isSearching ? [] : s3Result.folders,
        prefix: input.prefix,
      };
    }),

  getUploadUrl: protectedProcedure
    .input(
      z.object({
        filename: z.string().min(1).max(512),
        contentType: z.string().min(1).max(256),
        folder: z.string().optional().default(""),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ext = input.filename.includes(".") ? input.filename.split(".").pop() : "";
      const uniqueKey = input.folder
        ? `${input.folder}/${nanoid()}.${ext}`
        : `${nanoid()}.${ext}`;
      // The browser PUTs directly to S3 using this presigned URL. This keeps
      // large file uploads off the serverless function entirely (Vercel
      // functions have a hard 4.5MB request body limit and bill for
      // duration/bandwidth). CORS errors here mean the bucket's CORS policy
      // needs to allow PUT from this app's origin — see scripts/configure-s3-cors.ts.
      const url = await getUploadPresignedUrl(uniqueKey, input.contentType);
      await upsertFileMetadata({
        s3Key: uniqueKey,
        filename: input.filename,
        size: 0,
        mimeType: input.contentType,
        uploadedBy: ctx.user.id,
        uploadedAt: new Date(),
      });
      await notifyWorker({
        key: uniqueKey,
        filename: input.filename,
        action: "upload",
        userId: ctx.user.id,
        timestamp: new Date().toISOString(),
      });
      return { uploadUrl: url, key: uniqueKey };
    }),

  confirmUpload: protectedProcedure
    .input(z.object({ key: z.string(), size: z.number().int().min(0) }))
    .mutation(async ({ input }) => {
      const db_meta = await getFileMetadata(input.key);
      if (db_meta) {
        await upsertFileMetadata({ ...db_meta, size: input.size });
      }
      return { ok: true };
    }),

  getDownloadUrl: protectedProcedure
    .input(z.object({ key: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const url = await getDownloadPresignedUrl(input.key);
      await incrementAccessCount(input.key);
      await notifyWorker({
        key: input.key,
        filename: input.key.split("/").pop() ?? input.key,
        action: "download",
        userId: ctx.user.id,
        timestamp: new Date().toISOString(),
      });
      return { downloadUrl: url };
    }),

  delete: protectedProcedure
    .input(z.object({ key: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      await deleteFile(input.key);
      await deleteFileMetadata(input.key);
      await notifyWorker({
        key: input.key,
        filename: input.key.split("/").pop() ?? input.key,
        action: "delete",
        userId: ctx.user.id,
        timestamp: new Date().toISOString(),
      });
      return { ok: true };
    }),

  deleteMany: protectedProcedure
    .input(z.object({ keys: z.array(z.string().min(1)).min(1).max(500) }))
    .mutation(async ({ input, ctx }) => {
      const results = await Promise.allSettled(
        input.keys.map(async (key) => {
          await deleteFile(key);
          await deleteFileMetadata(key);
          await notifyWorker({
            key,
            filename: key.split("/").pop() ?? key,
            action: "delete",
            userId: ctx.user.id,
            timestamp: new Date().toISOString(),
          });
        })
      );
      const deleted = results.filter((r) => r.status === "fulfilled").length;
      const failed = input.keys.filter((_, i) => results[i].status === "rejected");
      return { deleted, failed };
    }),

  workerStatus: publicProcedure.query(() => {
    return { enabled: Boolean(ENV.workerUrl), url: ENV.workerUrl ? "configured" : null };
  }),

  mkdir: protectedProcedure
    .input(z.object({ folderName: z.string().min(1).max(256), prefix: z.string().optional().default("") }))
    .mutation(async ({ input }) => {
      const safeName = input.folderName.trim().replace(/\/+/g, "");
      if (!safeName) {
        throw new Error("Nome cartella non valido");
      }
      const key = `${input.prefix}${safeName}/.gitkeep`;
      const client = getClient();
      await client.send(new PutObjectCommand({
        Bucket: ENV.s3Bucket,
        Key: key,
        Body: Buffer.from(""),
      }));
      await upsertFileMetadata({
        s3Key: key,
        filename: ".gitkeep",
        size: 0,
        mimeType: "application/octet-stream",
        uploadedBy: null,
        uploadedAt: new Date(),
      });
      return { ok: true, key };
    }),

  rename: protectedProcedure
    .input(z.object({ oldKey: z.string().min(1), newName: z.string().min(1).max(512) }))
    .mutation(async ({ input, ctx }) => {
      const newKey = input.oldKey.includes("/")
        ? input.oldKey.split("/").slice(0, -1).join("/") + "/" + input.newName
        : input.newName;
      await renameFile(input.oldKey, newKey);
      await deleteFileMetadata(input.oldKey);
      await upsertFileMetadata({
        s3Key: newKey,
        filename: input.newName,
        size: 0,
        mimeType: null,
        uploadedBy: ctx.user.id,
        uploadedAt: new Date(),
      });
      await notifyWorker({
        key: newKey,
        filename: input.newName,
        action: "download",
        userId: ctx.user.id,
        timestamp: new Date().toISOString(),
      });
      return { ok: true, newKey };
    }),

  storageStats: protectedProcedure.query(async () => {
    const { totalSize, fileCount } = await calculateBucketSize();
    return {
      totalSize,
      fileCount,
      totalSizeGB: (totalSize / (1024 * 1024 * 1024)).toFixed(2),
    };
  }),

  topAccessed: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).optional().default(10) }))
    .query(async ({ input }) => {
      return getTopAccessedFiles(input.limit);
    }),

  settings: publicProcedure.query(() => {
    return {
      bucket: ENV.s3Bucket,
      region: ENV.s3Region,
      endpoint: ENV.s3Endpoint,
      workerUrl: ENV.workerUrl ? "configured" : null,
    };
  }),
});
