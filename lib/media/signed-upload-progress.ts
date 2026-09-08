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
 * real byte progress. Supabase's uploadToSignedUrl hides the XHR upload event;
 * this transport keeps the same signed-storage boundary while reporting bytes
 * actually transferred.
 */
export function uploadMediaToSignedUrlWithProgress({
  path,
  token,
  file,
  contentType,
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

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUploadUrl(path, token));
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("Authorization", `Bearer ${anonKey}`);
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", String(upsert));

    xhr.upload.addEventListener("progress", (event) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
      const loaded = Math.min(event.loaded, total);
      const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
      onProgress?.({ loaded, total, percent });
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.({ loaded: file.size, total: file.size, percent: 100 });
        resolve();
        return;
      }
      reject(new Error(`Signed upload failed with status ${xhr.status}.`));
    });
    xhr.addEventListener("error", () => reject(new Error("Signed upload failed.")));
    xhr.addEventListener("abort", () => reject(new Error("Signed upload was cancelled.")));
    xhr.send(file);
  });
}
