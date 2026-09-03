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
const activation = read("components/linkr/linkr-activation.tsx");

describe("Linkr illustrated loading and opened states", () => {
  it("uses the three-person artwork for the Linkr loading screen", () => {
    expect(loading).toContain('variant="loading"');
    expect(loading).toContain("Refreshing your Linkr…");
    expect(artwork).toContain('src: "/illustrations/linkr/linkr-loading.png"');
  });

  it("uses the three-person artwork when Linkr is off", () => {
    expect(activation).toContain('variant="loading"');
    expect(activation).not.toContain('<LinkrOrb variant="off" />');
    expect(activation).toContain("LINKR_COPY.turnOn");
  });

  it("uses the two-person artwork for the opened empty deck", () => {
    expect(moments).toContain('variant="opened"');
    expect(moments).not.toContain('<LinkrOrb variant="empty" />');
    expect(artwork).toContain('src: "/illustrations/linkr/linkr-opened.png"');
  });

  it("keeps the illustration transparent and theme-owned instead of painting a hard card behind it", () => {
    /* THE CONTRACT IS "THEME-OWNED AND SOFT", NOT FOUR EXACT OPACITIES.
     *
     * This pinned `bg-primary/10`, `dark:bg-primary/15`, `bg-card/80` and
     * `dark:bg-white/[0.04]` verbatim. `7470786` ("soften state artwork")
     * deliberately retuned those values -- primary/[0.055], card/[0.38] and a
     * dark surface -- and the artwork became MORE theme-owned, not less: the
     * light scrim now interpolates `hsl(var(--background))` rather than a
     * fixed white.
     *
     * Pinning the numbers meant any future tuning of the same, correct design
     * broke the build, while a genuine regression -- swapping the tokens for a
     * solid card, or letting the image fill rather than fit -- could slip past
     * as long as those four strings survived. So the assertions are now about
     * the properties that actually carry the contract. */

    // Tinted from the theme's own tokens, never a hardcoded card colour.
    expect(artwork).toMatch(/bg-primary\/\[?[\d.]+\]?/);
    expect(artwork).toMatch(/bg-card\/\[?[\d.]+\]?/);
    // Dark mode is handled explicitly rather than inheriting the light values.
    expect(artwork).toMatch(/dark:bg-/);
    // The scrims read the background token instead of assuming a page colour.
    expect(artwork).toContain("hsl(var(--background)");

    /* Soft, not a hard card: the layers behind the art are blurred and
       translucent, so no opaque plate appears behind the illustration. */
    expect(artwork).toMatch(/blur-\[/);
    expect(artwork).not.toMatch(/\bbg-(white|black)\b(?!\/)/);

    // The PNG keeps its aspect ratio rather than being cropped to fill.
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
