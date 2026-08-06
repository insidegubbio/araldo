import { ENV } from "../_core/env";
import { getClient } from "../s3";
import { calculateBucketSize, renameFile } from "../s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { TRPCError } from "@trpc/server";
import { APP_VERSION } from "../version";
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
import {
  deleteFile,
  getDownloadPresignedUrl,
  getUploadPresignedUrl,
  listFiles,
  configureBucketCors,
  listAllKeysUnderPrefix,
  getObjectBuffer,
  uploadBuffer,
} from "../s3";
import { notifyWorker } from "../worker";
import { generateThumbnail, getThumbnailKey, isThumbnailable, thumbnailExists, deleteThumbnail } from "../thumbinails";
import { isOptimizableImageKey, optimizeImageBuffer } from "../imageOptimize";

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
      // A search looks across the whole bucket; plain browsing is scoped to the current folder.
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

      const dbKeys = new Set(dbResult.items.map((m) => m.s3Key));

      const extMimeMap: Record<string, string> = {
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
        gif: "image/gif", webp: "image/webp", heic: "image/heic",
        heif: "image/heif", mp4: "video/mp4", mov: "video/quicktime",
      };
      
      const s3Only = s3Result.items
        .filter((f) => !dbKeys.has(f.key))
        .filter((f) => !input.search || f.filename.toLowerCase().includes(input.search.toLowerCase()))
        .map((f) => {
          const ext = f.filename.split(".").pop()?.toLowerCase() ?? "";
          return {
            id: -1,
            s3Key: f.key,
            filename: f.filename,
            size: f.size,
            mimeType: extMimeMap[ext] ?? null,
            uploadedBy: null,
            uploadedAt: f.lastModified,
            lastAccessed: null,
            accessCount: 0,
            workerTracked: false,
            lastModified: f.lastModified,
            etag: f.etag,
            existsInS3: true,
          };
        });

      const allItems = [...enriched, ...s3Only];
      return {
        items: allItems,
        total: dbResult.total + s3Only.length,
        page: input.page,
        pageSize: input.pageSize,
        // Subfolders of the current prefix
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
      //keep the original filename readable in the S3 key itself
      const safeName = input.filename
        .normalize("NFKD")
        .replace(/[^\w.\- ]/g, "_")
        .replace(/^\.+/, "")
        .trim()
        .slice(0, 200) || `file_${Date.now()}`;
      const uniqueKey = input.folder
        ? `${input.folder}/${safeName}`
        : `${safeName}`;
      // browser PUTs directly to S3 using this presigned url
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
      if (db_meta?.mimeType && isThumbnailable(db_meta.mimeType)) {
        generateThumbnail(input.key, db_meta.mimeType).catch(() => {});
      }
      return { ok: true };
    }),
  
  getUploadUrls: protectedProcedure
    .input(z.object({
      files: z.array(z.object({
        filename: z.string(),
        contentType: z.string(),
      })).max(50),
      folder: z.string().optional().default(""),
    }))
    .mutation(async ({ input, ctx }) => {
      const results = await Promise.all(input.files.map(async (f) => {
        const safeName = f.filename.normalize("NFKD")
          .replace(/[^\w.\- ]/g, "_").trim().slice(0, 200) || `file_${Date.now()}`;
        const key = input.folder ? `${input.folder}/${Date.now()}-${safeName}` : `${Date.now()}-${safeName}`;
        const url = await getUploadPresignedUrl(key, f.contentType);
        await upsertFileMetadata({ s3Key: key, filename: f.filename, size: 0,
          mimeType: f.contentType, uploadedBy: ctx.user.id, uploadedAt: new Date() });
        return { uploadUrl: url, key };
      }));
      return results;
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

  getThumbnailUrl: protectedProcedure
    .input(z.object({ key: z.string().min(1), mimeType: z.string().nullable() }))
    .mutation(async ({ input }) => {
      if (isThumbnailable(input.mimeType) && (await thumbnailExists(input.key))) {
        const url = await getDownloadPresignedUrl(getThumbnailKey(input.key));
        return { downloadUrl: url };
      }
      // No thumbnail yet
      if (isThumbnailable(input.mimeType)) {
        generateThumbnail(input.key, input.mimeType!).catch(() => {});
      }
      const url = await getDownloadPresignedUrl(input.key);
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

  configureCors: protectedProcedure.mutation(async () => {
    if (!ENV.s3Bucket) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "S3_BUCKET non è configurato" });
    }
    const origins = ENV.corsAllowedOrigins.length > 0 ? ENV.corsAllowedOrigins : ["*"];
    await configureBucketCors(origins);
    return { origins };
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
      const safeName = input.newName
        .normalize("NFKD")
        .replace(/[^\w.\- ]/g, "_")
        .replace(/^\.+/, "")
        .trim()
        .slice(0, 200) || `file_${Date.now()}`;

      const oldBasename = input.oldKey.split("/").pop() ?? "";
      const oldExt = oldBasename.includes(".") ? "." + oldBasename.split(".").pop() : "";
      const newExt = safeName.includes(".") ? "" : oldExt;
      const finalName = safeName + newExt;

      const prefix = input.oldKey.includes("/")
        ? input.oldKey.split("/").slice(0, -1).join("/") + "/"
        : "";
      const newKey = prefix + finalName;

      if (newKey === input.oldKey) {
        return { ok: true, newKey };
      }

      const oldMeta = await getFileMetadata(input.oldKey);
      await renameFile(input.oldKey, newKey);
      await deleteFileMetadata(input.oldKey);
      await upsertFileMetadata({
        s3Key: newKey,
        filename: finalName,
        size: oldMeta?.size ?? 0,
        mimeType: oldMeta?.mimeType ?? null,
        uploadedBy: oldMeta?.uploadedBy ?? ctx.user.id,
        uploadedAt: oldMeta?.uploadedAt ?? new Date(),
      });
      await notifyWorker({
        key: newKey,
        filename: finalName,
        action: "upload",
        userId: ctx.user.id,
        timestamp: new Date().toISOString(),
      });
      return { ok: true, newKey };
    }),

  listFolders: protectedProcedure
    .input(z.object({ prefix: z.string().optional().default("") }))
    .query(async ({ input }) => {
      const result = await listFiles(input.prefix, 1000);
      return { prefix: input.prefix, folders: result.folders };
    }),

  moveMany: protectedProcedure
    .input(
      z.object({
        keys: z.array(z.string().min(1)).min(1).max(500),
        destinationPrefix: z.string().optional().default(""),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const dest =
        input.destinationPrefix && !input.destinationPrefix.endsWith("/")
          ? `${input.destinationPrefix}/`
          : input.destinationPrefix;

      const results = await Promise.allSettled(
        input.keys.map(async (oldKey) => {
          const basename = oldKey.split("/").pop() ?? oldKey;
          const newKey = `${dest}${basename}`;
          if (newKey === oldKey) return;
          const oldMeta = await getFileMetadata(oldKey);
          await renameFile(oldKey, newKey);
          await deleteFileMetadata(oldKey);
          await upsertFileMetadata({
            s3Key: newKey,
            filename: oldMeta?.filename ?? basename,
            size: oldMeta?.size ?? 0,
            mimeType: oldMeta?.mimeType ?? null,
            uploadedBy: oldMeta?.uploadedBy ?? ctx.user.id,
            uploadedAt: oldMeta?.uploadedAt ?? new Date(),
          });
          await notifyWorker({
            key: newKey,
            filename: basename,
            action: "upload",
            userId: ctx.user.id,
            timestamp: new Date().toISOString(),
          });
        })
      );
      const moved = results.filter((r) => r.status === "fulfilled").length;
      const failed = input.keys.filter((_, i) => results[i].status === "rejected");
      return { moved, failed };
    }),

  deleteFolder: protectedProcedure
    .input(z.object({ prefix: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const normalizedPrefix = input.prefix.endsWith("/") ? input.prefix : `${input.prefix}/`;
      const keys = await listAllKeysUnderPrefix(normalizedPrefix);
      await Promise.allSettled(
        keys.map(async (key) => {
          await deleteFile(key);
          await deleteFileMetadata(key);
        })
      );
      await notifyWorker({
        key: normalizedPrefix,
        filename: normalizedPrefix.replace(/\/$/, "").split("/").pop() ?? normalizedPrefix,
        action: "delete",
        userId: ctx.user.id,
        timestamp: new Date().toISOString(),
      });
      return { ok: true, deleted: keys.length };
    }),

  renameFolder: protectedProcedure
    .input(z.object({ oldPrefix: z.string().min(1), newName: z.string().min(1).max(256) }))
    .mutation(async ({ input, ctx }) => {
      const safeName = input.newName.trim().replace(/\/+/g, "");
      if (!safeName) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Nome cartella non valido" });
      }
      const normalizedOld = input.oldPrefix.endsWith("/") ? input.oldPrefix : `${input.oldPrefix}/`;
      const parent = normalizedOld.split("/").slice(0, -2).join("/");
      const normalizedNew = parent ? `${parent}/${safeName}/` : `${safeName}/`;

      if (normalizedNew === normalizedOld) {
        return { ok: true, newPrefix: normalizedNew };
      }

      const keys = await listAllKeysUnderPrefix(normalizedOld);
      for (const oldKey of keys) {
        const newKey = normalizedNew + oldKey.slice(normalizedOld.length);
        const oldMeta = await getFileMetadata(oldKey);
        await renameFile(oldKey, newKey);
        await deleteFileMetadata(oldKey);
        await upsertFileMetadata({
          s3Key: newKey,
          filename: oldMeta?.filename ?? newKey.split("/").pop() ?? newKey,
          size: oldMeta?.size ?? 0,
          mimeType: oldMeta?.mimeType ?? null,
          uploadedBy: oldMeta?.uploadedBy ?? ctx.user.id,
          uploadedAt: oldMeta?.uploadedAt ?? new Date(),
        });
      }
      await notifyWorker({
        key: normalizedNew,
        filename: safeName,
        action: "upload",
        userId: ctx.user.id,
        timestamp: new Date().toISOString(),
      });
      return { ok: true, newPrefix: normalizedNew };
    }),

  optimizeImages: protectedProcedure
    .input(
      z.object({
        prefix: z.string().optional().default(""),
        maxWidth: z.number().int().min(200).max(4000).optional().default(1920),
        quality: z.number().int().min(1).max(100).optional().default(80),
        convertToWebp: z.boolean().optional().default(true),
        batchSize: z.number().int().min(1).max(100).optional().default(40),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const normalizedPrefix =
        input.prefix && !input.prefix.endsWith("/") ? `${input.prefix}/` : input.prefix;

      const allKeys = await listAllKeysUnderPrefix(normalizedPrefix);
      const imageKeys = allKeys.filter(isOptimizableImageKey);
      const batch = imageKeys.slice(0, input.batchSize);

      let processed = 0;
      let skipped = 0;
      let originalBytes = 0;
      let newBytes = 0;
      const failed: string[] = [];

      for (const key of batch) {
        try {
          const original = await getObjectBuffer(key);
          const originalSize = original.byteLength;
          const ext = key.split(".").pop()?.toLowerCase() ?? "jpg";

          const { buffer, contentType, extension } = await optimizeImageBuffer(original, ext, {
            maxWidth: input.maxWidth,
            quality: input.quality,
            convertToWebp: input.convertToWebp,
          });

          if (buffer.byteLength >= originalSize) {
            skipped++;
            continue;
          }

          const changedFormat = extension !== ext;
          const newKey = changedFormat ? key.replace(/\.[^./]+$/, `.${extension}`) : key;

          await uploadBuffer(newKey, buffer, contentType);
          if (changedFormat) {
            await deleteFile(key);
            await deleteThumbnail(key);
          }

          const oldMeta = await getFileMetadata(key);
          await deleteFileMetadata(key);
          const newFilename = changedFormat
            ? (oldMeta?.filename ?? newKey.split("/").pop() ?? newKey).replace(/\.[^./]+$/, `.${extension}`)
            : oldMeta?.filename ?? newKey.split("/").pop() ?? newKey;

          await upsertFileMetadata({
            s3Key: newKey,
            filename: newFilename,
            size: buffer.byteLength,
            mimeType: contentType,
            uploadedBy: oldMeta?.uploadedBy ?? ctx.user.id,
            uploadedAt: oldMeta?.uploadedAt ?? new Date(),
          });
          
          generateThumbnail(newKey, contentType).catch(() => {});

          originalBytes += originalSize;
          newBytes += buffer.byteLength;
          processed++;
        } catch {
          failed.push(key);
        }
      }

      const remaining = imageKeys.length - batch.length;
      return {
        processed,
        skipped,
        failed: failed.length,
        originalBytes,
        newBytes,
        savedBytes: originalBytes - newBytes,
        remaining: Math.max(0, remaining),
        hasMore: remaining > 0,
        totalImagesFound: imageKeys.length,
      };
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
      workerUrl: ENV.workerUrl || null,
      version: APP_VERSION,
    };
  }),
});
