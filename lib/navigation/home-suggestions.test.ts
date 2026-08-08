import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const home = read("components/dashboard/dashboard-page.tsx");

const card = home.slice(home.indexOf("function SuggestionCard"), home.indexOf("function QuickActionTile"));
const rail = home.slice(home.indexOf("function QuickActionsHome"), home.indexOf("function SuggestionCard"));
const firstTime = home.slice(home.indexOf("function FirstTimeQuickActions"), home.indexOf("type QuickAction"));

// ---------------------------------------------------------------------------
// Refactor, not a parallel implementation
// ---------------------------------------------------------------------------

describe("Suggestions refactor", () => {
  it("replaces the Quick actions section rather than adding a new widget", () => {
    expect(home).toContain("Suggestions for you");
    expect(home).not.toMatch(/>\s*Quick actions\s*<\/h2>/);
    // The old dense tile grid is gone from the Home RAIL. The More sheet
    // deliberately keeps its compact tile grid — it is a full feature list,
    // not a suggestion surface.
    const railOnly = rail.slice(0, rail.indexOf("<Modal"));
    expect(railOnly).not.toContain("grid-cols-4");
    expect(railOnly).not.toContain("min-h-[92px]");
  });

  it("reuses the existing action data rather than a second list", () => {
    expect(home).toContain("const quickActions: QuickAction[]");
    expect(home).toContain("splitQuickActions");
    // One suggestion card component serves both the returning and first-time rails.
    expect(rail).toContain("<SuggestionCard");
    expect(firstTime).toContain("<SuggestionCard");
  });

  it("keeps the shipped walkthrough target attached to a real element", () => {
    // supabase/migrations/20260801120000_feature_walkthroughs.sql references
    // 'home-quick-actions', so the id must still resolve after the rename.
    expect(rail).toContain("data-tour-id={TOUR_TARGET_IDS.HOME_QUICK_ACTIONS}");
    expect(firstTime).toContain("data-tour-id={TOUR_TARGET_IDS.HOME_QUICK_ACTIONS}");
    expect(read("lib/tours/registry.ts")).toContain('HOME_QUICK_ACTIONS: "home-quick-actions"');
  });

  it("keeps the More sheet for everything not on the rail", () => {
    expect(rail).toContain("<Modal");
    expect(rail).toContain("variant=\"sheet\"");
  });
});

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

