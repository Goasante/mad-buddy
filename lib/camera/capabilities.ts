import type { CameraCapabilities } from "@/lib/camera/types";

export type CameraCapabilityRuntime = {
  secureContext: boolean;
  mediaDevices?: {
    getUserMedia?: MediaDevices["getUserMedia"];
    enumerateDevices?: MediaDevices["enumerateDevices"];
  };
  mediaRecorderAvailable: boolean;
};

function browserRuntime(): CameraCapabilityRuntime {
  const mediaDevices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  return {
    secureContext: typeof window !== "undefined" && window.isSecureContext,
    mediaDevices,
    mediaRecorderAvailable: typeof MediaRecorder !== "undefined"
  };
}

/** Capability detection only. This never requests camera permission. */
export async function detectCameraCapabilities(
  runtime: CameraCapabilityRuntime = browserRuntime()
): Promise<CameraCapabilities> {
  const hasMediaDevices = Boolean(runtime.mediaDevices);
  const hasGetUserMedia = typeof runtime.mediaDevices?.getUserMedia === "function";

  let videoInputCount = 0;
  if (runtime.secureContext && hasGetUserMedia && runtime.mediaDevices?.enumerateDevices) {
    try {
      const devices = await runtime.mediaDevices.enumerateDevices();
      videoInputCount = devices.filter((device) => device.kind === "videoinput").length;
    } catch {
      // Device enumeration is allowed to fail before permission. Starting the
      // stream remains the authoritative availability check.
    }
  }

  const limitation = !runtime.secureContext
    ? "insecure_context"
    : !hasMediaDevices || !hasGetUserMedia
      ? "unsupported"
      : videoInputCount === 0 && runtime.mediaDevices?.enumerateDevices
        ? "no_camera"
        : null;

  return {
    secureContext: runtime.secureContext,
    mediaDevices: hasMediaDevices,
    getUserMedia: hasGetUserMedia,
    videoInputCount,
    canFlip: videoInputCount > 1,
    mediaRecorder: runtime.mediaRecorderAvailable,
    limitation
  };
}

export function cameraFailureFromException(error: unknown): "permission_denied" | "camera_busy" | "no_camera" {
  const name = typeof error === "object" && error && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "permission_denied";
  if (name === "NotReadableError" || name === "AbortError") return "camera_busy";
  return "no_camera";
}

export function trackSupportsTorch(track: MediaStreamTrack): boolean {
  if (track.kind !== "video" || typeof track.getCapabilities !== "function") return false;
  const capabilities = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
  return capabilities.torch === true;
}
