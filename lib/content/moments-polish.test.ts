import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAN_ENTITLEMENTS } from "@/lib/billing/entitlements";
import { planDisplayPrices } from "@/lib/billing/pricing";
import {
  capabilitiesAddedBy,
  capabilityLabel,
  cheapestPlanGranting,
  HEADLINE_LIMITS,
  formatEntitlementAmount,
  spotlightUpgradeCopy
} from "@/lib/billing/upgrade-copy";
import { comparisonRows, pricingPlans } from "@/components/premium/plans";
import { FEATURE_ICON_SOURCES } from "@/lib/icons/feature-icons";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

const declaration = (code: string, signature: string) => {
  const start = code.indexOf(signature);
  if (start === -1) return "";
  const next = code.indexOf("\nexport ", start + 1);
  return code.slice(start, next === -1 ? undefined : next);
};

// ---------------------------------------------------------------------------
// Menus and popovers
// ---------------------------------------------------------------------------

describe("menus dismiss properly", () => {
  const page = read("components/content/moments-page.tsx");
  const parts = read("components/content/moment-parts.tsx");

  it("uses the SHARED menu component rather than a hand-rolled panel", () => {
    // The bug: a plain absolutely-positioned div has nothing listening for an
    // outside press or Escape, so tapping empty space left the menu open.
    expect(page).toContain("AppMenu");
    const menu = declaration(page, "function MomentMenu");
    expect(menu).not.toContain("absolute right-0 top-full");
    expect(menu).not.toContain('role="menu"');
  });

  it("gets dismissal and collision handling from Radix, in one place", () => {
    const shared = read("components/ui/app-dropdown.tsx");
    expect(shared).toContain('from "@radix-ui/react-dropdown-menu"');
    // Flips and stays on screen rather than clipping actions away.
    expect(shared).toContain("collisionPadding");
  });

  it("builds the reaction picker on Radix Popover too", () => {
    expect(parts).toContain('from "@radix-ui/react-popover"');
    const control = declaration(parts, "export function ReactionControl");
    // The old hand-rolled version needed its own listeners; these are now gone.
    expect(control).not.toContain("pointerdown");
    expect(control).not.toContain('event.key === "Escape"');
    expect(control).toContain("collisionPadding");
  });

  it("keeps touch targets at 44px in both", () => {
    const menu = declaration(page, "function MomentMenu");
    expect(menu).toContain("h-11 w-11");
    const control = declaration(parts, "export function ReactionControl");
    expect(control).toContain("h-11 w-11");
  });
});

// ---------------------------------------------------------------------------
// Optimistic reactions
// ---------------------------------------------------------------------------

describe("reactions feel live without Realtime", () => {
  const page = stripComments(read("components/content/moments-page.tsx"));

  it("updates the count and the breakdown before the server responds", () => {
    const react = page.slice(page.indexOf("function react("), page.indexOf("function unreact("));
    // The optimistic patch precedes the mutation.
    expect(react.indexOf("patch(moment.id")).toBeLessThan(react.indexOf("reactToMomentAction"));
    expect(react).toContain("reactionBreakdown: breakdown");
    expect(react).toContain("reactionCount: previous ? entry.reactionCount : entry.reactionCount + 1");
  });

  it("does not double-count when a reaction is CHANGED", () => {
    const react = page.slice(page.indexOf("function react("), page.indexOf("function unreact("));
    // Replacing decrements the old type and leaves the total alone.
    expect(react).toContain("if (previous) breakdown[previous] = Math.max(0, (breakdown[previous] ?? 1) - 1);");
  });

  it("rolls back by re-reading canonical state on failure", () => {
    const react = page.slice(page.indexOf("function react("), page.indexOf("function unreact("));
    expect(react).toContain("if (!result.ok)");
    expect(react).toContain("refreshFeeds()");
  });

  it("never requires Realtime for the actor's own change", () => {
    // There is no moments Realtime subscription at all; correctness comes from
    // the optimistic patch plus a canonical refetch.
    expect(page).not.toContain("postgres_changes");
    expect(page).not.toContain("authenticateRealtime");
  });
});

// ---------------------------------------------------------------------------
// Pull to refresh
// ---------------------------------------------------------------------------