describe("Suggestions header", () => {
  it("uses the canonical section-header pattern", () => {
    // Step 8 moved the markup into the shared component; the styling lives
    // there now and this asserts the section actually uses it.
    expect(rail).toContain("<PageSectionHeader");
    expect(rail).toContain('title="Suggestions for you"');
    const sectionHeader = read("components/app-shell/page-section-header.tsx");
    expect(sectionHeader).toContain("text-[1.75rem] font-bold leading-none tracking-tight");
    expect(sectionHeader).toContain("text-base font-medium text-[var(--color-brand-orange)]");
  });

  it("only offers See all when there is more to see", () => {
    // The action is omitted when nothing else is available.
    expect(rail).toContain("onAction={secondary.length > 0 ? () => setMoreOpen(true) : undefined}");
  });
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe("Suggestions layout", () => {
  it("is a horizontal rail that never wraps", () => {
    expect(rail).toContain("overflow-x-auto");
    expect(card).toContain("shrink-0");
    expect(rail).not.toContain("flex-wrap");
  });

  it("has no carousel indicators and no snapping", () => {
    expect(rail).not.toContain("snap-x");
    expect(rail).not.toContain('aria-roledescription="carousel"');
  });

  it("hides the scrollbar for a native feel", () => {
    expect(rail).toContain("[&::-webkit-scrollbar]:hidden");
  });

  it("sizes cards so a later one peeks from the right edge", () => {
    expect(card).toContain("w-[7.75rem]");
    expect(card).toContain("peeking");
  });

  it("bleeds to the screen edge so the last card scrolls fully into view", () => {
    expect(rail).toContain("-mx-4");
    expect(rail).toContain("px-4");
  });
});

// ---------------------------------------------------------------------------
// Visual style
// ---------------------------------------------------------------------------

describe("Suggestion card style", () => {
  it("gives each suggestion its own soft pastel surface", () => {
    expect(home).toContain("const SUGGESTION_TONE");
    for (const tone of ["orange", "lavender", "green", "blue", "blush"]) {
      expect(home, `missing tone ${tone}`).toContain(`${tone}:`);
    }
  });

  it("keeps the pastels unsaturated in both themes", () => {
    const tones = home.slice(home.indexOf("const SUGGESTION_TONE"), home.indexOf("const quickActions"));
    // Low-alpha washes, never solid fills.
    expect(tones).toMatch(/bg-\w+-500\/\[0\.09\]/);
    expect(tones).toMatch(/dark:bg-\w+-400\/\[0\.12\]/);
    // No heavy gradients.
    expect(tones).not.toContain("bg-gradient");
  });

  it("uses a generous radius, soft shadow and very subtle border", () => {
    expect(card).toContain("rounded-[1.25rem]");
    expect(card).toContain("border border-black/[0.04]");
    expect(card).toContain("dark:border-white/[0.06]");
    expect(card).toContain("shadow-[0_1px_3px_hsl(var(--shadow)/0.05)]");
  });
});

// ---------------------------------------------------------------------------
// Content + icons
// ---------------------------------------------------------------------------

describe("Suggestion card content", () => {
  it("renders an icon chip, a title and one short sentence", () => {
    expect(card).toContain("{action.label}");
    expect(card).toContain("{action.suggestion}");
    expect(card).toContain("rounded-[0.625rem]");
  });

  it("puts the icon inside a soft rounded coloured container", () => {
    expect(card).toContain("grid h-8 w-8 shrink-0 place-items-center rounded-[0.625rem]");
    expect(card).toContain("tone.icon");
  });

  it("keeps one icon size across every card", () => {
    const sizes = card.match(/h-\[18px\] w-\[18px\]/g) ?? [];
    expect(sizes.length).toBe(1);
  });

  it("uses Lucide icons from the existing action data, not new illustrations", () => {
    expect(card).toContain("const Icon = action.icon;");
    expect(card).not.toContain("<Image");
    expect(card).not.toContain(".svg");
  });

  it("clamps long titles and sentences rather than growing the card", () => {
    expect(card).toContain("line-clamp-2 text-[0.8125rem] font-semibold");
    expect(card).toContain("line-clamp-2 text-[0.75rem]");
  });

  it("carries recommendation copy distinct from the feature description", () => {
    expect(home).toContain('suggestion: "See who is up for something."');
    expect(home).toContain('suggestion: "Grow your trusted circle."');
    expect(home).toContain('suggestion: "Bring people together."');
    expect(home).toContain("suggestion: \"See what’s happening nearby.\"");
  });
});

// ---------------------------------------------------------------------------
// Recommendation rendering
// ---------------------------------------------------------------------------

describe("Suggestion rendering", () => {
  it("renders whatever it is given, holding no ranking of its own", () => {
    // The index is the sweep position only — the ORDER is still whatever
    // `primary` arrives as.
    expect(rail).toContain("{primary.map((action, index) => (");
    expect(rail).not.toContain(".sort(");
    expect(rail).not.toContain("Math.random");
  });

  it("only recommends routes that already exist", () => {
    const actions = home.slice(home.indexOf("const quickActions"), home.indexOf("PRIMARY_ACTION_HREFS"));
    for (const href of ["/hangout-mode", "/invites", "/plans?create=1", "/events"]) {
      expect(actions).toContain(`href: "${href}"`);
    }
  });

  it("still respects Owner feature flags", () => {
    expect(home).toContain("quickActions.filter((action) => !hiddenHrefs.includes(action.href))");
  });

  it("hides the section entirely when nothing is available", () => {
    expect(rail).toContain("if (primary.length === 0) return null;");
  });
});

// ---------------------------------------------------------------------------
// Interaction + accessibility
// ---------------------------------------------------------------------------

describe("Suggestion interaction", () => {
  it("makes the whole card tappable", () => {
    expect(card).toContain("<Link");
    expect(card).toContain("href={action.href}");
  });

  it("lifts subtly on press with no bounce", () => {
    expect(card).toContain("active:scale-[0.98]");
    expect(card).toContain("active:shadow-[0_4px_14px_hsl(var(--shadow)/0.12)]");
    expect(card).not.toContain("animate-bounce");
  });

  it("respects reduced motion", () => {
    expect(card).toContain("motion-reduce:transition-none");
    expect(card).toContain("motion-reduce:active:scale-100");
  });

  it("labels each card with the action and why it is suggested", () => {
    expect(card).toContain("aria-label={`${action.label}. ${action.suggestion}`}");
  });

  it("keeps a visible keyboard focus ring", () => {
    expect(card).toContain("focus-ring");
  });
});
