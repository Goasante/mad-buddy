import { afterEach, describe, expect, it, vi } from "vitest";
import { createImageEditDocument, setAdjustment } from "@/lib/camera/image-edit-session";
import {
  IMAGE_EXPORT_MAX_BYTES,
  IMAGE_EXPORT_MIME,
  IMAGE_RENDER_ORDER,
  decodeImageSource,
  editedOutputDimensions,
  exportEditedImage,
  renderEditedImage,
  sourceCropRectangle
} from "@/lib/camera/image-renderer";
import { setDocumentLook } from "@/lib/camera/mad-looks";
import type { LocalCameraImage } from "@/lib/camera/types";

const originalDocument = globalThis.document;
const originalCreateImageBitmap = globalThis.createImageBitmap;
const originalImage = globalThis.Image;

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(globalThis, { document: originalDocument, createImageBitmap: originalCreateImageBitmap, Image: originalImage });
});

describe("canonical image renderer", () => {
  it("publishes the required render order with scene and tracked effect stages", () => {
    expect(IMAGE_RENDER_ORDER).toEqual([
      "orientation_mirror",
      "crop",
      "straighten_rotation",
      "base_look",
      "manual_adjustments",
      "scene_effects",
      "tracked_face_effects",
      "overlays"
    ]);
  });

  it("calculates bounded preview/export dimensions for crop and rotation", () => {
    const document = createImageEditDocument();
    document.geometry.crop = { x: 0.25, y: 0, width: 0.5, height: 1 };
    expect(editedOutputDimensions(4000, 3000, document, 1000)).toEqual({ width: 667, height: 1000 });
    document.geometry.rotation = 90;
    expect(editedOutputDimensions(4000, 3000, document, 1000)).toEqual({ width: 1000, height: 667 });
  });

  it("maps a crop through mirror before rendering so preview and export select the same pixels", () => {
    const document = createImageEditDocument();
    document.geometry.crop = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    expect(sourceCropRectangle(1000, 800, document)).toEqual({ x: 100, y: 160, width: 300, height: 320 });
    document.geometry.mirrored = true;
    const mirrored = sourceCropRectangle(1000, 800, document);
    expect(mirrored.x).toBeCloseTo(600);
    expect({ y: mirrored.y, width: mirrored.width, height: mirrored.height }).toEqual({ y: 160, width: 300, height: 320 });
  });

  it("renders the base Look before the independent manual adjustment layer", () => {
    const gradient = { addColorStop: vi.fn() };
    const makeContext = () => ({
      clearRect: vi.fn(), save: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(),
      drawImage: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), stroke: vi.fn(), fillText: vi.fn(), createRadialGradient: vi.fn(() => gradient),
      filter: "none", globalCompositeOperation: "source-over", globalAlpha: 1, fillStyle: "", strokeStyle: "",
      lineWidth: 1, lineCap: "butt", lineJoin: "miter", textAlign: "start", textBaseline: "alphabetic",
      font: "", shadowColor: "", shadowBlur: 0
    });
    const previewContext = makeContext();
    const workContext = makeContext();
    const previewCanvas = { width: 0, height: 0, getContext: vi.fn(() => previewContext) } as unknown as HTMLCanvasElement;
    const workCanvas = { width: 0, height: 0, getContext: vi.fn(() => workContext) } as unknown as HTMLCanvasElement;
    const document = setAdjustment(setDocumentLook(createImageEditDocument(), "orange-glow", 100), "contrast", 25);

    renderEditedImage(
      { source: {} as CanvasImageSource, width: 1200, height: 900, close: vi.fn() },
      document,
      previewCanvas,
      { workCanvas }
    );

    expect(workContext.filter).toBe("brightness(102%) contrast(107%) saturate(104%)");
    expect(previewContext.filter).toBe("brightness(100%) contrast(125%) saturate(100%)");
    expect(previewContext.drawImage).toHaveBeenCalledWith(workCanvas, 0, 0, 1200, 900);
  });

  it("keeps fallback decode URLs alive until idempotent cleanup", async () => {
    Object.assign(globalThis, { createImageBitmap: undefined });
    class TestImage {
      naturalWidth = 800;
      naturalHeight = 600;
      decoding = "auto";
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    Object.assign(globalThis, { Image: TestImage });
    const revoke = vi.fn();
    const decoded = await decodeImageSource(new Blob(["image"]), () => "blob:decode", revoke);
    expect(revoke).not.toHaveBeenCalled();
    decoded.close();
    decoded.close();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("exports a bounded WebP local image without mutating the source", async () => {
    const context = {
      clearRect: vi.fn(), save: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(),
      drawImage: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), stroke: vi.fn(), fillText: vi.fn(), filter: "none", globalCompositeOperation: "source-over",
      globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
      textAlign: "start", textBaseline: "alphabetic", font: "", shadowColor: "", shadowBlur: 0
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: (callback: BlobCallback, mime?: string) => callback(new Blob([new Uint8Array(1200)], { type: mime }))
    };
    Object.assign(globalThis, { document: { createElement: vi.fn(() => canvas) } });
    const source: LocalCameraImage = {
      kind: "image", source: "library", blob: new Blob(["source"]), file: new File(["source"], "source.jpg"),
      mime: "image/jpeg", width: 2400, height: 1800, objectUrl: "blob:source"
    };
    const result = await exportEditedImage(
      { source: {} as CanvasImageSource, width: 2400, height: 1800, close: vi.fn() },
      createImageEditDocument(),
      source,
      () => "blob:export"
    );
    expect(result).toMatchObject({ kind: "image", mime: IMAGE_EXPORT_MIME, width: 1920, height: 1440, objectUrl: "blob:export" });
    expect(result.blob.size).toBeLessThanOrEqual(IMAGE_EXPORT_MAX_BYTES);
    expect(source.objectUrl).toBe("blob:source");
    expect(source.blob.size).toBe(6);
  });
});
