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
const topEvents = read("components/events/top-events-home.tsx");

// ---------------------------------------------------------------------------
// Section headers — one component, no duplicates
// ---------------------------------------------------------------------------

describe("section headers", () => {
  it("uses the shared component everywhere", () => {
    // Near, My Plans (+ empty), Suggestions (+ first-time), and "Next for you".
    // Trending lives in its own module component, counted below rather than here.
    const uses = home.match(/<PageSectionHeader/g) ?? [];
    expect(uses.length).toBe(6);
    expect(moments).toContain("<PageSectionHeader");
    expect(topEvents).toContain("<PageSectionHeader");
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
    for (const title of ["Near", "My Plans", "Suggestions for you"]) {
      expect(home, `missing section: ${title}`).toContain(`title="${title}"`);
    }
    expect(moments).toContain('title="Moments"');
    expect(topEvents).toContain(`title="Trending"`);
  });

  it("never labels two Home sections as the same kind of upcoming", () => {
    // "Upcoming Plans" next to ranked "Upcoming Events" read as variants of
    // one another (Ranked Events Discovery). Personal commitments are now
    // "My Plans"; discovery is "Trending".
    expect(home).not.toContain('title="Upcoming Plans"');
    expect(home).not.toContain('title="Upcoming Events"');
  });

  it("renders one personal agenda section", () => {
    expect(home).not.toContain('title="My Upcoming"');
    expect(home).toContain("<PlanStack plans={agendaItems}");
  });

  it("hides the action when there is nothing to see", () => {
    // Empty Plans and the first-time Suggestions set render title-only.
    expect(home).toContain('<PageSectionHeader id="home-plan-heading" title="My Plans" />');
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
    for (const prop of ["smartCard={smartCard}", "agendaItems={", "moments={"]) {
      expect(page, `${prop} should be server-rendered`).toContain(prop);
    }
  });

  it("matches the real column footprint so nothing resizes", () => {
    /* Anchored to the skeleton BLOCK, not the exact condition text. The
     * condition gained a server-count clause when Home stopped claiming an
     * empty room over the server's own answer; the footprint rule it protects
     * is unchanged. */
    const skeleton = home.slice(
      home.indexOf("Lightweight skeletons matching the real column footprint"),
      home.indexOf("A bare horizontal rail")
    );
    expect(skeleton).toContain("w-[4.75rem] shrink-0");
    expect(skeleton).toContain("h-16 w-16");
  });

  it("uses no large spinner", () => {
    /* Anchored to the skeleton BLOCK, not the exact condition text. The
     * condition gained a server-count clause when Home stopped claiming an
     * empty room over the server's own answer; the footprint rule it protects
     * is unchanged. */
    const skeleton = home.slice(
      home.indexOf("Lightweight skeletons matching the real column footprint"),
      home.indexOf("A bare horizontal rail")
    );
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
    /* Both surfaces show a first name and announce the full one.
     *
     * This test's TITLE has always stated the rule, and the Moments tile has
     * always followed it (`${fullName}`). The Home assertion, however, pinned
     * `capitalize(firstName(name))` — the truncated form — which contradicted
     * the title it sat under. Home was the surface out of step with the
     * codebase's own principle, not the principle that needed changing
     * (MB-GOD-045).
     *
     * Visible text stays first-name on both: Home's Near column is 4.75rem
     * wide and a full name would break the grid. */
    expect(home).toContain("aria-label={`${friend.displayName || friend.username}");
    expect(momentTile).toContain("${fullName}");
    // And the visible labels must still be the short form.
    expect(home).toContain("{capitalize(firstName(name))}");
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

// ---------------------------------------------------------------------------
// Home section order
// ---------------------------------------------------------------------------

describe("Trending sits above My Plans", () => {
  const home = readFileSync(join(process.cwd(), "components/dashboard/dashboard-page.tsx"), "utf8");

  /**
   * Discovery outranks recall. Trending Events are the thing you do not
   * already know about; My Plans is a reminder of commitments you made
   * yourself, so it reads better underneath.
   */
  it("renders Top Events before the plan stack", () => {
    const trendingAt = home.indexOf("<TopEventsHome events={topEvents} />");
    const plansAt = home.indexOf("<PlanStack plans={agendaItems}");
    expect(trendingAt).toBeGreaterThan(-1);
    expect(plansAt).toBeGreaterThan(-1);
    expect(trendingAt).toBeLessThan(plansAt);
  });

  it("keeps both sections on Home", () => {
    // Reordering must not drop either one.
    expect((home.match(/<TopEventsHome/g) ?? []).length).toBe(1);
    expect((home.match(/<PlanStack/g) ?? []).length).toBe(1);
  });

  it("keeps the Smart Card above both", () => {
    const heroAt = home.indexOf("<SmartCardHero card={smartCard} />");
    expect(heroAt).toBeLessThan(home.indexOf("<TopEventsHome events={topEvents} />"));
  });
});
