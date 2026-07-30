/**
 * Browser-side image downscale and re-encode, run BEFORE upload.
 *
 * Why this exists: Moment uploads go through a Server Action, and the configured
 * `serverActions.bodySizeLimit` is 6 MB, so `MAX_UPLOAD_BYTES.moment` was set to
 * 3 MB to leave multipart headroom. A modern phone camera routinely produces
 * 4-12 MB, so a perfectly ordinary photo was rejected with "Use an image smaller
 * than 3 MB" and the user was expected to go and compress it themselves.
 *
 * The fix is to shrink the file rather than to raise the ceiling. The server cap
 * stays exactly where it is and remains authoritative; this only makes sure a
 * normal photo arrives under it.
 *
 * This is a PRE-pass, not a replacement for the server pipeline. The upload
 * action still re-encodes with sharp (which is what actually strips EXIF, since
 * a client can be bypassed) and still generates the thumb/feed variants. Drawing
 * through a canvas here happens to drop EXIF too, so no GPS survives even the
 * intermediate blob, but the server is the guarantee.
 */

/** Longest edge after downscale. Comfortably above the 1080px `feed` variant. */
export const CLIENT_MAX_DIMENSION = 1920;

/** Aim well under the server cap so multipart overhead can never tip it over. */
export const CLIENT_TARGET_BYTES = 1_600_000;

/**
 * A generous sanity bound on the SOURCE file, before any processing. Not a
 * quality limit: it exists so a pathological input (a RAW dump, a
 * mis-selected video) fails fast with a clear message instead of hanging the
 * main thread in a canvas decode.
 */
export const MAX_SOURCE_IMAGE_BYTES = 40 * 1024 * 1024;

export type CompressResult =
  | { ok: true; file: File; originalBytes: number; compressedBytes: number; skipped: boolean }
  | { ok: false; reason: string };

function canCompress(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof createImageBitmap === "function" &&
    typeof HTMLCanvasElement !== "undefined"
  );
}

function targetDimensions(width: number, height: number, limit: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= limit) return { width, height };
  const scale = limit / longest;
  // Round to whole pixels; a zero dimension would make toBlob fail.
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Downscales and re-encodes an image so it fits `targetBytes`.
 *
 * Returns `skipped: true` when the original is already small enough and needs no
 * processing, so a modest photo is uploaded byte-for-byte rather than being
 * needlessly re-encoded and softened.
 *
 * Transparency is preserved: a PNG stays PNG (which cannot be quality-tuned, so
 * only the downscale applies). Everything else re-encodes to JPEG, which is what
 * actually gets a large camera photo under the cap.
 */
export async function compressImageForUpload(
  file: File,
  options: { targetBytes?: number; maxDimension?: number } = {}
): Promise<CompressResult> {
  const targetBytes = options.targetBytes ?? CLIENT_TARGET_BYTES;
  const maxDimension = options.maxDimension ?? CLIENT_MAX_DIMENSION;

  if (file.size <= 0) return { ok: false, reason: "That image looks empty. Choose another one." };
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    return { ok: false, reason: "That image is unusually large. Choose another one." };
  }
  // Already small enough: send it untouched rather than re-encoding for nothing.
  if (file.size <= targetBytes) {
    return { ok: true, file, originalBytes: file.size, compressedBytes: file.size, skipped: true };
  }
  if (!canCompress()) {
    // No canvas path (very old browser). The server cap still applies, so the
    // caller surfaces a real error rather than uploading something too big.
    return { ok: false, reason: "This browser can't resize images. Try a smaller photo." };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, reason: "That image couldn't be read. Try another photo." };
  }

  try {
    const { width, height } = targetDimensions(bitmap.width, bitmap.height, maxDimension);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return { ok: false, reason: "Couldn't prepare that image. Try again." };
    context.drawImage(bitmap, 0, 0, width, height);

    const keepPng = file.type === "image/png";
    const mimeType = keepPng ? "image/png" : "image/jpeg";
    const extension = keepPng ? "png" : "jpg";

    // Step quality down until it fits. Stops at 0.5 so a photo never degrades
    // into something the user would not want to post.
    let best: Blob | null = null;
    for (const quality of keepPng ? [1] : [0.85, 0.75, 0.65, 0.55]) {
      const blob = await toBlob(canvas, mimeType, quality);
      if (!blob) continue;
      best = blob;
      if (blob.size <= targetBytes) break;
    }

    if (!best) return { ok: false, reason: "Couldn't compress that image. Try another photo." };

    const baseName = file.name.replace(/\.[^./\\]+$/, "") || "moment";
    return {
      ok: true,
      file: new File([best], `${baseName}.${extension}`, { type: mimeType, lastModified: Date.now() }),
      originalBytes: file.size,
      compressedBytes: best.size,
      skipped: false
    };
  } finally {
    // Free the decoded bitmap even if encoding threw.
    bitmap.close?.();
  }
}
