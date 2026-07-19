import type { MediaContextType } from "@/lib/supabase/database.types";

/**
 * Media validation core (feature architecture batch 6, spec §37-§40). Pure and
 * deterministic so upload safety is unit-tested rather than trusted.
 *
 * The load-bearing rule (spec §39): the browser-reported MIME type is
 * attacker-controlled and is never trusted on its own. Every upload is checked
 * against the file's real magic bytes, and the two must agree.
 *
 * The magic-byte sniffer was previously inline in the avatar action; it lives
 * here now so avatars and Moment/Drop media share one audited implementation.
 */

export type ImageKind = "jpg" | "png" | "webp";

export const MIME_BY_KIND: Record<ImageKind, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

const KIND_BY_MIME = new Map<string, ImageKind>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

export function kindForMimeType(mimeType: string): ImageKind | null {
  return KIND_BY_MIME.get(mimeType) ?? null;
}

/**
 * Identifies an image by its real leading bytes. SVG is deliberately absent:
 * it is script-capable and unsafe to accept from untrusted users (spec §37).
 */
export function sniffImageKind(bytes: Uint8Array): ImageKind | null {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }

  // WebP: "RIFF" ....  "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }

  return null;
}

// Size caps by context (spec §40).
export const MAX_UPLOAD_BYTES: Record<MediaContextType, number> = {
  // These two contexts currently upload through Server Actions. Staying at
  // 3 MB leaves room for multipart metadata within the deployed request cap.
  profile: 3 * 1024 * 1024,
  moment: 3 * 1024 * 1024,
  drop: 15 * 1024 * 1024,
  event: 15 * 1024 * 1024,
  plan: 15 * 1024 * 1024,
  chat: 15 * 1024 * 1024
};

export function maxUploadBytesFor(context: MediaContextType): number {
  return MAX_UPLOAD_BYTES[context] ?? MAX_UPLOAD_BYTES.moment;
}

/** Fast browser-side feedback before a file is sent to the server. */
export function validateImageSelection(
  file: { size: number; type: string },
  context: MediaContextType
): string | null {
  if (file.size <= 0) return "Choose an image first.";
  if (!kindForMimeType(file.type)) return "Upload a PNG, JPG, or WebP image.";

  const maximumBytes = maxUploadBytesFor(context);
  if (file.size > maximumBytes) {
    return `Use an image smaller than ${Math.floor(maximumBytes / (1024 * 1024))} MB.`;
  }

  return null;
}

export type UploadValidationInput = {
  claimedMimeType: string;
  headerBytes: Uint8Array;
  sizeBytes: number;
  context: MediaContextType;
};

export type UploadValidationResult =
  | { valid: true; kind: ImageKind; mimeType: string }
  | { valid: false; reason: "unsupported_type" | "too_large" | "empty" | "content_mismatch" };

/**
 * Validates an upload before it reaches storage. Checks type support, size,
 * then, critically, that the real bytes match the claimed type.
 */
export function validateImageUpload(input: UploadValidationInput): UploadValidationResult {
  if (input.sizeBytes <= 0) return { valid: false, reason: "empty" };

  const claimedKind = kindForMimeType(input.claimedMimeType);
  if (!claimedKind) return { valid: false, reason: "unsupported_type" };

  if (input.sizeBytes > maxUploadBytesFor(input.context)) {
    return { valid: false, reason: "too_large" };
  }

  const actualKind = sniffImageKind(input.headerBytes);
  // A file whose bytes disagree with its claimed type is rejected outright,
  // this is what stops a script or polyglot arriving as "image/png".
  if (!actualKind || actualKind !== claimedKind) {
    return { valid: false, reason: "content_mismatch" };
  }

  return { valid: true, kind: actualKind, mimeType: MIME_BY_KIND[actualKind] };
}

export function uploadValidationMessage(reason: Exclude<UploadValidationResult, { valid: true }>["reason"]): string {
  switch (reason) {
    case "unsupported_type":
      return "Upload a PNG, JPG, or WebP image.";
    case "too_large":
      return "That image is too large.";
    case "empty":
      return "Choose an image first.";
    case "content_mismatch":
      return "That file doesn't look like a PNG, JPG, or WebP image.";
  }
}

// ---------------------------------------------------------------------------
// EXIF policy (spec §40)
// ---------------------------------------------------------------------------

/**
 * Metadata that must never survive an upload. GPS is the critical one: an
 * un-stripped photo would leak the exact coordinates the whole product refuses
 * to expose. Consumed by the processing step; listed here so the policy is
 * explicit and testable rather than implied.
 */
export const EXIF_KEYS_TO_STRIP = [
  "GPSLatitude",
  "GPSLongitude",
  "GPSAltitude",
  "GPSTimeStamp",
  "GPSDateStamp",
  "GPSPosition",
  "Make",
  "Model",
  "SerialNumber",
  "LensSerialNumber",
  "BodySerialNumber",
  "OwnerName",
  "CreateDate",
  "DateTimeOriginal"
] as const;

/** Only orientation is worth preserving, it is applied, then dropped. */
export const EXIF_KEYS_TO_APPLY_THEN_DROP = ["Orientation"] as const;

export function exifKeyMustBeStripped(key: string): boolean {
  return (
    (EXIF_KEYS_TO_STRIP as readonly string[]).includes(key) ||
    // Defence in depth: anything GPS-shaped goes, even if unlisted.
    /^gps/i.test(key)
  );
}

// Output variants (spec §40).
export const VARIANT_DIMENSIONS: Record<string, { width: number; height: number }[]> = {
  profile: [
    { width: 96, height: 96 },
    { width: 256, height: 256 },
    { width: 512, height: 512 }
  ]
};

export function storageKeyFor(input: {
  ownerId: string;
  context: MediaContextType;
  mediaId: string;
  kind: ImageKind;
}): string {
  // Owner id first: the storage RLS policy authorizes on the first path segment.
  return `${input.ownerId}/${input.context}/${input.mediaId}.${input.kind}`;
}
