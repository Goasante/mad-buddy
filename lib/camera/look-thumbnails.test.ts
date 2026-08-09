import { afterEach, describe, expect, it, vi } from "vitest";
import { generateLookThumbnails, LOOK_THUMBNAIL_MAX_EDGE, LookThumbnailCache } from "@/lib/camera/look-thumbnails";
import { MAD_LOOKS } from "@/lib/camera/mad-looks";

const originalDocument = globalThis.document;

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(globalThis, { document: originalDocument });
});

function canvasContext() {
  const gradient = { addColorStop: vi.fn() };
  return {
    clearRect: vi.fn(), save: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(),
    restore: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    fillText: vi.fn(), createRadialGradient: vi.fn(() => gradient), filter: "none", globalCompositeOperation: "source-over",
    globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
    textAlign: "start", textBaseline: "alphabetic", font: "", shadowColor: "", shadowBlur: 0
  };
}

describe("Mad Look thumbnail cache", () => {
  it("revokes replacements, invalidates only for a new source and clears idempotently", () => {
    const revoke = vi.fn();
    const cache = new LookThumbnailCache(revoke);
    cache.useSource("source-a");
    cache.set("original", "blob:a");
    cache.useSource("source-a");
    expect(revoke).not.toHaveBeenCalled();
    cache.set("original", "blob:b");
    expect(revoke).toHaveBeenCalledWith("blob:a");
    cache.useSource("source-b");
    expect(revoke).toHaveBeenCalledWith("blob:b");
    cache.clear();
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it("generates cached low-resolution previews through the canonical renderer", async () => {
    const canvases: Array<{ width: number; height: number }> = [];
    let largestRenderedEdge = 0;
    Object.assign(globalThis, {
      document: {
        createElement: vi.fn(() => {
          let width = 0;
          let height = 0;
          const canvas = {
            get width() { return width; },
            set width(value: number) { width = value; largestRenderedEdge = Math.max(largestRenderedEdge, value); },
            get height() { return height; },
            set height(value: number) { height = value; largestRenderedEdge = Math.max(largestRenderedEdge, value); },
            getContext: vi.fn(() => canvasContext()),
            toBlob: (callback: BlobCallback, mime?: string) => callback(new Blob(["thumb"], { type: mime }))
          };
          canvases.push(canvas);
          return canvas;
        })
      }
    });
    const revoke = vi.fn();
    const cache = new LookThumbnailCache(revoke);
    let nextUrl = 0;
    const onThumbnail = vi.fn();
    const result = await generateLookThumbnails({
      decoded: { source: {} as CanvasImageSource, width: 2400, height: 1800, close: vi.fn() },
      sourceKey: "source-a",
      cache,
      createObjectUrl: () => `blob:thumb-${nextUrl++}`,
      onThumbnail
    });
    expect(Object.keys(result)).toHaveLength(MAD_LOOKS.length);
    expect(onThumbnail).toHaveBeenCalledTimes(MAD_LOOKS.length);
    expect(largestRenderedEdge).toBe(LOOK_THUMBNAIL_MAX_EDGE);
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);

    await generateLookThumbnails({
      decoded: { source: {} as CanvasImageSource, width: 2400, height: 1800, close: vi.fn() },
      sourceKey: "source-a",
      cache,
      createObjectUrl: () => `blob:unexpected-${nextUrl++}`
    });
    expect(nextUrl).toBe(MAD_LOOKS.length);
    cache.clear();
    expect(revoke).toHaveBeenCalledTimes(MAD_LOOKS.length);
  });
});
