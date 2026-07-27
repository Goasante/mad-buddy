import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { isPublicPath, requiredLoginRedirect } from "@/lib/security/route-protection";

describe("public PWA boot resources", () => {
  it("keeps only the required dynamic PWA resources public", () => {
    expect(isPublicPath("/manifest.webmanifest")).toBe(true);
    expect(isPublicPath("/sw.js")).toBe(true);
    expect(requiredLoginRedirect("/dashboard")).toBe("/login");
    expect(isPublicPath("/private-worker.js")).toBe(false);
  });

  it("returns a valid install manifest with separate any and maskable icons", () => {
    const value = manifest();
    expect(value.name).toBe("Mad Buddy");
    expect(value.start_url).toBe("/");
    expect(value.scope).toBe("/");
    expect(value.display).toBe("standalone");
    expect(value.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icons/pwa/icon-512.png", purpose: "any" }),
        expect.objectContaining({ src: "/icons/pwa/icon-maskable-512.png", purpose: "maskable" })
      ])
    );
  });

  it("ships the referenced worker and launcher assets", () => {
    expect(readFileSync(join(process.cwd(), "public", "sw.js"), "utf8")).toContain(
      'addEventListener("fetch"'
    );
    for (const asset of [
      "public/icons/pwa/icon-192.png",
      "public/icons/pwa/icon-512.png",
      "public/icons/pwa/icon-maskable-512.png",
      // App Router serves this as /apple-icon.png from the app metadata file;
      // a duplicate public/apple-touch-icon.png is unnecessary.
      "app/apple-icon.png",
      "app/favicon.ico"
    ]) {
      expect(() => readFileSync(join(process.cwd(), asset))).not.toThrow();
    }
  });
});