describe("pull-to-refresh is one reusable system", () => {
  const ptr = read("components/ui/pull-to-refresh.tsx");

  it("lives in a single shared component", () => {
    expect(ptr).toContain("export function PullToRefresh");
    // Mounted ONCE in the app shell, so every page in the authenticated group
    // gets it without repeating the gesture handling.
    expect(read("components/app-shell/app-shell.tsx")).toContain("<PullToRefresh");
    // A page holding client state subscribes rather than mounting a second one.
    const page = read("components/content/moments-page.tsx");
    expect(page).toContain("usePullRefreshListener");
    expect(page).not.toContain("<PullToRefresh");
  });

  it("only arms at the top of the page, for a single touch", () => {
    expect(ptr).toContain("window.scrollY <= 0");
    expect(ptr).toContain("event.touches.length !== 1");
  });

  it("gives up when the gesture is sideways, so carousels keep working", () => {
    expect(ptr).toContain("deltaX > Math.abs(deltaY)");
    // And ignores gestures that start inside a horizontal scroller or a sheet.
    expect(ptr).toContain("overflowX");
    expect(ptr).toContain("[role='dialog'], [data-no-pull-refresh]");
  });

  it("marks the horizontal Tuned In strip as opted out", () => {
    expect(read("components/content/tuned-in-strip.tsx")).toContain("data-no-pull-refresh");
  });

  it("only suppresses native scrolling once the pull is committed", () => {
    const move = ptr.slice(ptr.indexOf("const onTouchMove"), ptr.indexOf("const onTouchEnd"));
    expect(move.indexOf("committed.current = true")).toBeLessThan(move.indexOf("preventDefault"));
  });

  it("does not poll", () => {
    expect(ptr).not.toContain("setInterval");
  });

  it("keeps content on screen while refreshing", () => {
    // The indicator is a FIXED overlay (previously absolute), so it occupies
    // no document-flow height and nothing below it shifts. Children are
    // rendered untransformed — a wrapper transform used to move the header
    // with the pull and break sticky positioning inside it.
    expect(ptr).toContain("pointer-events-none fixed inset-x-0");
    expect(ptr).toContain("{children}");
    expect(ptr).not.toMatch(/transform: active \?/);
  });

  it("respects reduced motion", () => {
    expect(ptr).toContain("useReducedMotion");
    const css = read("app/globals.css");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf(".pull-refresh-spin")));
    expect(reduced).toContain("animation: none");
  });
});

// ---------------------------------------------------------------------------
// Spotlight entitlement and upgrade copy
// ---------------------------------------------------------------------------

/**
 * Phase 0: core Air publishing is free.
 *
 * A network effect only paying users can contribute to starves itself, so
 * publishing moved to Free. Advanced Air (scheduled sessions, analytics,
 * boost, creator tools) is not built and must NOT be advertised until it is
 * implemented and entitlement-backed.
 */
describe("core Air publishing is free", () => {
  it("grants publishing on every tier, starting with Free", () => {
    expect(PLAN_ENTITLEMENTS.free.public_moments).toBe(true);
    expect(PLAN_ENTITLEMENTS.buddy_plus.public_moments).toBe(true);
    expect(PLAN_ENTITLEMENTS.buddy_pro.public_moments).toBe(true);
    // Free is the cheapest plan granting it, which is the point.
    expect(cheapestPlanGranting("public_moments")).toBe("free");
  });

  it("offers no upgrade copy, because there is nothing to upgrade to", () => {
    // The helper already models this: plan is null when the capability is
    // granted to everyone.
    const copy = spotlightUpgradeCopy();
    expect(copy.plan).toBeNull();
  });

  it("never advertises unbuilt advanced Air features", () => {
    // Scheduled Air, analytics, boost and creator tools do not exist. Selling
    // them would be selling nothing.
    const plans = read("components/premium/plans.ts");
    for (const unbuilt of ["Air Boost", "Scheduled Air", "Air analytics", "Audience insights"]) {
      expect(plans, `must not advertise ${unbuilt}`).not.toContain(unbuilt);
    }
  });

  it("lists only benefits the registry actually grants", () => {
    const copy = spotlightUpgradeCopy();
    // Nothing to sell means nothing listed.
    if (copy.plan === null) {
      expect(copy.benefits).toEqual([]);
      return;
    }
    const granted = capabilitiesAddedBy("buddy_pro")
      .map(capabilityLabel)
      .filter((entry): entry is string => entry !== null);
    for (const benefit of copy.benefits) {
      expect(granted, `${benefit} is not a real Pro capability`).toContain(benefit);
    }
    expect(copy.benefits).toContain("Publish images to Air");
  });

  it("hardcodes no price in any Moments component", () => {
    for (const file of [
      "components/content/moment-composer.tsx",
      "components/content/moments-page.tsx",
      "components/content/moment-parts.tsx"
    ]) {
      expect(read(file), file).not.toMatch(/GHS\s?\d/);
    }
  });
});

// ---------------------------------------------------------------------------
// Pricing page truthfulness
// ---------------------------------------------------------------------------

