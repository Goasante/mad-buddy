import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Shared chrome renders shared image assets. Both apps must actually SHIP them.
 *
 * THE INCIDENT (2026-09-12): the shared header and bottom navigation moved into
 * components both platforms render, but the images they reference lived only in
 * the web app's `public/`. On device the Mad Buddy wordmark and the Linkr and
 * UpFor tab icons 404'd -- in a build where every test and both production
 * builds passed, because nothing checked that a referenced path exists in the
 * mobile bundle.
 *
 * Sharing a component shares its assets. This asserts the second half.
 */

const assets = readFileSync("lib/brand/assets.ts", "utf8");

/** Every absolute image path the shared brand manifest points at. */
const referenced = [...assets.matchAll(/src:\s*"(\/[^"]+\.(?:png|jpg|webp|svg))"/g)].map((m) => m[1]);

describe("the shared brand assets ship on both platforms", () => {
  it("finds asset paths to check", () => {
    // Guards the regex itself: a silent zero-match would make every
    // assertion below vacuously pass.
    expect(referenced.length).toBeGreaterThan(5);
  });

  it.each(referenced)("%s exists in the web public directory", (path) => {
    expect(existsSync(`public${path}`)).toBe(true);
  });

  it.each(referenced)("%s exists in the mobile public directory", (path) => {
    // Vite copies mobile/public verbatim into the bundle the APK ships, so a
    // file missing here is a 404 on a real phone.
    expect(existsSync(`mobile/public${path}`)).toBe(true);
  });
});
