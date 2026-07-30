import sharp from "sharp";
import { deleteFile, fileExists, getObjectBuffer, renameFile, uploadBuffer } from "./s3";

const THUMB_PREFIX = "_thumbnails/";
const THUMB_WIDTH = 480;
const THUMB_QUALITY = 70;

const THUMBNAILABLE_MIME_PREFIXES = ["image/"];
const EXCLUDED_MIME_TYPES = new Set(["image/svg+xml", "image/gif"]);

export function getThumbnailKey(originalKey: string): string {
  return `${THUMB_PREFIX}${originalKey}.jpg`;
}

export function isThumbnailable(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  if (EXCLUDED_MIME_TYPES.has(mimeType)) return false;
  return THUMBNAILABLE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

export async function generateThumbnail(originalKey: string, mimeType: string): Promise<boolean> {
  if (!isThumbnailable(mimeType)) return false;
  try {
    const original = await getObjectBuffer(originalKey);
    const resized = await sharp(original)
      .rotate()
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY })
      .toBuffer();
    await uploadBuffer(getThumbnailKey(originalKey), resized, "image/jpeg");
    return true;
  } catch {
    return false;
  }
}

export async function deleteThumbnail(originalKey: string): Promise<void> {
  try {
    await deleteFile(getThumbnailKey(originalKey));
  } catch {
    // no thumbnail to delete
  }
}

export async function thumbnailExists(originalKey: string): Promise<boolean> {
  return fileExists(getThumbnailKey(originalKey));
}

export async function renameThumbnail(oldKey: string, newKey: string): Promise<void> {
  try {
    if (await thumbnailExists(oldKey)) {
      await renameFile(getThumbnailKey(oldKey), getThumbnailKey(newKey));
    }
  } catch {
    // no thumbnail to rename
  }
}
