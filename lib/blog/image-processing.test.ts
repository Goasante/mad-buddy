import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { optimizeJournalImage } from "./image-processing";
import { JOURNAL_IMAGE_MAX_BYTES } from "./image-model";

describe("lightweight journal images", () => {
  it("caps a detailed photo at 200 KB and stores a JPEG suitable for social previews", async () => {
    const source = await sharp(randomBytes(1800 * 1200 * 3), { raw: { width: 1800, height: 1200, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    const output = await optimizeJournalImage(source);
    const meta = await sharp(output.buffer).metadata();
    expect(output.bytes).toBeLessThanOrEqual(JOURNAL_IMAGE_MAX_BYTES);
    expect(output.width).toBeLessThanOrEqual(1600);
    expect(output.height).toBeLessThanOrEqual(1200);
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
  }, 20000);
  it("bakes in phone orientation and strips camera metadata", async () => {
    const input = await sharp({ create: { width: 600, height: 300, channels: 3, background: "#E88C2B" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const output = await optimizeJournalImage(input);
    const meta = await sharp(output.buffer).metadata();
    expect(output.width).toBe(300); expect(output.height).toBe(600);
    expect(meta.exif).toBeUndefined(); expect(meta.orientation).toBeUndefined();
    expect(output.bytes).toBeLessThan(10000);
  });
  it("does not upscale a small PNG or retain its transparency", async () => {
    const input = await sharp({ create: { width: 240, height: 160, channels: 4, background: { r: 1, g: 1, b: 1, alpha: 0 } } }).png().toBuffer();
    const output = await optimizeJournalImage(input);
    expect(output.width).toBe(240); expect(output.height).toBe(160);
    expect((await sharp(output.buffer).metadata()).hasAlpha).toBe(false);
  });
  it("rejects oversized, scriptable and fake image files", async () => {
    await expect(optimizeJournalImage(Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toThrow("5 MB");
    await expect(optimizeJournalImage(Buffer.from('<svg><script>alert(1)</script></svg>'))).rejects.toThrow("JPEG");
    await expect(optimizeJournalImage(Buffer.from('not a JPEG'))).rejects.toThrow("JPEG");
  });
});
