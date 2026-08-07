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
    expect(feed).toContain('aria-label="Discovery settings"');
    expect(feed).toContain("h-11 w-11");
  });

  it("reserves no fixed-header height, and clears the notch once", () => {
    // /discover takes the canonical header like every other root destination.
    // The header scrolls with the feed, so no fixed-header height is
    // reserved and the page clears the notch exactly once itself.
    expect(appShell).toContain('IMMERSIVE_HEADER_PAGES: readonly string[] = ["/discover"]');
    expect(page).toContain("env(safe-area-inset-top)");
  });

});
