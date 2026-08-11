import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const home = read("components/dashboard/dashboard-page.tsx");
const moments = read("components/content/moments-preview.tsx");
// The card moved into the shared tile, reused by Home and the Moments page.
const momentTile = read("components/content/moment-tile.tsx");
const header = read("components/app-shell/page-section-header.tsx");
const page = read("app/(app)/dashboard/page.tsx");

// ---------------------------------------------------------------------------
// Section headers — one component, no duplicates
// ---------------------------------------------------------------------------

describe("section headers", () => {
  it("uses the shared component everywhere", () => {
    // Near, Upcoming Plans (+ empty), My Upcoming (Plans + Events lifecycle,
    // Stage C -- conditional on an Event being present), Suggestions
    // (+ first-time).
    const uses = home.match(/<PageSectionHeader/g) ?? [];
    expect(uses.length).toBe(6);
    expect(moments).toContain("<PageSectionHeader");
  });

  it("leaves no hand-written duplicate header markup", () => {
    // The title styling lives in one place now.
    for (const [name, source] of [["Home", home], ["Moments", moments]] as const) {
      expect(source, `${name} still hand-writes a section title`).not.toContain(
        'className="text-[1.75rem] font-bold leading-none tracking-tight"'
      );
    }
    expect(header).toContain("text-[1.75rem] font-bold leading-none tracking-tight");
  });

  it("styles the link and button actions identically", () => {
    // A section that opens a sheet must look the same as one that navigates.
    const actionClass = header.match(/const actionClass\s*=\s*\n?\s*"([^"]+)"/)?.[1] ?? "";
    expect(actionClass).toContain("text-[var(--color-brand-orange)]");
    expect(actionClass).toContain("focus-ring");
    // One constant, used by both branches.
    expect((header.match(/className=\{actionClass\}/g) ?? []).length).toBe(2);
  });

  it("carries the approved titles", () => {
    for (const title of ["Near", "Upcoming Plans", "My Upcoming", "Suggestions for you"]) {
      expect(home, `missing section: ${title}`).toContain(`title="${title}"`);
    }
    expect(moments).toContain('title="Moments"');
  });

  it("shows My Upcoming only once an Event is actually in the agenda", () => {
    // A Plans-only viewer, which is most of them, must not see a second
    // plainer list duplicating what the PlanStack above already shows.
    expect(home).toContain('agendaItems.some((item) => item.kind === "event")');
  });

  it("hides the action when there is nothing to see", () => {
    // Empty Plans and the first-time Suggestions set render title-only.
    expect(home).toContain('<PageSectionHeader id="home-plan-heading" title="Upcoming Plans" />');
    expect(home).toContain('<PageSectionHeader id="home-actions-heading" title="Suggestions for you" />');
  });

  it("gives every section a heading its region points at", () => {
    for (const id of ["home-nearby-heading", "home-plan-heading", "home-actions-heading"]) {
      expect(home).toContain(`aria-labelledby="${id}"`);
      expect(home).toContain(`id="${id}"`);
    }
    expect(moments).toContain('aria-labelledby="home-moments-heading"');
  });
});

// ---------------------------------------------------------------------------
// Rails — same geometry, deliberate gap differences
// ---------------------------------------------------------------------------

