import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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

export async function listFiles(prefix = "", maxKeys = 1000, continuationToken?: string) {
  const client = getClient();
  const cmd = new ListObjectsV2Command({
    Bucket: ENV.s3Bucket,
    Prefix: prefix,
    MaxKeys: maxKeys,
    ContinuationToken: continuationToken,
  });
  const res = await client.send(cmd);
  const items: S3FileItem[] = (res.Contents ?? []).map((obj) => ({
    key: obj.Key ?? "",
    filename: (obj.Key ?? "").split("/").pop() ?? obj.Key ?? "",
    size: obj.Size ?? 0,
    lastModified: obj.LastModified ?? new Date(),
    etag: obj.ETag?.replace(/"/g, ""),
  }));
  return {
    items,
    nextToken: res.NextContinuationToken,
    isTruncated: res.IsTruncated ?? false,
  };
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
