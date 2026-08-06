import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const page = read("components/socialize/socialize-page.tsx");
const shell = read("components/app-shell/app-shell.tsx");

/**
 * The header and intro only.
 *
 * Bounded at the Socializing status control (Step 2), not at the radar:
 * anything after the intro belongs to a later step, and letting it into this
 * slice would make these assertions pass or fail on unrelated markup.
 */
const header = page.slice(page.indexOf("<header"), page.indexOf("Socializing status control"));

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe("Socialize header structure", () => {
  it("is Back, title, Info", () => {
    expect(header.indexOf('aria-label="Back"')).toBeGreaterThan(-1);
    expect(header.indexOf("Socialize</h1>")).toBeGreaterThan(header.indexOf('aria-label="Back"'));
    expect(header.indexOf('aria-label="About Socialize"')).toBeGreaterThan(header.indexOf("Socialize</h1>"));
  });

  it("centres the title on the header, not between the controls", () => {
    // Both controls are absolutely positioned, so the title stays optically
    // centred whatever they contain.
    expect(header).toContain("relative flex min-h-[44px] items-center justify-center");
    expect(header).toContain("absolute left-0");
    expect(header).toContain("absolute right-0");
  });

  it("uses a single strong line for the title", () => {
    expect(header).toContain('<h1 className="text-[1.75rem] font-bold leading-none tracking-tight">Socialize</h1>');
  });

  it("adds no divider and no opaque card", () => {
    expect(header).not.toContain("border-b");
    expect(header).not.toContain("backdrop-blur");
    expect(header).not.toContain("bg-card");
    expect(header).not.toContain("shadow");
  });
});

// ---------------------------------------------------------------------------
// Intro copy
// ---------------------------------------------------------------------------

describe("Socialize intro", () => {
  it("uses the approved shorter sentence", () => {
    expect(page).toContain("Meet people nearby who are open to connecting.");
  });

  it("does not use the longer wording", () => {
    expect(page).not.toContain("who are also open to connecting");
  });

  it("is centred, muted and comfortably set", () => {
    expect(header).toContain("text-center text-[1.0625rem] leading-relaxed text-muted-foreground");
  });

  it("is constrained so it wraps to at most two lines", () => {
    expect(header).toContain("max-w-[19rem]");
  });

  it("sits close enough to the title to read as one introduction", () => {
    // 12px under the title, then a larger gap before the radar.
    expect(header).toContain("mt-3");
  });
});

// ---------------------------------------------------------------------------
// Safe area — cleared exactly once
// ---------------------------------------------------------------------------

describe("safe area", () => {
  it("clears the top inset on the page itself", () => {
    expect(page).toContain("pt-[max(0.5rem,env(safe-area-inset-top))]");
  });

  it("stops AppShell reserving a fixed header's height for this route", () => {
    // Socialize draws its header INLINE, so the reservation would have shown
    // as an empty band above the title — the duplicated top padding.
    expect(shell).toContain('const IMMERSIVE_HEADER_PAGES = ["/discover"] as const;');
    expect(shell).toContain("hasImmersiveHeader(pathname)");
    expect(shell).toContain('? "pt-0"');
  });

  it("still stands the global header down", () => {
    // /discover remains in PAGES_WITH_OWN_HEADER, so no second header renders.
    const list = shell.slice(shell.indexOf("const PAGES_WITH_OWN_HEADER"), shell.indexOf("function hasOwnHeader"));
    expect(list).toContain('"/discover"');
  });

  it("does not re-add its own top padding on top of the inset", () => {
    const container = page.slice(page.indexOf('className="mx-auto flex w-full max-w-[520px]'), page.indexOf("<header"));
    expect(container).not.toContain("pt-3");
    expect(container).not.toContain("pt-4");
  });
});

// ---------------------------------------------------------------------------
// Targets and sizing
// ---------------------------------------------------------------------------

describe("controls", () => {
  it("gives both actions a 44px touch target", () => {
    expect((header.match(/h-11 w-11/g) ?? []).length).toBe(2);
  });

  it("uses one consistent 22px icon size", () => {
    expect((header.match(/h-\[22px\] w-\[22px\]/g) ?? []).length).toBe(2);
  });

  it("presses subtly and respects reduced motion", () => {
    expect((header.match(/active:scale-90/g) ?? []).length).toBe(2);
    expect((header.match(/motion-reduce:active:scale-100/g) ?? []).length).toBe(2);
  });

  it("keeps a visible keyboard focus ring on both", () => {
    expect((header.match(/focus-ring/g) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

describe("header behaviour", () => {
  it("goes back, falling back to an established destination on a cold load", () => {
    expect(page).toContain("window.history.length > 1");
    expect(page).toContain("router.back();");
    expect(page).toContain('router.push("/dashboard");');
  });

  it("opens the existing safety information rather than a second sheet", () => {
    expect(page).toContain('router.push("/safety-center")');
    // No new information surface was introduced for this step.
    expect(stripComments(page)).not.toContain("AboutSocializeSheet");
  });

  it("leaves the radar below it intact", () => {
    // Step 1 changed the header only. Step 3 later rebuilt the radar's
    // geometry, so this asserts the radar still exists below the header
    // rather than pinning the placement implementation.
    expect(page).toContain("TOUR_TARGET_IDS.SOCIALIZE_RADAR");
    expect(page).toContain("buildRadarField");
  });

  it("leaves the radar breathing room below the intro", () => {
    expect(page).toContain('"relative mt-5 w-full"');
  });
});