describe("pricing page matches the entitlement registry", () => {
  it("derives every advertised limit from the registry", () => {
    // The original bug this guarded against: hand-written copy drifting from
    // the real values. Still guarded — just over the limits that remain
    // advertised, now that the resentment caps are gone.
    for (const plan of pricingPlans) {
      const key = plan.id === "free" ? "free" : plan.id === "plus" ? "buddy_plus" : "buddy_pro";
      for (const { key: limitKey } of HEADLINE_LIMITS) {
        const expected = formatEntitlementAmount(PLAN_ENTITLEMENTS[key][limitKey]);
        expect(plan.limits.join(" "), `${plan.id}/${limitKey}`).toContain(expected);
      }
    }
  });

  it("never advertises a limit that is identical on every tier", () => {
    // Selling "Unlimited Muddies" as a Plus benefit when Free has it too
    // would be false advertising. HEADLINE_LIMITS must only carry real
    // differences.
    for (const { key } of HEADLINE_LIMITS) {
      const values = (["free", "buddy_plus", "buddy_pro"] as const).map(
        (plan) => PLAN_ENTITLEMENTS[plan][key]
      );
      expect(new Set(values).size, `${key} is the same on every tier`).toBeGreaterThan(1);
    }
  });

  it("shows Air publishing as available on every tier", () => {
    // Phase 0 moved core Air publishing to Free, so the comparison row must
    // say so rather than continuing to sell it as a Pro benefit.
    const spotlightRow = comparisonRows.find((row) => row.feature === "Publish to Air");
    if (spotlightRow) {
      expect(spotlightRow).toMatchObject({ free: true, plus: true, pro: true });
    }
    // And it is no longer listed as something Pro adds.
    const pro = pricingPlans.find((plan) => plan.id === "pro");
    expect(pro?.features.join(" ")).not.toContain("Publish images to Air");
  });

  it("quotes prices only from the single display-price source", () => {
    expect(pricingPlans.map((plan) => plan.price)).toEqual([
      planDisplayPrices.free,
      planDisplayPrices.plus,
      planDisplayPrices.pro
    ]);
    // No price literal is written anywhere else.
    expect(read("components/premium/plans.ts")).not.toMatch(/"GHS\s?\d/);
  });

  it("keeps every comparison capability row consistent with the registry", () => {
    for (const row of comparisonRows) {
      if (typeof row.free !== "boolean") continue;
      // A true cell must correspond to a real granted entitlement.
      if (row.pro === true) expect(typeof row.plus).toBe("boolean");
    }
  });
});

// ---------------------------------------------------------------------------
// Tune In icon, strip and viewer
// ---------------------------------------------------------------------------

describe("Tune In has one purpose-built icon", () => {
  const icon = read("components/content/tune-in-icon.tsx");

  it("is a signal/broadcast motif, not a star, heart, bell or follow glyph", () => {
    expect(icon).toContain("TuneInIcon");
    const lower = icon.toLowerCase();
    for (const wrong of ["star", "heart", "bell", "userplus", "user-plus"]) {
      // Mentioned only in the comment explaining why each is wrong, which is
      // stripped before this check.
      expect(stripComments(icon).toLowerCase(), wrong).not.toContain(wrong);
    }
    expect(lower).toContain("circle");
    expect(icon).toContain("path");
  });

  it("is used everywhere Tune In appears, with no leftovers", () => {
    for (const file of [
      "components/content/moments-page.tsx",
      "components/content/moment-parts.tsx",
      "components/content/moment-composer.tsx",
      "components/content/tuned-in-strip.tsx"
    ]) {
      expect(read(file), file).toContain("TuneInIcon");
    }
    // The previous stand-ins are gone.
    for (const file of ["components/content/moment-parts.tsx", "components/content/moments-page.tsx"]) {
      const code = read(file);
      expect(code, file).not.toContain("Sparkles");
      expect(code, file).not.toMatch(/\bRadio\b/);
    }
  });
});

describe("My Tuned In is a compact strip", () => {
  const strip = read("components/content/tuned-in-strip.tsx");

  it("renders a horizontal scroller of avatars, not a full-row list", () => {
    const component = declaration(strip, "export function TunedInStrip");
    expect(component).toContain("overflow-x-auto");
    expect(component).toContain("flex w-max");
    expect(component).toContain("UserAvatar");
  });

  it("keeps the per-row list only for explicit management", () => {
    expect(strip).toContain("export function TunedInManageModal");
    expect(declaration(strip, "export function TunedInStrip")).toContain("Manage");
  });

  it("animates the signal only for genuinely unviewed content", () => {
    const component = declaration(strip, "export function TunedInStrip");
    expect(component).toContain("entry.hasUnviewed");
    expect(component).toContain("tune-in-live");
    // A content state, not a notification: no badge or unread count.
    expect(component).not.toContain("badge");
    expect(component).not.toMatch(/unread/i);
  });

  it("stops animating under reduced motion", () => {
    expect(strip).toContain("useReducedMotion");
    const css = read("app/globals.css");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf(".tune-in-live")));
    expect(reduced).toContain("animation: none");
  });
});

