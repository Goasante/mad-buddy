import { effectInstanceFor, MAD_EFFECTS } from "@/lib/camera/effect-registry";
import { setDocumentEffect } from "@/lib/camera/effect-document";
import { createImageEditDocument } from "@/lib/camera/image-edit-session";
import { renderEditedImage, type DecodedImageSource } from "@/lib/camera/image-renderer";

export const EFFECT_THUMBNAIL_MAX_EDGE = 144;

function thumbnailBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("effect_thumbnail_failed")), "image/webp", 0.68);
  });
}

export class EffectThumbnailCache {
  private sourceKey: string | null = null;
  private readonly urls = new Map<string, string>();

  constructor(private readonly revokeObjectUrl: (url: string) => void = URL.revokeObjectURL) {}

  useSource(sourceKey: string) {
    if (this.sourceKey === sourceKey) return;
    this.clear();
    this.sourceKey = sourceKey;
  }

  get(effectId: string) {
    return this.urls.get(effectId);
  }

  set(effectId: string, url: string) {
    const previous = this.urls.get(effectId);
    if (previous && previous !== url) this.revokeObjectUrl(previous);
    this.urls.set(effectId, url);
  }

  snapshot() {
    return Object.fromEntries(this.urls);
  }

  clear() {
    this.urls.forEach((url) => this.revokeObjectUrl(url));
    this.urls.clear();
  }
}

export async function generateEffectThumbnails({
  decoded,
  sourceKey,
  cache,
  createObjectUrl = URL.createObjectURL,
  isCancelled = () => false,
  onThumbnail
}: {
  decoded: DecodedImageSource;
  sourceKey: string;
  cache: EffectThumbnailCache;
  createObjectUrl?: (blob: Blob) => string;
  isCancelled?: () => boolean;
  onThumbnail?: (effectId: string, url: string) => void;
}) {
  cache.useSource(sourceKey);
  for (const effect of MAD_EFFECTS) {
    if (isCancelled()) break;
    const cached = cache.get(effect.id);
    if (cached) {
      onThumbnail?.(effect.id, cached);
      continue;
    }
    const instance = effectInstanceFor(effect.id);
    if (!instance) continue;
    const canvas = globalThis.document.createElement("canvas");
    const workCanvas = globalThis.document.createElement("canvas");
    try {
      const document = setDocumentEffect(createImageEditDocument(), instance);
      renderEditedImage(decoded, document, canvas, {
        maxEdge: EFFECT_THUMBNAIL_MAX_EDGE,
        includeOverlays: false,
        workCanvas,
        reducedMotion: true,
        timeMs: 0
      });
      const blob = await thumbnailBlob(canvas);
      if (isCancelled()) break;
      const url = createObjectUrl(blob);
      cache.set(effect.id, url);
      onThumbnail?.(effect.id, url);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      workCanvas.width = 0;
      workCanvas.height = 0;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return cache.snapshot();
}

