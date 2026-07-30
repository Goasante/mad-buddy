import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLIENT_MAX_DIMENSION,
  CLIENT_TARGET_BYTES,
  compressImageForUpload,
  MAX_SOURCE_IMAGE_BYTES
} from "@/lib/media/client-compress";
import { maxUploadBytesFor, validateImageSelection, validateImageSource } from "@/lib/media/validation";
import { VARIANT_DIMENSIONS } from "@/lib/media/processing";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** A File stand-in; only size/type/name are read before the canvas path. */
const fakeFile = (bytes: number, type = "image/jpeg", name = "IMG_1234.jpg") =>
  ({ size: bytes, type, name }) as File;

const MB = 1024 * 1024;

describe("phone photos are no longer rejected outright", () => {
  it("accepts a typical 8 MB camera photo as SOURCE input", () => {
    // The old flow applied the 3 MB upload cap to the picked file, so an ordinary
    // photo was refused before anything tried to shrink it.
    expect(validateImageSource(fakeFile(8 * MB), "moment", MAX_SOURCE_IMAGE_BYTES)).toBeNull();
  });

  it("still rejects a non-image and an absurd file", () => {
    expect(validateImageSource(fakeFile(2 * MB, "application/pdf", "a.pdf"), "moment", MAX_SOURCE_IMAGE_BYTES)).not.toBeNull();
    expect(validateImageSource(fakeFile(80 * MB), "moment", MAX_SOURCE_IMAGE_BYTES)).not.toBeNull();
    expect(validateImageSource(fakeFile(0), "moment", MAX_SOURCE_IMAGE_BYTES)).not.toBeNull();
  });

  it("keeps the server upload cap as the authoritative hard limit", () => {
    // Raised, not removed, and still under the 6 MB Server Action body limit.
    expect(maxUploadBytesFor("moment")).toBe(5 * MB);
    expect(maxUploadBytesFor("moment")).toBeLessThan(6 * MB);
    expect(validateImageSelection(fakeFile(7 * MB), "moment")).not.toBeNull();
  });

  it("targets comfortably below the upload cap, leaving multipart headroom", () => {
    expect(CLIENT_TARGET_BYTES).toBeLessThan(maxUploadBytesFor("moment"));
    // Roughly a third of the cap: overhead can never tip a compressed file over.
    expect(CLIENT_TARGET_BYTES).toBeLessThan(maxUploadBytesFor("moment") / 2);
  });

  it("downscales above the largest variant it has to feed", () => {
    // A pointless downscale below the feed variant would soften every image.
    expect(CLIENT_MAX_DIMENSION).toBeGreaterThan(VARIANT_DIMENSIONS.feed);
  });

  it("skips processing when the file is already small enough", async () => {
    const small = fakeFile(400_000);
    const result = await compressImageForUpload(small);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Untouched, so a modest photo is not needlessly re-encoded and softened.
      expect(result.skipped).toBe(true);
      expect(result.file).toBe(small);
    }
  });

  it("reports a useful reason instead of throwing when it cannot compress", async () => {
    // No canvas in this environment, so a large file takes the failure path.
    const result = await compressImageForUpload(fakeFile(9 * MB));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0);
      // Actionable, not a bare size complaint.
      expect(result.reason).not.toContain("3MB");
      expect(result.reason).not.toContain("3 MB");
    }
  });

  it("rejects an oversized source before attempting a decode", async () => {
    const result = await compressImageForUpload(fakeFile(80 * MB));
    expect(result.ok).toBe(false);
  });
});

describe("compression composes with the existing pipeline", () => {
  const composer = read("components/content/moment-composer.tsx");

  it("validates the source, compresses, then re-checks the upload cap", () => {
    const source = composer.indexOf("validateImageSource(file");
    const compress = composer.indexOf("compressImageForUpload(file)");
    const upload = composer.indexOf("validateImageSelection(compressed.file");
    const send = composer.indexOf("uploadMomentMediaAction(formData)");
    expect(source).toBeGreaterThan(-1);
    expect(source).toBeLessThan(compress);
    expect(compress).toBeLessThan(upload);
    expect(upload).toBeLessThan(send);
  });

  it("still routes through the server pipeline for EXIF and variants", () => {
    // The client canvas drops EXIF as a side effect, but the server re-encode is
    // the guarantee, since a client can be bypassed.
    const actions = read("app/(app)/moments-actions.ts");
    expect(actions).toContain("processImageUpload");
    expect(actions).toContain("variantStorageKey");
    const processing = read("lib/media/processing.ts");
    expect(processing).toContain("thumb: 256");
    expect(processing).toContain("feed: 1080");
  });

  it("does not raise the cap without optimising", () => {
    // The whole point: the cap moved a little, but the real fix is the resize.
    expect(composer).toContain("compressImageForUpload");
  });
});