describe("Tuned In ordering and viewer", () => {
  const service = stripComments(read("lib/content/service.ts"));
  const loader = declaration(service, "export async function loadMyTuneIns");

  it("puts unviewed content first, then live, then the rest", () => {
    expect(loader).toContain("if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1;");
    expect(loader).toContain("a.liveMomentCount > 0");
  });

  it("resolves unviewed state without an N+1", () => {
    // One profiles read, one live-moments read, one views read, one blocks read.
    expect(loader).toContain("await Promise.all([");
    expect(loader).not.toMatch(/for \([^)]*\)\s*\{[\s\S]{0,200}await admin/);
  });

  it("respects blocks and ghost mode in the strip", () => {
    expect(loader).toContain("blockedIds.has(row.creator_id)");
    expect(loader).toContain('visibility_status === "ghost"');
  });

  it("opens the creator's Moment directly, with the hub only as a fallback", () => {
    const page = stripComments(read("components/content/moments-page.tsx"));
    expect(page).toContain("if (entry.liveMomentCount > 0) viewerLane.open(myTuneIns, entry);");
    expect(page).toContain("else openHub(entry.creatorId);");
  });

  it("authorizes the lane through the same Spotlight feed", () => {
    const lane = declaration(service, "export async function loadCreatorSpotlightMoments");
    // Not a separate moments query, so no authorization rule can drift.
    expect(lane).toContain("buildSpotlightFeed(admin, viewerId, nowMs)");
    expect(lane).not.toContain('.from("moments")');
  });

  it("is not called a follower feed or stories", () => {
    const strip = read("components/content/tuned-in-strip.tsx");
    const lower = stripComments(strip).toLowerCase();
    for (const wrong of ["follower", "following", "stories", "story"]) {
      expect(lower, wrong).not.toContain(wrong);
    }
  });

  it("advances through a creator then into the next with content", () => {
    const viewer = declaration(read("components/content/tuned-in-strip.tsx"), "export function TunedInViewer");
    expect(viewer).toContain("index.moment + 1 < current.moments.length");
    expect(viewer).toContain("lane[next].moments.length > 0");
  });

  it("records the view so the signal settles", () => {
    const viewer = declaration(read("components/content/tuned-in-strip.tsx"), "export function TunedInViewer");
    expect(viewer).toContain("onSeen(moment.id, moment.isAuthor)");
  });
});

describe("Tune In privacy is unchanged", () => {
  it("still exposes only an aggregate to the creator", () => {
    const migration = read("supabase/migrations/20260731100000_moments_spotlight_tune_in.sql");
    expect(migration).toContain("for all using (auth.uid() = viewer_id)");
    expect(migration).not.toMatch(/using \(auth\.uid\(\) = creator_id\)/);
  });

  it("returns no identity from the strip loader to anyone but the viewer", () => {
    const loader = declaration(stripComments(read("lib/content/service.ts")), "export async function loadMyTuneIns");
    // Scoped to the viewer's own rows.
    expect(loader).toContain('.eq("viewer_id", viewerId)');
    expect(loader).not.toContain('.eq("creator_id", viewerId)');
  });

  it("still sends no notification on tune in or out", () => {
    const actions = read("app/(app)/moments-actions.ts");
    for (const fn of ["export async function tuneInAction", "export async function tuneOutAction"]) {
      expect(declaration(actions, fn)).not.toContain("deliverNotification");
    }
  });
});

// ---------------------------------------------------------------------------
// Hangout icon
// ---------------------------------------------------------------------------

describe("Hangout icon", () => {
  it("is reached through the shared icon component, from one mapping", () => {
    // No component hardcodes a glyph for Hangout; it goes through the key.
    const dashboard = read("components/dashboard/dashboard-page.tsx");
    expect(dashboard).not.toContain("hangout-linkup");
    expect(dashboard).toContain('featureIcon: "hangout"');
  });

  it("resolves to a Lucide component, not a raster asset", () => {
    // The former /icons/features/*.png|svg assets are gone; the mapping now
    // returns a component, so there is no file path to assert against.
    expect(FEATURE_ICON_SOURCES.hangout.icon).toBeDefined();
    expect(FEATURE_ICON_SOURCES.hangout.label).toBe("Hangout");
  });
});
