import { assertSupabaseBrowserEnv } from "@/lib/supabase/env";

export type SignedUploadProgress = {
  loaded: number;
  total: number;
  percent: number;
};

function signedUploadUrl(path: string, token: string) {
  const { url } = assertSupabaseBrowserEnv();
  const normalizedPath = path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${url}/storage/v1/object/upload/sign/media/${normalizedPath}?token=${encodeURIComponent(token)}`;
}

/**
 * Upload a server-authorized private media object while exposing the browser's
 * real byte progress.
 *
 * This intentionally mirrors Supabase Storage's browser File path: PUT to the
 * signed-upload endpoint with a multipart body containing cacheControl and the
 * File itself. XMLHttpRequest is used only because its upload progress event
 * exposes transferred bytes; authorization and object authority still come
 * from the server-minted signed upload token.
 */
export function uploadToSignedUrlWithProgress({
  path,
  token,
  file,
  upsert,
  onProgress
}: {
  path: string;
  token: string;
  file: File;
  contentType: string;
  upsert: boolean;
  onProgress?: (progress: SignedUploadProgress) => void;
}): Promise<void> {
  const { anonKey } = assertSupabaseBrowserEnv();

  // No single byte transfer should take longer than this to make ANY
  // progress. A flaky mobile connection can stall a PUT indefinitely with no
  // error and no progress event, which previously left the composer spinning
  // forever with nothing to retry. This watches for stalls, not slowness: it
  // resets on every real progress event, so a slow-but-moving upload of a
  // large video is never punished for taking a while.
  const STALL_TIMEOUT_MS = 20_000;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUploadUrl(path, token));
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("Authorization", `Bearer ${anonKey}`);
    xhr.setRequestHeader("x-upsert", String(upsert));

    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    function clearStallTimer() {
      if (stallTimer !== null) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    }
    function armStallTimer() {
      clearStallTimer();
      stallTimer = setTimeout(() => {
        if (settled) return;
        xhr.abort();
      }, STALL_TIMEOUT_MS);
    }
    function settle(action: () => void) {
      if (settled) return;
      settled = true;
      clearStallTimer();
      action();
    }

    // Do not set Content-Type manually: the browser must add the multipart
    // boundary. This is the same body shape Storage JS uses for File/Blob.
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);

    xhr.upload.addEventListener("loadstart", armStallTimer);
    xhr.upload.addEventListener("progress", (event) => {
      armStallTimer();
      const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
      const loaded = Math.min(event.loaded, total);
      const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
      onProgress?.({ loaded, total, percent });
    });

    xhr.addEventListener("load", () => {
      settle(() => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.({ loaded: file.size, total: file.size, percent: 100 });
          resolve();
          return;
        }
        reject(new Error(`Signed upload failed with status ${xhr.status}.`));
      });
    });
    xhr.addEventListener("error", () => settle(() => reject(new Error("Signed upload failed."))));
    xhr.addEventListener("abort", () => settle(() => reject(new Error("Signed upload stalled or was cancelled. Try again."))));
    xhr.send(body);
  });
}

/** Compatibility name used by the composer while the transport stays shared. */
export const uploadMediaToSignedUrlWithProgress = uploadToSignedUrlWithProgress;
