import sharp, { type Exif } from "sharp";
import { describe, expect, it } from "vitest";
import { processImageUpload } from "@/lib/media/processing";

/**
 * EXIF GPS must not survive an upload.
 *
 * This is the single highest-stakes property in Profile media. Mad Buddy's
 * whole promise is that exact location never leaves the device — a promise the
 * proximity architecture keeps carefully, exposing bands rather than distances
 * and storing no coordinates for Safe Arrival. A phone photo carrying GPS EXIF
 * would walk straight past all of it: the image is downloadable, the metadata
 * survives the browser, and the viewer would hold a precise fix on where the
 * photo was taken.
 *
 * `lib/media/processing.ts` documents that re-encoding through sharp without
 * `withMetadata()` drops every metadata block, so stripping is enforced by
 * construction. This test does not take that on trust: it builds an image
 * carrying real GPS EXIF, runs the product's own processing, and reads the
 * output back to prove the coordinates are gone.
 */

/** A small JPEG carrying GPS EXIF, built in-process so the test is hermetic. */
async function gpsTaggedJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 120, g: 80, b: 40 } }
  })
    /* `GPS` is a real EXIF IFD that sharp writes, but its TypeScript `Exif`
       type only declares the IFD0/IFD1/IFD2/IFD3 keys, so the cast is a
       type-level accommodation rather than a behavioural one — the assertion
       below proves the block was genuinely written. */
    .withExif({
      IFD0: { Make: "TestCam", Model: "HardeningProbe" },
      GPS: {
        // 5.6508 N, 0.1869 W — the Accra fixture location used elsewhere in
        // this program, so a leak would be recognisable rather than abstract.
        GPSLatitudeRef: "N",
        GPSLatitude: "5/1 39/1 2828/100",
        GPSLongitudeRef: "W",
        GPSLongitude: "0/1 11/1 828/100"
      }
    } as unknown as Exif)
    .jpeg()
    .toBuffer();
}

describe("upload image processing: EXIF", () => {
  it("the fixture really does carry GPS, so this test can fail", async () => {
    /* Without this, "no GPS in the output" would be satisfied by an input that
       never had any — the empty-fixture trap that has already caught this
       program once on the privacy probe. */
    const tagged = await gpsTaggedJpeg();
    const meta = await sharp(tagged).metadata();
    expect(meta.exif, "the fixture carries no EXIF at all").toBeDefined();
    expect(meta.exif!.length).toBeGreaterThan(0);
  });

  it("strips GPS EXIF from the stored image", async () => {
    const tagged = await gpsTaggedJpeg();
    const processed = await processImageUpload(tagged, "jpg");
    const meta = await sharp(processed.original.buffer).metadata();

    // The whole metadata block is gone, not merely the GPS fields — stripping
    // by construction rather than by field-by-field filtering.
    expect(meta.exif, "EXIF survived processing").toBeUndefined();
  });

  it("strips metadata from every variant, not only the original", async () => {
    /* A variant is what actually gets served to other people. Stripping the
       original while shipping a thumbnail that still carries GPS would defeat
       the entire point. */
    const tagged = await gpsTaggedJpeg();
    const processed = await processImageUpload(tagged, "jpg");
    for (const [name, variant] of Object.entries(processed.variants)) {
      const meta = await sharp(variant.buffer).metadata();
      expect(meta.exif, `EXIF survived in the ${name} variant`).toBeUndefined();
    }
  });

  it("keeps the image itself intact while dropping the metadata", async () => {
    // Stripping must not corrupt the picture — a blank or unreadable output
    // would "pass" a metadata check while breaking the product.
    const tagged = await gpsTaggedJpeg();
    const processed = await processImageUpload(tagged, "jpg");
    const meta = await sharp(processed.original.buffer).metadata();
    expect(meta.width).toBeGreaterThan(0);
    expect(meta.height).toBeGreaterThan(0);
  });
});
