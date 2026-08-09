import type { LocalCameraImage } from "@/lib/camera/types";
import type { ImageEditDocument } from "@/lib/camera/image-edit-session";
import { getMadLook, interpolateLook, type MadLookTone } from "@/lib/camera/mad-looks";

export const IMAGE_RENDER_ORDER = [
  "orientation_mirror",
  "crop",
  "straighten_rotation",
  "base_look",
  "manual_adjustments",
  "future_effects",
  "overlays"
] as const;

export const IMAGE_PREVIEW_MAX_EDGE = 1280;
export const IMAGE_EXPORT_MAX_EDGE = 1920;
export const IMAGE_EXPORT_MIME = "image/webp";
export const IMAGE_EXPORT_QUALITY = 0.84;
export const IMAGE_EXPORT_MAX_BYTES = 5 * 1024 * 1024;

export type DecodedImageSource = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

function once(callback: () => void) {
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    callback();
  };
}

function imageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image_decode_failed"));
    image.src = url;
  });
}

export async function decodeImageSource(
  blob: Blob,
  createObjectUrl: (blob: Blob) => string = URL.createObjectURL,
  revokeObjectUrl: (url: string) => void = URL.revokeObjectURL
): Promise<DecodedImageSource> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: once(() => bitmap.close()) };
  }
  const url = createObjectUrl(blob);
  try {
    const image = await imageFromUrl(url);
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: once(() => revokeObjectUrl(url))
    };
  } catch (error) {
    revokeObjectUrl(url);
    throw error;
  }
}

export function editedOutputDimensions(
  sourceWidth: number,
  sourceHeight: number,
  document: ImageEditDocument,
  maxEdge: number
) {
  const cropWidth = Math.max(1, sourceWidth * document.geometry.crop.width);
  const cropHeight = Math.max(1, sourceHeight * document.geometry.crop.height);
  const swap = document.geometry.rotation === 90 || document.geometry.rotation === 270;
  const orientedWidth = swap ? cropHeight : cropWidth;
  const orientedHeight = swap ? cropWidth : cropHeight;
  const scale = Math.min(1, maxEdge / Math.max(orientedWidth, orientedHeight));
  return {
    width: Math.max(1, Math.round(orientedWidth * scale)),
    height: Math.max(1, Math.round(orientedHeight * scale))
  };
}

export function sourceCropRectangle(
  sourceWidth: number,
  sourceHeight: number,
  document: ImageEditDocument
) {
  const crop = document.geometry.crop;
  return {
    x: (document.geometry.mirrored ? 1 - crop.x - crop.width : crop.x) * sourceWidth,
    y: crop.y * sourceHeight,
    width: crop.width * sourceWidth,
    height: crop.height * sourceHeight
  };
}

function straightenCoverScale(width: number, height: number, degrees: number) {
  const angle = Math.abs(degrees) * Math.PI / 180;
  if (angle < 0.0001) return 1;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const horizontal = width * cosine - height * sine;
  const vertical = height * cosine - width * sine;
  return Math.min(3, Math.max(
    horizontal > 0 ? width / horizontal : 1,
    vertical > 0 ? height / vertical : 1,
    1
  ));
}

export function renderEditedImage(
  decoded: DecodedImageSource,
  document: ImageEditDocument,
  canvas: HTMLCanvasElement,
  options: { maxEdge?: number; includeOverlays?: boolean; workCanvas?: HTMLCanvasElement } = {}
) {
  const dimensions = editedOutputDimensions(
    decoded.width,
    decoded.height,
    document,
    options.maxEdge ?? IMAGE_PREVIEW_MAX_EDGE
  );
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas_unavailable");
  const workCanvas = options.workCanvas ?? globalThis.document.createElement("canvas");
  workCanvas.width = dimensions.width;
  workCanvas.height = dimensions.height;
  const workContext = workCanvas.getContext("2d");
  if (!workContext) throw new Error("canvas_unavailable");

  const sourceCrop = sourceCropRectangle(decoded.width, decoded.height, document);
  const sourceX = sourceCrop.x;
  const sourceY = sourceCrop.y;
  const sourceWidth = sourceCrop.width;
  const sourceHeight = sourceCrop.height;
  const swap = document.geometry.rotation === 90 || document.geometry.rotation === 270;
  const baseScale = swap ? dimensions.width / sourceHeight : dimensions.width / sourceWidth;
  const cover = straightenCoverScale(dimensions.width, dimensions.height, document.geometry.straighten);

  const resolvedLook = interpolateLook(getMadLook(document.look.id), document.look.intensity);
  workContext.clearRect(0, 0, dimensions.width, dimensions.height);
  workContext.save();
  workContext.translate(dimensions.width / 2, dimensions.height / 2);
  workContext.rotate((document.geometry.rotation + document.geometry.straighten) * Math.PI / 180);
  workContext.scale((document.geometry.mirrored ? -1 : 1) * baseScale * cover, baseScale * cover);
  workContext.filter = adjustmentFilter(resolvedLook.adjustments);
  workContext.drawImage(
    decoded.source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    -sourceWidth / 2,
    -sourceHeight / 2,
    sourceWidth,
    sourceHeight
  );
  workContext.restore();
  applyWarmthOverlay(workContext, resolvedLook.adjustments.warmth, dimensions.width, dimensions.height);
  applyLookTone(workContext, resolvedLook.tone, dimensions.width, dimensions.height);

  context.clearRect(0, 0, dimensions.width, dimensions.height);
  context.save();
  context.filter = adjustmentFilter(document.adjustments);
  context.drawImage(workCanvas, 0, 0, dimensions.width, dimensions.height);
  context.restore();
  applyWarmthOverlay(context, document.adjustments.warmth, dimensions.width, dimensions.height);

  if (options.includeOverlays !== false) drawImageOverlays(context, document, dimensions.width, dimensions.height);
  return dimensions;
}

