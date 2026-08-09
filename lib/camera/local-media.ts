import type { CameraFacingMode, LocalCameraImage } from "@/lib/camera/types";
import { validateImageSource } from "@/lib/media/validation";

const MAX_CAPTURE_EDGE = 1920;
const MAX_LIBRARY_SOURCE_BYTES = 25 * 1024 * 1024;

function fittedDimensions(width: number, height: number) {
  const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("capture_failed"))), "image/jpeg", 0.9);
  });
}

/** Captures the currently rendered frame without uploading or persisting it. */
export async function captureVideoFrame(
  video: HTMLVideoElement,
  facingMode: CameraFacingMode,
  createObjectUrl: (blob: Blob) => string = URL.createObjectURL
): Promise<LocalCameraImage> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new Error("capture_failed");
  }

  const dimensions = fittedDimensions(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("capture_failed");

  // The front preview is mirrored. Mirror the saved local frame as well so
  // review matches what the person framed when they pressed the shutter.
  if (facingMode === "user") {
    context.translate(dimensions.width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(video, 0, 0, dimensions.width, dimensions.height);

  const blob = await canvasBlob(canvas);
  const file = new File([blob], `mad-buddy-${Date.now()}.jpg`, { type: blob.type });
  return {
    kind: "image",
    source: "camera",
    blob,
    file,
    mime: blob.type,
    width: dimensions.width,
    height: dimensions.height,
    objectUrl: createObjectUrl(blob),
    pixelsMirrored: facingMode === "user"
  };
}

function imageDimensions(objectUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("library_failed"));
    image.src = objectUrl;
  });
}

export async function localMediaFromLibrary(
  file: File,
  createObjectUrl: (blob: Blob) => string = URL.createObjectURL,
  revokeObjectUrl: (url: string) => void = URL.revokeObjectURL
): Promise<LocalCameraImage> {
  const error = validateImageSource(file, "moment", MAX_LIBRARY_SOURCE_BYTES);
  if (error) throw new Error(error);

  const objectUrl = createObjectUrl(file);
  try {
    const dimensions = await imageDimensions(objectUrl);
    if (dimensions.width <= 0 || dimensions.height <= 0) throw new Error("library_failed");
    return {
      kind: "image",
      source: "library",
      blob: file,
      file,
      mime: file.type,
      width: dimensions.width,
      height: dimensions.height,
      objectUrl,
      pixelsMirrored: false
    };
  } catch (error) {
    revokeObjectUrl(objectUrl);
    throw error;
  }
}