describe("horizontal rails", () => {
  const rails = [
    ...(home.match(/-mx-4 flex[^"]*sm:-mx-6 sm:px-6/g) ?? []),
    ...(moments.match(/-mx-4 flex[^"]*sm:-mx-6 sm:px-6/g) ?? [])
  ];

  it("finds every rail on Home", () => {
    // Near (skeleton + real), Suggestions (first-time + returning), Moments
    // (rail + onboarding).
    expect(rails.length).toBe(6);
  });

  it("shares the same edge bleed and content alignment", () => {
    for (const rail of rails) {
      expect(rail).toContain("-mx-4");
      expect(rail).toContain("px-4");
      expect(rail).toContain("sm:-mx-6");
      expect(rail).toContain("sm:px-6");
    }
  });

  it("hides the scrollbar on every scrolling rail", () => {
    const scrolling = rails.filter((rail) => rail.includes("overflow-x-auto"));
    expect(scrolling.length).toBeGreaterThanOrEqual(4);
    for (const rail of scrolling) {
      expect(rail).toContain("[&::-webkit-scrollbar]:hidden");
      expect(rail).toContain("[scrollbar-width:none]");
    }
  });

  it("keeps the Near skeleton on the same gap as the real rail", () => {
    // A different gap shifted every avatar sideways when data arrived.
    const nearRails = rails.filter((rail) => rail.includes("items-start"));
    expect(nearRails.length).toBe(2);
    expect(new Set(nearRails.map((rail) => /gap-[\d.]+/.exec(rail)?.[0])).size).toBe(1);
  });

  it("does not force identical gaps across sections with different purposes", () => {
    // Near carries 64px avatars and needs more air than the card rails; the
    // brief explicitly allows this.
    expect(rails.some((rail) => rail.includes("gap-4"))).toBe(true);
    expect(rails.some((rail) => rail.includes("gap-2.5"))).toBe(true);
  });

  it("never lets a rail drag trigger pull-to-refresh", () => {
    const ptr = read("components/ui/pull-to-refresh.tsx");
    expect(ptr).toContain("node.scrollWidth > node.clientWidth");
    expect(ptr).toContain("deltaX > Math.abs(deltaY)");
  });
});

// ---------------------------------------------------------------------------
// Loading — only what can actually flash
// ---------------------------------------------------------------------------

describe("loading states", () => {
  it("skeletons the one section that is fetched after mount", () => {
    // Nearby is client-fetched; everything else arrives as a server prop with
    // the HTML and therefore cannot flash.
    expect(home).toContain("loadNearbyFriends()");
    expect(home).toContain("animate-pulse");
    for (const prop of ["smartCard={smartCard}", "upcomingPlans={", "moments={"]) {
      expect(page, `${prop} should be server-rendered`).toContain(prop);
    }
  });

  it("matches the real column footprint so nothing resizes", () => {
    const skeleton = home.slice(home.indexOf("!loaded && total === 0"), home.indexOf("A bare horizontal rail"));
    expect(skeleton).toContain("w-[4.75rem] shrink-0");
    expect(skeleton).toContain("h-16 w-16");
  });

  it("uses no large spinner", () => {
    const skeleton = home.slice(home.indexOf("!loaded && total === 0"), home.indexOf("A bare horizontal rail"));
    expect(skeleton).not.toContain("Loader2");
    expect(skeleton).not.toContain("animate-spin");
  });

  it("respects reduced motion", () => {
    expect(home).toContain("motion-reduce:animate-none");
  });
});

// ---------------------------------------------------------------------------
// Empty states — approved behaviour, no large cards
// ---------------------------------------------------------------------------

describe("empty states", () => {
  it("keeps Near and Plans inline and lightweight", () => {
    expect(home).toContain("No trusted Muddies nearby.");
    expect(home).toContain("No upcoming Plans.");
    // No glass-panel cards or tall padding in either.
    const nearEmpty = home.slice(home.indexOf("No trusted Muddies nearby"));
    expect(nearEmpty.slice(0, 600)).not.toContain("glass-panel");
  });

  it("hides Suggestions entirely when nothing applies", () => {
    expect(home).toContain("if (primary.length === 0) return null;");
  });

  it("shows the educational experience only when Moments is empty", () => {
    expect(moments).toContain("if (!somethingExists)");
    expect(moments).toContain("Share Moments");
  });
});

// ---------------------------------------------------------------------------
// Interaction consistency
// ---------------------------------------------------------------------------

describe("press feedback", () => {
  it("uses one restrained scale across Home", () => {
    // 0.98/0.99 only — no bounce, no tilt, no confetti.
    const scales = new Set(
      [...home.matchAll(/active:scale-\[([\d.]+)\]/g)].map((match) => match[1])
    );
    for (const scale of scales) {
      expect(Number(scale)).toBeGreaterThanOrEqual(0.97);
      expect(Number(scale)).toBeLessThan(1);
    }
  });

  it("never animates continuously", () => {
    for (const [name, source] of [["Home", home], ["Moments", moments]] as const) {
      expect(source, `${name} must not bounce`).not.toContain("animate-bounce");
      expect(source, `${name} must not spin decoratively`).not.toContain("animate-spin");
    }
  });

  it("pairs every press animation with a reduced-motion opt-out", () => {
    const pressed = (home.match(/active:scale-\[[\d.]+\]/g) ?? []).length;
    const guarded = (home.match(/motion-reduce:active:scale-100/g) ?? []).length;
    expect(guarded).toBeGreaterThanOrEqual(pressed - 1);
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe("accessibility", () => {
  it("keeps one h1 and section h2s beneath it", () => {
    const semanticH1Count = (home.match(/<h1/g) ?? []).length +
      (home.match(/<SplitText[\s\S]*?tag="h1"/g) ?? []).length;
    expect(semanticH1Count).toBe(1);
    expect(header).toContain("<h2");
  });

  it("announces full names even where the UI truncates", () => {
    // Near shows a first name; Moments shows a first name.
    expect(home).toContain("aria-label={`${capitalize(firstName(name))}");
    expect(momentTile).toContain("${fullName}");
  });

  it("hides decoration from assistive technology", () => {
    expect(home).toContain('aria-hidden="true"');
    expect(moments).toContain('aria-hidden="true"');
  });

  it("keeps a visible keyboard focus ring on every tappable surface", () => {
    for (const [name, source] of [["Home", home], ["Moments", moments], ["header", header]] as const) {
      expect(source, `${name} needs focus-ring`).toContain("focus-ring");
    }
  });
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe("performance", () => {
  it("caps what each rail renders", () => {
    expect(page).toContain("HOME_MOMENTS_LIMIT");
    expect(home).toContain("NEARBY_MAX_POSITIONS");
  });

  it("lazy-loads Moments images except the first", () => {
    expect(moments).toContain("priority={index === 0}");
  });

  it("loads Home data in one parallel batch", () => {
    expect(page).toContain("await Promise.all([");
  });

  it("does not refetch the shell's unread count per section", () => {
    // One shared context, resolved once by AppShell.
    expect(home).toContain("useUnreadNotifications()");
    expect(home).not.toContain("/api/notifications/unread-count");
  });
});
