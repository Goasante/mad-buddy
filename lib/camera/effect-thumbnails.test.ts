import { afterEach, describe, expect, it, vi } from "vitest";
import { EFFECT_THUMBNAIL_MAX_EDGE, EffectThumbnailCache, generateEffectThumbnails } from "@/lib/camera/effect-thumbnails";
import { MAD_EFFECTS } from "@/lib/camera/effect-registry";

const originalDocument = globalThis.document;

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(globalThis, { document: originalDocument });
});

function canvasContext() {
  const gradient = { addColorStop: vi.fn() };
  return {
    clearRect: vi.fn(), save: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(),
    restore: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), beginPath: vi.fn(), ellipse: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), stroke: vi.fn(), fillText: vi.fn(), createRadialGradient: vi.fn(() => gradient), filter: "none",
    globalCompositeOperation: "source-over", globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1,
    lineCap: "butt", lineJoin: "miter", textAlign: "start", textBaseline: "alphabetic", font: "",
    shadowColor: "", shadowBlur: 0
  };
}

describe("Mad Effect thumbnail cache", () => {
  it("generates bounded lazy previews once per source and revokes them on clear", async () => {
    let largestEdge = 0;
    Object.assign(globalThis, {
      document: {
        createElement: vi.fn(() => {
          let width = 0;
          let height = 0;
          return {
            get width() { return width; },
            set width(value: number) { width = value; largestEdge = Math.max(largestEdge, value); },
            get height() { return height; },
            set height(value: number) { height = value; largestEdge = Math.max(largestEdge, value); },
            getContext: vi.fn(() => canvasContext()),
            toBlob: (callback: BlobCallback, mime?: string) => callback(new Blob(["thumb"], { type: mime }))
          };
        })
      }
    });
    const revoke = vi.fn();
    const cache = new EffectThumbnailCache(revoke);
    let index = 0;
    const result = await generateEffectThumbnails({
      decoded: { source: {} as CanvasImageSource, width: 2000, height: 1500, close: vi.fn() },
      sourceKey: "one",
      cache,
      createObjectUrl: () => `blob:effect-${index++}`
    });
    expect(Object.keys(result)).toHaveLength(MAD_EFFECTS.length);
    expect(index).toBe(MAD_EFFECTS.length);
    expect(largestEdge).toBe(EFFECT_THUMBNAIL_MAX_EDGE);
    await generateEffectThumbnails({
      decoded: { source: {} as CanvasImageSource, width: 2000, height: 1500, close: vi.fn() },
      sourceKey: "one",
      cache,
      createObjectUrl: () => `blob:unexpected-${index++}`
    });
    expect(index).toBe(MAD_EFFECTS.length);
    cache.clear();
    expect(revoke).toHaveBeenCalledTimes(MAD_EFFECTS.length);
  });
});

