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

/**
 * Returns a tightly sized ArrayBuffer for Storage uploads.
 *
 * Node Buffers are Uint8Array views and may reference a larger pooled backing
 * buffer. More importantly, some server runtimes/fetch adapters can coerce a
 * Buffer body through text encoding. Copying into a real ArrayBuffer keeps the
 * request body binary and prevents image signatures from becoming U+FFFD
 * replacement bytes in Storage.
 */
export function toStorageArrayBuffer(input: Uint8Array): ArrayBuffer {
  return Uint8Array.from(input).buffer;
}

export const PROFILE_AVATAR_DIMENSION = 512;
export const PROFILE_AVATAR_TARGET_MIN_BYTES = 150 * 1024;
export const PROFILE_AVATAR_TARGET_MAX_BYTES = 250 * 1024;

function encoderFor(kind: ImageKind) {
  return (pipeline: Sharp) =>
    kind === "png" ? pipeline.png() : kind === "webp" || kind === "heic" ? pipeline.webp({ quality: 84 }) : pipeline.jpeg({ quality: 85 });
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

async function encodeProfileAvatar(input: Buffer, quality: number): Promise<Buffer> {
  return sharp(input, { failOn: "error" })
    .rotate()
    .resize(PROFILE_AVATAR_DIMENSION, PROFILE_AVATAR_DIMENSION, {
      fit: "cover",
      // Sharp's attention strategy favours salient regions and skin tones. It
      // behaves like a face-aware crop when possible and gracefully falls back
      // to the visual centre when no face is detectable.
      position: sharp.strategy.attention
    })
    .webp({ quality, effort: 5, smartSubsample: true })
    .toBuffer();
}

/**
 * Produces the single canonical profile image stored by Mad Buddy: a square,
 * metadata-free 512px WebP. The quality ladder aims for 150-250 KB without
 * padding naturally small images or keeping an oversized upload.
 */
export async function optimizeProfileAvatar(input: Buffer): Promise<Buffer> {
  let output = await encodeProfileAvatar(input, 84);

  if (output.length > PROFILE_AVATAR_TARGET_MAX_BYTES) {
    for (const quality of [80, 76, 72, 68, 64, 60, 56, 52]) {
      output = await encodeProfileAvatar(input, quality);
      if (output.length <= PROFILE_AVATAR_TARGET_MAX_BYTES) break;
    }
  } else if (output.length < PROFILE_AVATAR_TARGET_MIN_BYTES) {
    // Flat illustrations often compress far below the target. Prefer a little
    // more detail when it still stays within the upper storage target.
    for (const quality of [90, 94]) {
      const candidate = await encodeProfileAvatar(input, quality);
      if (candidate.length <= PROFILE_AVATAR_TARGET_MAX_BYTES) output = candidate;
    }
  }

  return output;
}

/** Variant keys live beside the original: `<originalKey>` → `<stem>.thumb.<ext>`. */
export function variantStorageKey(originalKey: string, variant: "thumb" | "feed"): string {
  const dot = originalKey.lastIndexOf(".");
  return dot === -1
    ? `${originalKey}.${variant}`
    : `${originalKey.slice(0, dot)}.${variant}${originalKey.slice(dot)}`;
}
