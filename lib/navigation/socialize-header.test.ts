import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * The Socialize header.
 *
 * Socialize 2.0 replaced the radar — and the bespoke immersive header that
 * existed to sit on it — with a scrolling discovery feed. This suite was
 * rewritten rather than patched: the old assertions pinned the exact markup of
 * a header that no longer exists, and editing a source assertion until it
 * passes tests nothing.
 *
 * What is still worth asserting is the SHAPE: one calm header, a live count,
 * and no second title competing with it.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const feed = stripComments(read("components/socialize/discovery-feed.tsx"));
const page = stripComments(read("components/socialize/socialize-page.tsx"));
const appShell = stripComments(read("components/app-shell/app-shell.tsx"));

describe("socialize header", () => {
  it("is one calm header with the product name", () => {
    expect(feed).toContain("Socialize");
    expect(feed).toContain("<h1");
  });

  it("shows a live nearby count rather than a static subtitle", () => {
    // The count is the thing that makes the screen feel alive; it comes from
    // the authorised projection, never a fabricated number. It lives in the
    // hero, which owns both the OFF and ON states.
    const hero = stripComments(read("components/socialize/socialize-hero.tsx"));
    expect(hero).toContain('{total === 1 ? "person" : "people"} nearby');
    expect(feed).toContain("Find people nearby who are open to connecting");
  });

  it("carries exactly one h1", () => {
    // The page's own header was removed when the feed took over the title, so
    // the screen can never show two.
    expect((feed.match(/<h1/g) ?? []).length).toBe(1);
    expect(page).not.toContain("<h1");
  });

  it("offers a settings affordance at a 44px target", () => {
    // The standalone settings link moved into Quick Controls, which already
    // carries /settings/glow-visibility — the header keeps one control per
    // job rather than a second route to the same page.
    expect(feed).toContain('aria-label="Quick controls"');
    expect(feed).toContain("h-11 w-11");
    const sheet = read("components/dashboard/quick-controls-sheet.tsx");
    expect(sheet).toContain('href="/settings/glow-visibility"');
  });

  it("pins its own header and reserves exactly its footprint", () => {
    // /discover renders its own header rather than the shell's, so it stays
    // out of IMMERSIVE_HEADER_PAGES' fixed-header offset. That header is now
    // FIXED like the canonical one, so the page reserves its height instead
    // of only the notch.
    expect(appShell).toContain('IMMERSIVE_HEADER_PAGES: readonly string[] = ["/discover"]');
    expect(page).toContain("pt-[calc(env(safe-area-inset-top,0px)+4.25rem)]");
  });

  it("fixes the header to the viewport rather than sticking it in the scroll container", () => {
    // Pull-to-refresh transforms that container, and a transformed ANCESTOR
    // re-bases sticky onto itself — the header would ride down with the pull.
    expect(feed).toContain("fixed inset-x-0 top-0 z-40");
    expect(feed).not.toContain("sticky top-0");
  });

  it("keeps the header opaque, so nothing bleeds through from behind", () => {
    // Content passes underneath a fixed header; a translucent surface shows
    // cards and ambient artwork moving behind the title.
    expect(feed).toContain("bg-background dark:bg-[#111112]");
    expect(feed).not.toContain("backdrop-blur");
  });

  it("clears the notch exactly once, in the header itself", () => {
    expect(feed).toContain("pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]");
  });

});
