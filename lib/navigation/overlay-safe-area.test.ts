import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No overlay may draw into the notch.
 *
 * Anything positioned against the VIEWPORT — a centred dialog, a bottom sheet
 * that grows tall, a tour card — sits under the status bar and camera cutout
 * unless it accounts for the safe area itself. The page beneath it does; a
 * fixed overlay is outside that flow and does not inherit it.
 *
 * Two shapes of the same bug:
 *
 *   1. A top offset measured from 0 (`top-3` is 12px into the notch).
 *   2. A height measured from the bottom edge (`88svh` from the bottom
 *      reaches past the safe area on a short screen).
 *
 * Both are asserted here rather than in each component's own test, because
 * the rule belongs to overlays as a category and the next one added should
 * inherit it.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** Every overlay that pins itself to the viewport. */
const OVERLAYS = [
  "components/ui/modal.tsx",
  "components/ui/responsive-form-popover.tsx",
  "components/tours/tour-runner.tsx",
  "components/dashboard/home-settings-sheet.tsx",
  "components/dashboard/quick-controls-sheet.tsx",
  "components/socialize/skipped-people-sheet.tsx"
] as const;

describe("no overlay grows into the notch", () => {
  it.each(OVERLAYS)("%s caps its height against the top inset", (path) => {
    const source = read(path);
    // Any viewport-relative height cap must subtract the inset. A bare
    // `max-h-[88svh]` measured from the bottom edge still reaches into it.
    const bareCaps = source.match(/max-h-\[\d+[sd]vh\]/g) ?? [];
    expect(bareCaps, `${path}: ${bareCaps.join(", ")}`).toEqual([]);
  });

  it("offsets a top-anchored panel by the inset rather than from zero", () => {
    // `top-3` means 12px from the VIEWPORT, which on a notched phone is
    // inside the cutout. It must mean 12px below the safe area.
    const modal = read("components/ui/modal.tsx");
    expect(modal).toContain("top-[calc(env(safe-area-inset-top,0px)+0.75rem)]");
    expect(modal).not.toMatch(/\btop-3\b/);
  });

  it("keeps the desktop offset, where there is no notch to clear", () => {
    // sm:top-16 is a design choice on a laptop, not a safe-area concern.
    const modal = read("components/ui/modal.tsx");
    expect(modal).toContain("sm:top-16");
  });
});

describe("bottom insets stay handled too", () => {
  it.each([
    "components/dashboard/home-settings-sheet.tsx",
    "components/dashboard/quick-controls-sheet.tsx",
    "components/socialize/skipped-people-sheet.tsx"
  ])("%s pads for the home indicator", (path) => {
    // The fix for the top must not have disturbed the bottom.
    expect(read(path)).toContain("env(safe-area-inset-bottom)");
  });

  it("keeps the tour card above the bottom navigation", () => {
    const runner = read("components/tours/tour-runner.tsx");
    expect(runner).toContain("env(safe-area-inset-bottom,0px)");
  });
});

describe("the wallpaper belongs to messages only", () => {
  it("is scoped by route rather than mounted shell-wide", () => {
    // It painted behind every screen. A conversation is the one surface where
    // a backdrop is the content's own setting; elsewhere it sits behind cards,
    // counts and controls that need a plain ground to stay legible.
    const shell = read("components/app-shell/app-shell.tsx");
    expect(shell).toContain('const WALLPAPER_PAGES: readonly string[] = ["/messages"]');
    expect(shell).toContain("{showsWallpaper ? (");
  });
});
