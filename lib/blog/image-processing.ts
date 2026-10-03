import "server-only";
import sharp from "sharp";
import { sniffImageKind } from "@/lib/media/validation";
import { JOURNAL_IMAGE_MAX_BYTES, JOURNAL_IMAGE_UPLOAD_MAX_BYTES } from "./image-model";

// One stored JPEG, suitable for the article and Open Graph preview alike.
// Re-encoding discards metadata/GPS; no camera-size original is retained.
export async function optimizeJournalImage(input: Buffer) {
  if (!input.length || input.length > JOURNAL_IMAGE_UPLOAD_MAX_BYTES) throw new Error("Choose an image smaller than 5 MB.");
  const kind = sniffImageKind(input.subarray(0, 32));
  if (!kind || kind === "heic") throw new Error("Choose a JPEG, PNG, or WebP image.");
  const metadata = await sharp(input, { limitInputPixels: 24_000_000, failOn: "error" }).metadata();
  if ((metadata.pages ?? 1) > 1) throw new Error("Choose a still image rather than an animation.");
  for (const [width, height, quality] of [[1600, 1200, 80], [1400, 1050, 72], [1200, 900, 65], [1000, 750, 58], [800, 600, 50], [640, 480, 45]]) {
    const { data, info } = await sharp(input, { limitInputPixels: 24_000_000, failOn: "error" })
      .rotate().resize(width, height, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (data.length <= JOURNAL_IMAGE_MAX_BYTES) return { buffer: data, width: info.width, height: info.height, bytes: data.length };
  }
  throw new Error("That image could not be reduced to 200 KB. Choose a simpler image.");
}
