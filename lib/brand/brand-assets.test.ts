import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { brandLogo, brandSymbol } from "@/lib/brand/assets";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const publicFile = (src: string) => join(process.cwd(), "public", src.replace(/^\//, ""));

/** Width/height from a PNG header, so dimensions are measured, not asserted. */
function pngSize(absolutePath: string): { width: number; height: number } {
  const header = readFileSync(absolutePath).subarray(0, 24);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

const appShell = read("components/app-shell/app-shell.tsx");
const brandMark = read("components/brand/brand-mark.tsx");

// ---------------------------------------------------------------------------
// One canonical source of truth
// ---------------------------------------------------------------------------

describe("brand assets are referenced through one module", () => {
  it("ships every asset it points at", () => {
    const every = [
      brandLogo.light.src,
      brandLogo.dark.src,
      brandSymbol.light.src,
      brandSymbol.dark.src
    ];
    for (const src of every) {
      expect(existsSync(publicFile(src)), src).toBe(true);
    }
  });

  it("declares the real intrinsic size of each logo", () => {
    // Wrong numbers here are how next/image stretches a wordmark.
    for (const asset of [brandLogo.light, brandLogo.dark, brandSymbol.light, brandSymbol.dark]) {
      const actual = pngSize(publicFile(asset.src));
      expect(actual, asset.src).toEqual({ width: asset.width, height: asset.height });
    }
  });

  it("keeps raw asset paths out of the components", () => {
    // A stray "/brand/....png" in a component is how the next identity change
    // becomes a repository-wide search.
    expect(brandMark).not.toMatch(/["']\/brand\/[^"']+\.png["']/);
  });
});

// ---------------------------------------------------------------------------
// Only the supplied destinations changed
// ---------------------------------------------------------------------------

describe("unrelated navigation is untouched", () => {
  it("keeps the stroke-drawn icons in the navigation", () => {
    // The supplied Linkr/UpFor artwork is dense (33-49% inked) next to
    // lucide's thin 2px strokes (~14%), so matching box sizes made those two
    // tabs read smaller and heavier than their neighbours. The nav keeps its
    // SVG icons, which match visually and inherit theme colour natively.
    expect(appShell).toContain("import { HangoutIcon, LinkrIcon }");
    expect(appShell).not.toContain("brandIcon");
    expect(appShell).not.toContain("BrandNavIcon");
  });

  it("still uses the approved logo everywhere else", () => {
    // Reverting the two nav slots must not revert the identity itself.
    expect(appShell).toContain("BrandMark");
  });

  it("keeps every route and label as it was", () => {
    expect(appShell).toContain('{ href: "/discover", label: "Linkr"');
    expect(appShell).toContain('{ href: "/hangout-mode", label: "UpFor"');
    expect(appShell).toContain('{ href: "/friends", label: "Muddies", icon: Users }');
    expect(appShell).toContain('{ href: "/messages", label: "Messages", icon: MessageCircle }');
  });

  it("leaves the unread badges on their tabs", () => {
    expect(appShell).toContain('tab.href === "/messages" && messageUnreadCount > 0');
    expect(appShell).toContain('tab.href === "/friends" && muddyRequestCount > 0');
  });
});

// ---------------------------------------------------------------------------
// Light and dark are real artwork, not a filter
// ---------------------------------------------------------------------------

describe("light and dark logos", () => {
  it("uses the supplied variant for each background", () => {
    expect(brandMark).toContain("dark:hidden");
    expect(brandMark).toContain("hidden dark:block");
  });

  it("never fakes one variant from the other", () => {
    // Comments stripped: the note explaining this names the hacks it forbids.
    const code = stripComments(brandMark);
    for (const hack of ["invert", "brightness(", "grayscale", "mix-blend"]) {
      expect(code, hack).not.toContain(hack);
    }
  });

  it("cannot be stretched by a caller", () => {
    // w-auto is appended LAST so twMerge beats a caller's square w-*.
    expect(brandMark).toContain('"w-auto"');
    expect(brandMark).toContain("object-contain");
  });
});
