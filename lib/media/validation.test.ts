import { describe, expect, it } from "vitest";
import {
  exifKeyMustBeStripped,
  kindForMimeType,
  kindForVideoMimeType,
  maxUploadBytesFor,
  sniffImageKind,
  sniffVideoKind,
  storageKeyFor,
  validateImageUpload,
  validateVideoSelection,
  validateVideoUpload,
  type UploadValidationInput
} from "@/lib/media/validation";

const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP_HEADER = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const HEIC_HEADER = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
const MP4_HEADER = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const MOV_HEADER = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]);
const WEBM_HEADER = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
// An SVG/script masquerading as an image.
const SVG_HEADER = new Uint8Array(Buffer.from("<svg xmlns=", "utf8"));

describe("sniffImageKind (spec §39)", () => {
  it("identifies real image bytes", () => {
    expect(sniffImageKind(JPEG_HEADER)).toBe("jpg");
    expect(sniffImageKind(PNG_HEADER)).toBe("png");
    expect(sniffImageKind(WEBP_HEADER)).toBe("webp");
    expect(sniffImageKind(HEIC_HEADER)).toBe("heic");
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
    expect(maxUploadBytesFor("profile")).toBe(5 * 1024 * 1024);
    expect(maxUploadBytesFor("moment")).toBe(3 * 1024 * 1024);
    expect(validateImageUpload(upload({ sizeBytes: 4 * 1024 * 1024 })).valid).toBe(false);
    expect(validateImageUpload(upload({ sizeBytes: 4 * 1024 * 1024, context: "profile" })).valid).toBe(true);
    expect(validateImageUpload(upload({ sizeBytes: 6 * 1024 * 1024, context: "profile" })).valid).toBe(false);
  });

  it("accepts HEIC for profile photos only", () => {
    const profileResult = validateImageUpload(upload({
      claimedMimeType: "image/heic",
      headerBytes: HEIC_HEADER,
      context: "profile"
    }));
    expect(profileResult).toEqual({ valid: true, kind: "heic", mimeType: "image/heic" });
    expect(validateImageUpload(upload({
      claimedMimeType: "image/heic",
      headerBytes: HEIC_HEADER,
      context: "moment"
    })).valid).toBe(false);
  });

  it("uses verified magic bytes when a browser omits the MIME type", () => {
    expect(validateImageUpload(upload({
      claimedMimeType: "",
      headerBytes: HEIC_HEADER,
      context: "profile"
    }))).toEqual({ valid: true, kind: "heic", mimeType: "image/heic" });
  });

  it("rejects an empty file", () => {
    expect(validateImageUpload(upload({ sizeBytes: 0 }))).toEqual({ valid: false, reason: "empty" });
  });
});

describe("Moment video validation", () => {
  it("identifies supported video containers from real bytes", () => {
    expect(sniffVideoKind(MP4_HEADER)).toBe("mp4");
    expect(sniffVideoKind(MOV_HEADER)).toBe("mov");
    expect(sniffVideoKind(WEBM_HEADER)).toBe("webm");
    expect(kindForVideoMimeType("video/mp4")).toBe("mp4");
  });

  it("accepts matching video bytes and rejects MIME spoofing", () => {
    expect(validateVideoUpload({
      claimedMimeType: "video/mp4",
      headerBytes: MP4_HEADER,
      sizeBytes: 1024
    })).toEqual({ valid: true, kind: "mp4", mimeType: "video/mp4" });
    expect(validateVideoUpload({
      claimedMimeType: "video/mp4",
      headerBytes: WEBM_HEADER,
      sizeBytes: 1024
    })).toEqual({ valid: false, reason: "content_mismatch" });
  });

  it("enforces the short-video size cap in browser and server validation", () => {
    expect(validateVideoSelection({ name: "clip.mp4", type: "video/mp4", size: 5 * 1024 * 1024 })).toBeNull();
    expect(validateVideoSelection({ name: "clip.mp4", type: "video/mp4", size: 5 * 1024 * 1024 + 1 }))
      .toBe("Use a video smaller than 5 MB.");
    expect(validateVideoUpload({
      claimedMimeType: "video/webm",
      headerBytes: WEBM_HEADER,
      sizeBytes: 5 * 1024 * 1024 + 1
    })).toEqual({ valid: false, reason: "too_large" });
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
