import "server-only";

import sharp, { type Sharp } from "sharp";
import type { ImageKind } from "@/lib/media/validation";

/**
 * Image processing at upload time (batch 6 §39, §44). Two jobs:
 *
 * 1. EXIF stripping, privacy-critical. A phone photo carries GPS
 *    coordinates; the app's whole promise is that exact location never
 *    leaves the device. Re-encoding through sharp without `withMetadata()`
 *    drops every metadata block, so EXIF_KEYS_TO_STRIP is enforced by
 *    construction rather than by field-by-field filtering. `rotate()` first
 *    bakes in the EXIF orientation so stripping it doesn't sideways photos.
 *
 * 2. Variants, thumb (grid) and feed (timeline) sizes, so the full-size
 *    original isn't shipped for every card. `signMediaForAsset` already
 *    prefers a variant row when one exists.
 *
 * Processing happens before any byte reaches storage: the stored original
 * is itself the stripped re-encode, so no window exists where GPS data is
 * at rest.
 */

export const VARIANT_DIMENSIONS = {
  thumb: 256,
  feed: 1080
} as const;

export type ProcessedImage = {
  buffer: Buffer;
  width: number;
  height: number;
};

export type ProcessedUpload = {
  original: ProcessedImage;
  variants: { thumb: ProcessedImage; feed: ProcessedImage };
};

function encoderFor(kind: ImageKind) {
  return (pipeline: Sharp) =>
    kind === "png" ? pipeline.png() : kind === "webp" ? pipeline.webp() : pipeline.jpeg({ quality: 85 });
}

async function encode(input: Buffer, kind: ImageKind, maxDimension?: number): Promise<ProcessedImage> {
  let pipeline = sharp(input, { failOn: "error" }).rotate();
  if (maxDimension) {
    pipeline = pipeline.resize(maxDimension, maxDimension, { fit: "inside", withoutEnlargement: true });
  }
  const { data, info } = await encoderFor(kind)(pipeline).toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

/** Strips metadata and produces thumb/feed variants. Throws on undecodable bytes. */
export async function processImageUpload(input: Buffer, kind: ImageKind): Promise<ProcessedUpload> {
  const [original, thumb, feed] = await Promise.all([
    encode(input, kind),
    encode(input, kind, VARIANT_DIMENSIONS.thumb),
    encode(input, kind, VARIANT_DIMENSIONS.feed)
  ]);
  return { original, variants: { thumb, feed } };
}

/** Variant keys live beside the original: `<originalKey>` → `<stem>.thumb.<ext>`. */
export function variantStorageKey(originalKey: string, variant: "thumb" | "feed"): string {
  const dot = originalKey.lastIndexOf(".");
  return dot === -1
    ? `${originalKey}.${variant}`
    : `${originalKey.slice(0, dot)}.${variant}${originalKey.slice(dot)}`;
}
