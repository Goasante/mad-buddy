import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const readBinary = (path: string) => readFileSync(join(ROOT, path));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const artwork = read("components/linkr/linkr-state-artwork.tsx");
const loading = read("app/(app)/linkr/loading.tsx");
const moments = read("components/linkr/linkr-moments.tsx");

describe("Linkr illustrated loading and opened states", () => {
  it("uses the three-person artwork for the Linkr loading screen", () => {
    expect(loading).toContain('variant="loading"');
    expect(loading).toContain("Refreshing your Linkr…");
    expect(artwork).toContain('src: "/illustrations/linkr/linkr-loading.png"');
  });

  it("uses the two-person artwork for the opened empty deck", () => {
    expect(moments).toContain('variant="opened"');
    expect(moments).not.toContain('<LinkrOrb variant="empty" />');
    expect(artwork).toContain('src: "/illustrations/linkr/linkr-opened.png"');
  });

  it("keeps the illustration transparent and theme-owned instead of painting a hard card behind it", () => {
    expect(artwork).toContain("bg-primary/10");
    expect(artwork).toContain("dark:bg-primary/15");
    expect(artwork).toContain("bg-card/80");
    expect(artwork).toContain("dark:bg-white/[0.04]");
    expect(artwork).toContain("object-contain");
  });

  it("commits real PNG files so production cannot render a broken image placeholder", () => {
    for (const path of [
      "public/illustrations/linkr/linkr-loading.png",
      "public/illustrations/linkr/linkr-opened.png"
    ]) {
      const bytes = readBinary(path);
      expect(bytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
      expect(bytes.byteLength).toBeGreaterThan(8000);
    }
  });
});
