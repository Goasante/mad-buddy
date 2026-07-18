import { describe, expect, it } from "vitest";
import {
  exifKeyMustBeStripped,
  kindForMimeType,
  maxUploadBytesFor,
  sniffImageKind,
  storageKeyFor,
  validateImageUpload,
  type UploadValidationInput
} from "@/lib/media/validation";

const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP_HEADER = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
// An SVG/script masquerading as an image.
const SVG_HEADER = new Uint8Array(Buffer.from("<svg xmlns=", "utf8"));

describe("sniffImageKind (spec §39)", () => {
  it("identifies real image bytes", () => {
    expect(sniffImageKind(JPEG_HEADER)).toBe("jpg");
    expect(sniffImageKind(PNG_HEADER)).toBe("png");
    expect(sniffImageKind(WEBP_HEADER)).toBe("webp");
  });

  it("refuses SVG and unknown bytes", () => {
    expect(sniffImageKind(SVG_HEADER)).toBeNull();
    expect(sniffImageKind(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull();
  });
});

describe("validateImageUpload", () => {
  function upload(overrides: Partial<UploadValidationInput> = {}): UploadValidationInput {
    return {
      claimedMimeType: "image/png",
      headerBytes: PNG_HEADER,
      sizeBytes: 1024,
      context: "moment",
      ...overrides
    };
  }

  it("accepts a genuine image whose bytes match its claimed type", () => {
    expect(validateImageUpload(upload())).toEqual({ valid: true, kind: "png", mimeType: "image/png" });
  });

  it("never trusts the browser MIME type, mismatched bytes are rejected", () => {
    // Claims PNG, actually a JPEG.
    expect(validateImageUpload(upload({ headerBytes: JPEG_HEADER }))).toEqual({
      valid: false,
      reason: "content_mismatch"
    });
    // Claims PNG, actually SVG markup, the polyglot/script case.
    expect(validateImageUpload(upload({ headerBytes: SVG_HEADER }))).toEqual({
      valid: false,
      reason: "content_mismatch"
    });
  });

  it("rejects unsupported types outright, including SVG", () => {
    expect(validateImageUpload(upload({ claimedMimeType: "image/svg+xml" })).valid).toBe(false);
    expect(kindForMimeType("image/svg+xml")).toBeNull();
    expect(validateImageUpload(upload({ claimedMimeType: "application/pdf" })).valid).toBe(false);
  });

  it("enforces per-context size caps", () => {
    expect(maxUploadBytesFor("profile")).toBe(10 * 1024 * 1024);
    expect(maxUploadBytesFor("moment")).toBe(15 * 1024 * 1024);
    expect(validateImageUpload(upload({ sizeBytes: 16 * 1024 * 1024 })).valid).toBe(false);
    expect(validateImageUpload(upload({ sizeBytes: 11 * 1024 * 1024, context: "profile" })).valid).toBe(false);
  });

  it("rejects an empty file", () => {
    expect(validateImageUpload(upload({ sizeBytes: 0 }))).toEqual({ valid: false, reason: "empty" });
  });
});

describe("EXIF policy (spec §40)", () => {
  it("strips every GPS key, listed or not", () => {
    expect(exifKeyMustBeStripped("GPSLatitude")).toBe(true);
    expect(exifKeyMustBeStripped("GPSLongitude")).toBe(true);
    // Defence in depth: unlisted GPS-shaped keys still go.
    expect(exifKeyMustBeStripped("GPSSomethingNew")).toBe(true);
    expect(exifKeyMustBeStripped("gpsLatitudeRef")).toBe(true);
  });

  it("strips device identifiers", () => {
    expect(exifKeyMustBeStripped("Make")).toBe(true);
    expect(exifKeyMustBeStripped("SerialNumber")).toBe(true);
  });

  it("leaves harmless keys alone", () => {
    expect(exifKeyMustBeStripped("ColorSpace")).toBe(false);
  });
});

describe("storageKeyFor", () => {
  it("puts the owner id first so storage RLS can authorize on it", () => {
    const key = storageKeyFor({ ownerId: "user-1", context: "moment", mediaId: "m1", kind: "png" });
    expect(key).toBe("user-1/moment/m1.png");
    expect(key.split("/")[0]).toBe("user-1");
  });
});
