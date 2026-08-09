import { afterEach, describe, expect, it, vi } from "vitest";
import { captureVideoFrame, localMediaFromLibrary } from "@/lib/camera/local-media";

const originalDocument = globalThis.document;
const originalHtmlMediaElement = globalThis.HTMLMediaElement;
const originalImage = globalThis.Image;

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(globalThis, {
    document: originalDocument,
    HTMLMediaElement: originalHtmlMediaElement,
    Image: originalImage
  });
});

describe("local camera media", () => {
  it("captures a bounded rear-camera frame into the shared local image shape", async () => {
    const drawImage = vi.fn();
    const context = { drawImage, translate: vi.fn(), scale: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: (callback: BlobCallback) => callback(new Blob(["image"], { type: "image/jpeg" }))
    };
    Object.assign(globalThis, {
      HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
      document: { createElement: vi.fn(() => canvas) }
    });

    const result = await captureVideoFrame(
      { readyState: 4, videoWidth: 4000, videoHeight: 3000 } as HTMLVideoElement,
      "environment",
      () => "blob:captured"
    );
    expect(result).toMatchObject({
      kind: "image",
      source: "camera",
      mime: "image/jpeg",
      width: 1920,
      height: 1440,
      objectUrl: "blob:captured",
      pixelsMirrored: false
    });
    expect(drawImage).toHaveBeenCalledOnce();
  });

  it("mirrors a front-camera capture so review matches its preview", async () => {
    const context = { drawImage: vi.fn(), translate: vi.fn(), scale: vi.fn() };
    Object.assign(globalThis, {
      HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
      document: {
        createElement: vi.fn(() => ({
          width: 0,
          height: 0,
          getContext: () => context,
          toBlob: (callback: BlobCallback) => callback(new Blob(["image"], { type: "image/jpeg" }))
        }))
      }
    });
    const result = await captureVideoFrame(
      { readyState: 4, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement,
      "user",
      () => "blob:selfie"
    );
    expect(context.translate).toHaveBeenCalledWith(640, 0);
    expect(context.scale).toHaveBeenCalledWith(-1, 1);
    expect(result.pixelsMirrored).toBe(true);
  });

  it("normalizes a valid library image and revokes a failed local URL", async () => {
    class SuccessfulImage {
      naturalWidth = 1080;
      naturalHeight = 1350;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    Object.assign(globalThis, { Image: SuccessfulImage });
    const file = new File([new Uint8Array(100)], "photo.jpg", { type: "image/jpeg" });
    const result = await localMediaFromLibrary(file, () => "blob:library", vi.fn());
    expect(result).toMatchObject({ source: "library", width: 1080, height: 1350, objectUrl: "blob:library" });

    class FailedImage extends SuccessfulImage {
      set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    }
    Object.assign(globalThis, { Image: FailedImage });
    const revoke = vi.fn();
    await expect(localMediaFromLibrary(file, () => "blob:bad", revoke)).rejects.toThrow("library_failed");
    expect(revoke).toHaveBeenCalledWith("blob:bad");
  });
});