function adjustmentFilter(adjustments: { brightness: number; contrast: number; saturation: number }) {
  return `brightness(${100 + adjustments.brightness}%) contrast(${100 + adjustments.contrast}%) saturate(${100 + adjustments.saturation}%)`;
}

function applyWarmthOverlay(context: CanvasRenderingContext2D, warmth: number, width: number, height: number) {
  if (warmth === 0) return;
  context.save();
  context.globalCompositeOperation = "soft-light";
  context.globalAlpha = Math.min(0.34, Math.abs(warmth) / 290);
  context.fillStyle = warmth > 0 ? "#F59E42" : "#4B7BEC";
  context.fillRect(0, 0, width, height);
  context.restore();
}

function applyLookTone(context: CanvasRenderingContext2D, tone: MadLookTone, width: number, height: number) {
  if (tone.shadowTint?.amount) {
    context.save();
    context.globalCompositeOperation = "multiply";
    context.globalAlpha = tone.shadowTint.amount;
    context.fillStyle = tone.shadowTint.color;
    context.fillRect(0, 0, width, height);
    context.restore();
  }
  if (tone.highlightTint?.amount) {
    context.save();
    context.globalCompositeOperation = "screen";
    context.globalAlpha = tone.highlightTint.amount;
    context.fillStyle = tone.highlightTint.color;
    context.fillRect(0, 0, width, height);
    context.restore();
  }
  if (tone.fade) {
    context.save();
    context.globalCompositeOperation = "screen";
    context.globalAlpha = tone.fade;
    context.fillStyle = "#B9AAA4";
    context.fillRect(0, 0, width, height);
    context.restore();
  }
  if (tone.vignette) {
    const gradient = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.22, width / 2, height / 2, Math.max(width, height) * 0.72);
    gradient.addColorStop(0, "rgba(20, 4, 5, 0)");
    gradient.addColorStop(1, `rgba(20, 4, 5, ${Math.min(0.42, tone.vignette)})`);
    context.save();
    context.globalCompositeOperation = "multiply";
    context.globalAlpha = 1;
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.restore();
  }
}

export function drawImageOverlays(
  context: CanvasRenderingContext2D,
  document: ImageEditDocument,
  width: number,
  height: number
) {
  for (const stroke of document.drawingStrokes) {
    if (stroke.points.length < 2) continue;
    context.save();
    context.strokeStyle = stroke.color;
    context.lineWidth = Math.max(2, stroke.size * Math.min(width, height));
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    stroke.points.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    context.restore();
  }

  for (const overlay of document.textOverlays) {
    context.save();
    context.translate(overlay.position.x * width, overlay.position.y * height);
    context.rotate(overlay.rotation * Math.PI / 180);
    context.fillStyle = overlay.color;
    context.textAlign = overlay.align;
    context.textBaseline = "middle";
    context.font = `700 ${Math.max(14, overlay.size * Math.min(width, height))}px Inter, system-ui, sans-serif`;
    context.shadowColor = "rgba(0,0,0,.45)";
    context.shadowBlur = 4;
    context.fillText(overlay.text, 0, 0, width * 0.85);
    context.restore();
  }
}

function canvasBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("image_export_failed")), mime, quality);
  });
}

export async function exportEditedImage(
  decoded: DecodedImageSource,
  editDocument: ImageEditDocument,
  source: LocalCameraImage,
  createObjectUrl: (blob: Blob) => string = URL.createObjectURL
): Promise<LocalCameraImage> {
  const canvas = globalThis.document.createElement("canvas");
  const workCanvas = globalThis.document.createElement("canvas");
  try {
    const dimensions = renderEditedImage(decoded, editDocument, canvas, {
      maxEdge: IMAGE_EXPORT_MAX_EDGE,
      includeOverlays: true,
      workCanvas
    });
    let blob = await canvasBlob(canvas, IMAGE_EXPORT_MIME, IMAGE_EXPORT_QUALITY);
    if (blob.type !== IMAGE_EXPORT_MIME) blob = await canvasBlob(canvas, "image/jpeg", 0.86);
    if (blob.size > IMAGE_EXPORT_MAX_BYTES) blob = await canvasBlob(canvas, blob.type === IMAGE_EXPORT_MIME ? IMAGE_EXPORT_MIME : "image/jpeg", 0.7);
    if (blob.size <= 0 || blob.size > IMAGE_EXPORT_MAX_BYTES) throw new Error("image_export_too_large");
    const mime = blob.type === IMAGE_EXPORT_MIME ? IMAGE_EXPORT_MIME : "image/jpeg";
    const extension = mime === IMAGE_EXPORT_MIME ? "webp" : "jpg";
    const file = new File([blob], `mad-buddy-edit-${Date.now()}.${extension}`, { type: mime });
    return {
      kind: "image",
      source: source.source,
      blob,
      file,
      mime,
      width: dimensions.width,
      height: dimensions.height,
      objectUrl: createObjectUrl(blob),
      pixelsMirrored: false
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    workCanvas.width = 0;
    workCanvas.height = 0;
  }
}
