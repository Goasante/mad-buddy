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

export type ImageKind = "jpg" | "png" | "webp" | "heic";
export type VideoKind = "mp4" | "webm" | "mov";
export type MediaFileKind = ImageKind | VideoKind;

export const MIME_BY_KIND: Record<ImageKind, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic"
};

const KIND_BY_MIME = new Map<string, ImageKind>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heic"]
]);

export const VIDEO_MIME_BY_KIND: Record<VideoKind, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime"
};

const VIDEO_KIND_BY_MIME = new Map<string, VideoKind>([
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/quicktime", "mov"]
]);

export function kindForMimeType(mimeType: string): ImageKind | null {
  return KIND_BY_MIME.get(mimeType) ?? null;
}

export function kindForVideoMimeType(mimeType: string): VideoKind | null {
  return VIDEO_KIND_BY_MIME.get(mimeType) ?? null;
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

  // HEIC/HEIF: ISO base media container with a HEIF-compatible brand.
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "heic";
  }

  return null;
}

/** Identifies the short-video containers accepted by Moments. */
export function sniffVideoKind(bytes: Uint8Array): VideoKind | null {
  // WebM/Matroska EBML header.
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "webm";
  }

  // MP4 and QuickTime both use ISO BMFF. The major brand distinguishes MOV.
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === "qt  ") return "mov";
    const normalized = brand.toLowerCase();
    if (
      normalized.startsWith("iso") ||
      normalized.startsWith("mp4") ||
      normalized === "avc1" ||
      normalized === "m4v " ||
      normalized === "dash"
    ) {
      return "mp4";
    }
  }

  return null;
}

// Size caps by context (spec §40).
export const MAX_UPLOAD_BYTES: Record<MediaContextType, number> = {
  // These contexts currently upload through Server Actions. The profile limit
  // leaves multipart headroom beneath the configured 6 MB request cap.
  profile: 5 * 1024 * 1024,
  moment: 3 * 1024 * 1024,
  drop: 15 * 1024 * 1024,
  event: 15 * 1024 * 1024,
  plan: 15 * 1024 * 1024,
  chat: 15 * 1024 * 1024
};

/** Short Moment clips stay beneath the configured 6 MB Server Action limit. */
export const MAX_MOMENT_VIDEO_UPLOAD_BYTES = 5 * 1024 * 1024;

export function maxUploadBytesFor(context: MediaContextType): number {
  return MAX_UPLOAD_BYTES[context] ?? MAX_UPLOAD_BYTES.moment;
}

/** Fast browser-side feedback before a file is sent to the server. */
export function validateImageSelection(
  file: { size: number; type: string; name?: string },
  context: MediaContextType
): string | null {
  if (file.size <= 0) return "Choose an image first.";
  const extension = file.name?.split(".").pop()?.toLowerCase();
  const extensionKind = extension === "jpg" || extension === "jpeg"
    ? "jpg"
    : extension === "png" || extension === "webp" || extension === "heic" || extension === "heif"
      ? extension === "heif" ? "heic" : extension
      : null;
  const kind = kindForMimeType(file.type) ?? extensionKind;
  if (!kind || (kind === "heic" && context !== "profile")) return "Upload a JPG, JPEG, PNG, WebP, or HEIC image.";

  const maximumBytes = maxUploadBytesFor(context);
  if (file.size > maximumBytes) {
    return `Use an image smaller than ${Math.floor(maximumBytes / (1024 * 1024))} MB.`;
  }

  return null;
}

