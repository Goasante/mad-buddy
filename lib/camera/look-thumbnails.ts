import { createImageEditDocument } from "@/lib/camera/image-edit-session";
import { renderEditedImage, type DecodedImageSource } from "@/lib/camera/image-renderer";
import { MAD_LOOKS, setDocumentLook } from "@/lib/camera/mad-looks";

export const LOOK_THUMBNAIL_MAX_EDGE = 144;

function thumbnailBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("thumbnail_failed")), "image/webp", 0.68);
  });
}

export class LookThumbnailCache {
  private sourceKey: string | null = null;
  private readonly urls = new Map<string, string>();

  constructor(private readonly revokeObjectUrl: (url: string) => void = URL.revokeObjectURL) {}

  useSource(sourceKey: string) {
    if (this.sourceKey === sourceKey) return;
    this.clear();
    this.sourceKey = sourceKey;
  }

  get(lookId: string) {
    return this.urls.get(lookId);
  }

  set(lookId: string, url: string) {
    const previous = this.urls.get(lookId);
    if (previous && previous !== url) this.revokeObjectUrl(previous);
    this.urls.set(lookId, url);
  }

  snapshot() {
    return Object.fromEntries(this.urls);
  }

  clear() {
    this.urls.forEach((url) => this.revokeObjectUrl(url));
    this.urls.clear();
  }
}

export async function generateLookThumbnails({
  decoded,
  sourceKey,
  cache,
  createObjectUrl = URL.createObjectURL,
  isCancelled = () => false,
  onThumbnail
}: {
  decoded: DecodedImageSource;
  sourceKey: string;
  cache: LookThumbnailCache;
  createObjectUrl?: (blob: Blob) => string;
  isCancelled?: () => boolean;
  onThumbnail?: (lookId: string, url: string) => void;
}) {
  cache.useSource(sourceKey);
  for (const look of MAD_LOOKS) {
    if (isCancelled()) break;
    const cached = cache.get(look.id);
    if (cached) {
      onThumbnail?.(look.id, cached);
      continue;
    }
    const canvas = globalThis.document.createElement("canvas");
    const workCanvas = globalThis.document.createElement("canvas");
    try {
      const document = setDocumentLook(createImageEditDocument(), look.id, look.defaultIntensity);
      renderEditedImage(decoded, document, canvas, {
        maxEdge: LOOK_THUMBNAIL_MAX_EDGE,
        includeOverlays: false,
        workCanvas
      });
      const blob = await thumbnailBlob(canvas);
      if (isCancelled()) break;
      const url = createObjectUrl(blob);
      cache.set(look.id, url);
      onThumbnail?.(look.id, url);
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
