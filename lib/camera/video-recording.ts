import type { CameraFacingMode, LocalCameraVideo } from "@/lib/camera/types";
import { validateVideoSelection } from "@/lib/media/validation";

export const CAMERA_VIDEO_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4"
] as const;

export const MAX_CAMERA_VIDEO_SECONDS = 15;
export const MIN_CAMERA_VIDEO_BYTES = 1_024;
export const MIN_CAMERA_VIDEO_SECONDS = 0.35;

export function selectCameraVideoMime(
  isTypeSupported: ((mime: string) => boolean) | undefined
): string | null {
  if (!isTypeSupported) return null;
  return CAMERA_VIDEO_MIME_CANDIDATES.find((mime) => isTypeSupported(mime)) ?? null;
}

export function baseVideoMime(mime: string): "video/webm" | "video/mp4" | null {
  const base = mime.split(";", 1)[0]?.trim().toLowerCase();
  return base === "video/webm" || base === "video/mp4" ? base : null;
}

export function localVideoFromChunks(input: {
  chunks: Blob[];
  recorderMime: string;
  selectedMime: string;
  durationSeconds: number;
  width: number;
  height: number;
  facingMode: CameraFacingMode;
  createObjectUrl?: (blob: Blob) => string;
}): LocalCameraVideo {
  const mime = baseVideoMime(input.recorderMime) ?? baseVideoMime(input.selectedMime);
  if (!mime) throw new Error("recording_unsupported");
  const blob = new Blob(input.chunks, { type: mime });
  if (blob.size < MIN_CAMERA_VIDEO_BYTES || input.durationSeconds < MIN_CAMERA_VIDEO_SECONDS) {
    throw new Error("recording_failed");
  }

  const extension = mime === "video/mp4" ? "mp4" : "webm";
  const file = new File([blob], `mad-buddy-${Date.now()}.${extension}`, { type: mime });
  if (validateVideoSelection(file)) throw new Error("recording_too_large");

  return {
    kind: "video",
    source: "camera",
    blob,
    file,
    mime,
    width: Math.max(1, Math.round(input.width)),
    height: Math.max(1, Math.round(input.height)),
    durationSeconds: input.durationSeconds,
    mirrored: input.facingMode === "user",
    objectUrl: (input.createObjectUrl ?? URL.createObjectURL)(blob)
  };
}

export function cameraVideoError(error: unknown):
  | "microphone_denied"
  | "recording_unsupported"
  | "recording_failed"
  | "recording_too_large" {
  const name = typeof error === "object" && error && "name" in error ? String(error.name) : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "microphone_denied";
  if (name === "NotSupportedError" || message === "recording_unsupported") return "recording_unsupported";
  if (message === "recording_too_large") return "recording_too_large";
  return "recording_failed";
}