/** Fast browser-side feedback for a Moment video before upload. */
export function validateVideoSelection(file: { size: number; type: string; name?: string }): string | null {
  if (file.size <= 0) return "Choose a video first.";
  const extension = file.name?.split(".").pop()?.toLowerCase();
  const extensionKind: VideoKind | null =
    extension === "mp4" || extension === "m4v"
      ? "mp4"
      : extension === "webm"
        ? "webm"
        : extension === "mov"
          ? "mov"
          : null;
  if (!kindForVideoMimeType(file.type) && !extensionKind) {
    return "Upload an MP4, WebM, or MOV video.";
  }
  if (file.size > MAX_MOMENT_VIDEO_UPLOAD_BYTES) {
    return "Use a video smaller than 5 MB.";
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

export type VideoUploadValidationResult =
  | { valid: true; kind: VideoKind; mimeType: string }
  | { valid: false; reason: "unsupported_type" | "too_large" | "empty" | "content_mismatch" };

/**
 * Validates an upload before it reaches storage. Checks type support, size,
 * then, critically, that the real bytes match the claimed type.
 */
export function validateImageUpload(input: UploadValidationInput): UploadValidationResult {
  if (input.sizeBytes <= 0) return { valid: false, reason: "empty" };

  const actualKind = sniffImageKind(input.headerBytes);
  const claimedKind = kindForMimeType(input.claimedMimeType);
  // Some iOS/browser combinations submit HEIC files without a MIME type. In
  // that narrow case, the verified magic bytes remain authoritative.
  const hasGenericMime = input.claimedMimeType === "" || input.claimedMimeType === "application/octet-stream";
  const effectiveKind = claimedKind ?? (hasGenericMime ? actualKind : null);
  if (!effectiveKind || (effectiveKind === "heic" && input.context !== "profile")) {
    return { valid: false, reason: "unsupported_type" };
  }

  if (input.sizeBytes > maxUploadBytesFor(input.context)) {
    return { valid: false, reason: "too_large" };
  }

  // A file whose bytes disagree with its claimed type is rejected outright,
  // this is what stops a script or polyglot arriving as "image/png".
  if (!actualKind || actualKind !== effectiveKind) {
    return { valid: false, reason: "content_mismatch" };
  }

  return { valid: true, kind: actualKind, mimeType: MIME_BY_KIND[actualKind] };
}

export function validateVideoUpload(
  input: Omit<UploadValidationInput, "context">
): VideoUploadValidationResult {
  if (input.sizeBytes <= 0) return { valid: false, reason: "empty" };
  if (input.sizeBytes > MAX_MOMENT_VIDEO_UPLOAD_BYTES) {
    return { valid: false, reason: "too_large" };
  }

  const actualKind = sniffVideoKind(input.headerBytes);
  const claimedKind = kindForVideoMimeType(input.claimedMimeType);
  const hasGenericMime =
    input.claimedMimeType === "" || input.claimedMimeType === "application/octet-stream";
  const effectiveKind = claimedKind ?? (hasGenericMime ? actualKind : null);
  if (!effectiveKind) return { valid: false, reason: "unsupported_type" };
  if (!actualKind || actualKind !== effectiveKind) {
    return { valid: false, reason: "content_mismatch" };
  }
  return { valid: true, kind: actualKind, mimeType: VIDEO_MIME_BY_KIND[actualKind] };
}

export function uploadValidationMessage(reason: Exclude<UploadValidationResult, { valid: true }>["reason"]): string {
  switch (reason) {
    case "unsupported_type":
      return "Upload a JPG, JPEG, PNG, WebP, or HEIC image.";
    case "too_large":
      return "That image is too large.";
    case "empty":
      return "Choose an image first.";
    case "content_mismatch":
      return "That file doesn't look like a supported JPG, PNG, WebP, or HEIC image.";
  }
}

export function videoUploadValidationMessage(
  reason: Exclude<VideoUploadValidationResult, { valid: true }>["reason"]
): string {
  switch (reason) {
    case "unsupported_type":
      return "Upload an MP4, WebM, or MOV video.";
    case "too_large":
      return "Use a video smaller than 5 MB.";
    case "empty":
      return "Choose a video first.";
    case "content_mismatch":
      return "That file doesn't look like a supported MP4, WebM, or MOV video.";
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
  kind: MediaFileKind;
}): string {
  // Owner id first: the storage RLS policy authorizes on the first path segment.
  return `${input.ownerId}/${input.context}/${input.mediaId}.${input.kind}`;
}
