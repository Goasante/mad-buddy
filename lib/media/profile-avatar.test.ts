import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  optimizeProfileAvatar,
  PROFILE_AVATAR_DIMENSION,
  PROFILE_AVATAR_TARGET_MAX_BYTES,
  toStorageArrayBuffer
} from "@/lib/media/processing";

describe("optimizeProfileAvatar", () => {
  it("creates a cropped, metadata-free 512px WebP within the target maximum", async () => {
    const source = await sharp({
      create: {
        width: 900,
        height: 480,
        channels: 3,
        background: { r: 40, g: 110, b: 220 }
      }
    }).png().toBuffer();

    const output = await optimizeProfileAvatar(source);
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(PROFILE_AVATAR_DIMENSION);
    expect(metadata.height).toBe(PROFILE_AVATAR_DIMENSION);
    expect(output.length).toBeLessThanOrEqual(PROFILE_AVATAR_TARGET_MAX_BYTES);
    expect(metadata.exif).toBeUndefined();
  });
});

describe("toStorageArrayBuffer", () => {
  it("preserves binary bytes in a tightly sized upload body", () => {
    const pooled = Buffer.allocUnsafe(32);
    const imageBytes = pooled.subarray(9, 14);
    imageBytes.set([0xff, 0xd8, 0xff, 0x00, 0x43]);

    const uploadBody = toStorageArrayBuffer(imageBytes);

    expect(uploadBody).toBeInstanceOf(ArrayBuffer);
    expect(uploadBody.byteLength).toBe(5);
    expect([...new Uint8Array(uploadBody)]).toEqual([0xff, 0xd8, 0xff, 0x00, 0x43]);
  });
});
