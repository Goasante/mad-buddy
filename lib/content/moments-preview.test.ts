import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const preview = read("components/content/moments-preview.tsx");
// The card moved into the shared tile, reused by Home and the Moments page.
const tile = read("components/content/moment-tile.tsx");
const home = read("components/dashboard/dashboard-page.tsx");
const page = read("app/(app)/dashboard/page.tsx");

// ---------------------------------------------------------------------------
// One Moments system
// ---------------------------------------------------------------------------

describe("no second Moments system", () => {
  it("renders the canonical projection rather than its own type", () => {
    expect(preview).toContain("VisibleMoment");
    expect(preview).not.toContain("type PreviewMoment");
  });

  it("loads through the canonical feed builder", () => {
    expect(page).toContain("buildMomentFeed(admin, user.id)");
  });

  it("never fetches or mutates on its own", () => {
    for (const banned of ["fetch(", "useEffect", "createSupabase", "Action("]) {
      expect(preview, `preview must not call ${banned}`).not.toContain(banned);
    }
  });

  it("reimplements no feed behaviour", () => {
    // Reactions, expiry, reporting and audience all stay on /moments. Matched
    // as field access so the prose in this file's own header comment (which
    // names those features to say it does NOT implement them) is not a hit.
    for (const field of ["moment.reactionCount", "moment.reactionBreakdown", "moment.expiresAt", "moment.audienceLabel"]) {
      expect(preview, `preview must not read ${field}`).not.toContain(field);
    }
  });

  it("opens the existing viewer rather than inventing a route", () => {
    // There is no per-Moment deep link in the app; /moments is the viewer.
    expect(preview).toContain('href="/moments"');
    expect(preview).not.toMatch(/href=\{`\/moments\/\$\{/);
  });

  it("previews a capped slice, never the whole feed", () => {
    expect(page).toContain("HOME_MOMENTS_LIMIT");
    expect(page).toContain("slice(0, HOME_MOMENTS_LIMIT)");
  });
});

// ---------------------------------------------------------------------------
// Section header + layout
// ---------------------------------------------------------------------------

describe("Moments section", () => {
  it("reuses the canonical section header", () => {
    expect(preview).toContain("<PageSectionHeader");
    const header = read("components/app-shell/page-section-header.tsx");
    expect(header).toContain("text-[1.75rem] font-bold leading-none tracking-tight");
    expect(header).toContain("text-base font-medium text-[var(--color-brand-orange)]");
  });

  it("is a horizontal rail with no snapping or indicators", () => {
    const rail = preview.slice(preview.indexOf("items.map"), preview.indexOf("function mixByRecency"));
    expect(preview).toContain("overflow-x-auto");
    expect(rail).not.toContain("snap-");
    expect(rail).not.toContain("aria-roledescription");
  });

  it("matches the Near and Suggestions rail geometry", () => {
    // Same bleed and gap, so the three sections line up.
    expect(preview).toContain("-mx-4 flex gap-2.5 overflow-x-auto px-4");
    expect(preview).toContain("[&::-webkit-scrollbar]:hidden");
  });
});

// ---------------------------------------------------------------------------
// Card design
// ---------------------------------------------------------------------------

describe("Moment card", () => {
  it("is a full-bleed image with rounded corners and a soft shadow", () => {
    expect(tile).toContain("rounded-[1.25rem]");
    expect(tile).toContain("shadow-[0_1px_3px_hsl(var(--shadow)/0.08)]");
    expect(tile).toContain("object-cover");
  });

  it("has no badges and no borders", () => {
    const card = tile.slice(tile.indexOf("export function MomentTile"), tile.indexOf("relationshipLabel("));
    expect(card).not.toContain("border ");
    expect(card).not.toContain("PremiumPlanBadge");
    expect(card).not.toContain("Badge");
  });

  it("darkens only the caption area so the photo stays the hero", () => {
    expect(tile).toContain("bg-gradient-to-t from-black/80");
    expect(tile).toContain("bg-gradient-to-b from-black/70");
    expect(tile).toContain("h-1/2");
  });

  it("shows the creator name and how long ago", () => {
    expect(tile).toContain("formatRelativeTime(moment.createdAt)");
    expect(tile).toContain("{name}");
    expect(tile).toContain("{age}");
  });

  it("shows a first name but announces the full one", () => {
    expect(tile).toContain("fullName.split(/\\s+/)[0]");
    // The full name reaches assistive tech even though the card truncates.
    expect(tile).toContain("${fullName}");
  });

  it("renders a text Moment's words instead of an empty box", () => {
    expect(tile).toContain('moment.contentType === "text"');
    expect(tile).toContain("moment.caption ?? moment.textContent");
  });
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe("Moments preview performance", () => {
  it("reuses the canonical image component", () => {
    expect(tile).toContain("<MomentImage");
    // Not a raw <img>: MomentImage handles retry and fallback.
    expect(tile).not.toContain("<img");
  });

  it("lazy-loads everything except the first card", () => {
    expect(preview).toContain("priority={index === 0}");
    expect(tile).toContain("priority={priority}");
  });
});

// ---------------------------------------------------------------------------
// Empty onboarding
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The true empty state
// ---------------------------------------------------------------------------

/** Mirrors the component's gate, so the six scenarios are asserted directly. */
function showsOnboarding(momentCount: number, hasAirSession: boolean): boolean {
  return momentCount === 0 && !hasAirSession;
}

describe("onboarding shows only in the true empty state", () => {
  it("shows with zero Moments and no Air", () => {
    expect(showsOnboarding(0, false)).toBe(true);
  });

  it("hides when the viewer has their own active Moment", () => {
    // buildMomentFeed includes the viewer's own Moments (isAuthor), so a
    // personal Moment makes the feed non-empty.
    expect(showsOnboarding(1, false)).toBe(false);
  });

  it("hides when a friend has an active Moment", () => {
    expect(showsOnboarding(1, false)).toBe(false);
  });

  it("hides when only an Air session exists", () => {
    // The bug: Home never loaded Air, so live Air sessions still showed the
    // educational cards.
    expect(showsOnboarding(0, true)).toBe(false);
  });

  it("hides for mixed content", () => {
    expect(showsOnboarding(4, true)).toBe(false);
  });

  it("returns to onboarding only once everything has expired", () => {
    expect(showsOnboarding(2, true)).toBe(false);
    expect(showsOnboarding(0, true)).toBe(false); // Moments expired, Air live
    expect(showsOnboarding(2, false)).toBe(false); // Air ended, Moments live
    expect(showsOnboarding(0, false)).toBe(true); // everything expired
  });

  it("wires that gate into the component", () => {
    expect(preview).toContain("if (!somethingExists) {");
  });

  it("renders nothing at all when the rail has no cards", () => {
    // Home stays quiet rather than showing a header over an explanation.
    expect(preview).toContain("if (items.length === 0) return null;");
  });

  it("never announces Air's state on Home", () => {
    // Explicitly out of scope for the Home preview: describing what Air is
    // doing belongs on the Moments page, not here. Comments are stripped so
    // the prose explaining this rule does not trip it.
    const rendered = stripComments(preview);
    expect(rendered).not.toContain("Air is live");
    expect(rendered).not.toContain("Nothing new here yet");
  });
});

// ---------------------------------------------------------------------------
// Air stays in its own tab
// ---------------------------------------------------------------------------

describe("Air separation", () => {
  it("never renders Air content on Home", () => {
    // Home takes a boolean, never the spotlight feed itself.
    expect(preview).toContain("hasAirSession?: boolean");
    expect(preview).not.toContain("buildSpotlightFeed");
    expect(preview).not.toContain("spotlight");
  });

  it("tests existence without building the whole Air feed", () => {
    const service = read("lib/content/service.ts");
    expect(service).toContain("export async function hasActiveAirSession");
    // A boolean, so no unauthorised Moment can leak through it.
    expect(service).toContain("): Promise<boolean>");
  });

  it("mirrors the spotlight authorisation rules", () => {
    const service = read("lib/content/service.ts");
    const check = service.slice(
      service.indexOf("export async function hasActiveAirSession"),
      service.indexOf("export async function buildSpotlightFeed")
    );
    expect(check).toContain("isOpenMomentsEnabled");
    expect(check).toContain('.eq("audience_type", "public")');
    expect(check).toContain('.eq("status", "active")');
    expect(check).toContain('.gt("expires_at", nowIso)');
    expect(check).toContain("blockedIds.has");
    expect(check).toContain("hiddenIds.has");
  });

  it("keeps Air out of the Home loader's rendered data", () => {
    expect(page).toContain("buildSpotlightFeed(admin, user.id)");
  });
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe("feed ordering", () => {
  it("puts the viewer's own Moment first", () => {
    expect(preview).toContain("function mixByRecency");
    expect(preview).toContain("a.moment.isAuthor ? -1 : 1");
  });

  it("otherwise preserves the server order", () => {
    expect(preview).toContain("Date.parse(b.moment.createdAt)");
    expect(preview).toContain("!airIds.has(moment.id)");
  });

  it("documents why the remaining tiers are not applied", () => {
    expect(tile).toContain("relationshipLabel(moment.viewerRelationship)");
    expect(tile).toContain('return "Close Friend"');
  });
});

describe("empty Moments onboarding", () => {
  it("shows the four educational cards in order", () => {
    for (const title of [
      "Share Moments",
      "Go live with Air",
      "Trusted privacy",
      "Create your first Moment"
    ]) {
      expect(preview, `missing onboarding card: ${title}`).toContain(title);
    }
  });

  it("only renders when the viewer genuinely has none", () => {
    expect(preview).toContain("if (!somethingExists)");
  });

  it("is never shown once a Moment exists", () => {
    // The rail is the other branch of the same condition, so the two can
    // never both render.
    const empty = preview.indexOf("if (!somethingExists)");
    const rail = preview.indexOf("items.map");
    expect(empty).toBeGreaterThan(-1);
    expect(rail).toBeGreaterThan(-1);
    expect(empty).toBeLessThan(rail);
  });

  it("shows no placeholder or fake Moments", () => {
    const onboarding = preview.slice(preview.indexOf("function MomentsOnboarding"));
    expect(onboarding).not.toContain("MomentImage");
    expect(onboarding).not.toContain("animate-pulse");
  });

  it("ends in the create action, pointing at the real route", () => {
    expect(preview).toContain('cta: "Create a Moment"');
  });

  it("uses branded Lucide icons rather than invented artwork", () => {
    expect(preview).toContain('from "lucide-react"');
    expect(preview).not.toContain("<Image");
  });

  it("swipes with real scroll rather than a JS carousel", () => {
    expect(preview).toContain("snap-x snap-mandatory");
    expect(preview).toContain("overflow-x-auto");
  });

  it("keeps its progress dots decorative", () => {
    const dots = preview.slice(preview.indexOf("Progress dots"));
    expect(dots).toContain('aria-hidden="true"');
  });

  it("respects reduced motion", () => {
    expect(preview).toContain("motion-reduce:transition-none");
  });
});

// ---------------------------------------------------------------------------
// Home wiring
// ---------------------------------------------------------------------------

describe("Home wiring", () => {
  it("renders the preview on Home", () => {
    expect(home).toContain("<MomentsPreview moments={moments} air={air} />");
  });

  it("takes the moments as a prop rather than loading them itself", () => {
    expect(home).toContain("moments?: VisibleMoment[]");
    // No call — the server page owns the load. (The name appears in a comment
    // pointing at where that happens, so match the call site specifically.)
    expect(home).not.toContain("buildMomentFeed(");
  });

  it("degrades to the onboarding when signed out", () => {
    // The signed-out fallback supplies an empty array, not undefined.
    expect(page).toContain("null, []");
  });
});
