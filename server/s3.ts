import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./_core/env";

export function getClient(): S3Client {
  const config: ConstructorParameters<typeof S3Client>[0] = {
    region: ENV.s3Region,
    credentials: {
      accessKeyId: ENV.s3AccessKey,
      secretAccessKey: ENV.s3SecretKey,
    },
    // newer AWS SDK v3 versions default to adding a flexible checksum to requests
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };
  if (ENV.s3Endpoint) {
    config.endpoint = ENV.s3Endpoint.startsWith("https://")
      ? ENV.s3Endpoint
      : `https://${ENV.s3Endpoint}`;
    config.forcePathStyle = true;
  }
  return new S3Client(config);
}

export interface S3FileItem {
  key: string;
  filename: string;
  size: number;
  lastModified: Date;
  etag?: string;
}

export interface S3FolderItem {
  prefix: string;
  name: string;
}

export async function listFiles(prefix = "", maxKeys = 1000, continuationToken?: string) {
  const client = getClient();
  const cmd = new ListObjectsV2Command({
    Bucket: ENV.s3Bucket,
    Prefix: prefix,
    MaxKeys: maxKeys,
    ContinuationToken: continuationToken,
    // Group keys that share the same "folder" segment under commonprefixes
    // instead of flattening the whole subtree into Contents.
    Delimiter: "/",
  });
  const res = await client.send(cmd);
  const items: S3FileItem[] = (res.Contents ?? []).map((obj) => {
    const rawName = (obj.Key ?? "").split("/").pop() ?? obj.Key ?? "";
    const displayName = rawName.replace(/^[A-Za-z0-9_-]{6,14}-/, "");
    return {
      key: obj.Key ?? "",
      filename: displayName || rawName,
      size: obj.Size ?? 0,
      lastModified: obj.LastModified ?? new Date(),
      etag: obj.ETag?.replace(/"/g, ""),
    };
  });
  const folders: S3FolderItem[] = (res.CommonPrefixes ?? [])
    .map((cp) => cp.Prefix ?? "")
    .filter(Boolean)
    .map((p) => ({
      prefix: p,
      name: p.replace(prefix, "").replace(/\/$/, ""),
    }));
  return {
    items,
    folders,
    nextToken: res.NextContinuationToken,
    isTruncated: res.IsTruncated ?? false,
  };
}

/**
 * Lists every object key under a prefix
 */
export async function listAllKeysUnderPrefix(prefix: string): Promise<string[]> {
  const client = getClient();
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: ENV.s3Bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      })
    );
    (res.Contents ?? []).forEach((obj) => {
      if (obj.Key) keys.push(obj.Key);
    });
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);
  return keys;
}

export async function getUploadPresignedUrl(key: string, contentType: string, expiresIn = 3600) {
  const client = getClient();
  const cmd = new PutObjectCommand({
    Bucket: ENV.s3Bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, cmd, { expiresIn });
}

/**
 * Configures CORS on the bucket so browsers can put directly to presigned
 * upload URLs and get/head objects from the app's origins
 */
export async function configureBucketCors(allowedOrigins: string[]) {
  const client = getClient();
  const origins = allowedOrigins.length > 0 ? allowedOrigins : ["*"];
  await client.send(
    new PutBucketCorsCommand({
      Bucket: ENV.s3Bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: origins,
            AllowedMethods: ["GET", "PUT", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    })
  );
}

export async function getDownloadPresignedUrl(key: string, expiresIn = 3600) {
  const client = getClient();
  const cmd = new GetObjectCommand({
    Bucket: ENV.s3Bucket,
    Key: key,
  });
  return getSignedUrl(client, cmd, { expiresIn });
}

export async function deleteFile(key: string) {
  const client = getClient();
  const cmd = new DeleteObjectCommand({ Bucket: ENV.s3Bucket, Key: key });
  await client.send(cmd);
}

export async function headFile(key: string) {
  const client = getClient();
  const cmd = new HeadObjectCommand({ Bucket: ENV.s3Bucket, Key: key });
  return client.send(cmd);
}

export async function calculateBucketSize() {
  const client = getClient();
  let totalSize = 0;
  let fileCount = 0;
  let continuationToken: string | undefined;
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: ENV.s3Bucket,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    });
    const res = await client.send(cmd);
    (res.Contents ?? []).forEach((obj) => {
      totalSize += obj.Size ?? 0;
      fileCount++;
    });
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);
  return { totalSize, fileCount };
}

export async function renameFile(oldKey: string, newKey: string) {
  const client = getClient();
  const getCmd = new GetObjectCommand({ Bucket: ENV.s3Bucket, Key: oldKey });
  const obj = await client.send(getCmd);
  const putCmd = new PutObjectCommand({
    Bucket: ENV.s3Bucket,
    Key: newKey,
    Body: obj.Body,
    ContentType: obj.ContentType,
  });
  await client.send(putCmd);
  await deleteFile(oldKey);
}
