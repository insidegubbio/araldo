import sharp from "sharp";
const OPTIMIZABLE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif", "tiff", "tif", "bmp"]);

export function isOptimizableImageKey(key: string): boolean {
  if (key.startsWith("_thumbnails/")) return false;
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return OPTIMIZABLE_EXTENSIONS.has(ext);
}

export interface OptimizeResult {
  buffer: Buffer;
  contentType: string;
  extension: string;
}

export async function optimizeImageBuffer(
  original: Buffer,
  originalExt: string,
  opts: { maxWidth: number; quality: number; convertToWebp: boolean }
): Promise<OptimizeResult> {
  const img = sharp(original).rotate();
  const metadata = await img.metadata();

  let pipeline = img;
  if (metadata.width && metadata.width > opts.maxWidth) {
    pipeline = pipeline.resize({ width: opts.maxWidth, withoutEnlargement: true });
  }

  const ext = originalExt.toLowerCase();

  if (opts.convertToWebp) {
    const buffer = await pipeline.webp({ quality: opts.quality }).toBuffer();
    return { buffer, contentType: "image/webp", extension: "webp" };
  }

  if (ext === "png") {
    const buffer = await pipeline.png({ quality: opts.quality, compressionLevel: 9 }).toBuffer();
    return { buffer, contentType: "image/png", extension: "png" };
  }

  const buffer = await pipeline.jpeg({ quality: opts.quality, mozjpeg: true }).toBuffer();
  return { buffer, contentType: "image/jpeg", extension: "jpg" };
}
