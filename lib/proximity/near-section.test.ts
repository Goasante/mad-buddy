import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const home = read("components/dashboard/dashboard-page.tsx");
const css = read("app/globals.css");
const glowComponent = read("components/glow/proximity-glow.tsx");
const glowAvatar = read("components/glow/proximity-glow-avatar.tsx");
const userAvatar = read("components/ui/user-avatar.tsx");

/** The Near section's own markup, isolated from the rest of Home. */
const nearSection = home.slice(home.indexOf("function NearbyHero"), home.indexOf("// First-time quick actions"));

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

describe("Near section header", () => {
  // Step 8 consolidated the hand-written header into the shared
  // PageSectionHeader, so the styling assertions follow it there. The section
  // is still asserted to carry the right title and action.
  const sectionHeader = read("components/app-shell/page-section-header.tsx");

  it("is titled Near", () => {
    expect(nearSection).toContain('title="Near"');
    expect(nearSection).toContain('id="home-nearby-heading"');
  });

  it("uses the shared header rather than its own markup", () => {
    expect(nearSection).toContain("<PageSectionHeader");
    expect(nearSection).not.toContain("text-[1.75rem] font-bold");
  });

  it("uses the large display size for the title", () => {
    expect(sectionHeader).toContain("text-[1.75rem] font-bold");
  });

  it("offers See all in brand orange at the specified weight", () => {
    expect(sectionHeader).toContain("text-base font-medium text-[var(--color-brand-orange)]");
    expect(sectionHeader).toContain('actionLabel = "See all"');
  });

  it("hides See all unless somebody is genuinely hidden", () => {
    /* Was `total > 0`, then `total > 1` -- both still offered to expand people
     * who were already on screen. Only a real hidden remainder earns the link;
     * the zero case is covered because hiddenCount is 0 there too. */
    expect(nearSection).toContain('href={hiddenCount > 0 ? "/friends" : undefined}');
  });
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe("Near section layout", () => {
  it("is a single horizontally scrolling row that never wraps", () => {
    expect(nearSection).toContain("overflow-x-auto");
    // shrink-0 on every column is what prevents wrapping/squashing.
    expect(nearSection).toContain("w-[4.75rem] shrink-0");
    expect(nearSection).not.toContain("flex-wrap");
  });

  it("has no snapping and no carousel indicators", () => {
    expect(nearSection).not.toContain("snap-x");
    expect(nearSection).not.toContain("snap-center");
    expect(nearSection).not.toContain("aria-roledescription=\"carousel\"");
  });

  it("hides the scrollbar so the rail reads as native", () => {
    expect(nearSection).toContain("[&::-webkit-scrollbar]:hidden");
    expect(nearSection).toContain("[scrollbar-width:none]");
  });

  it("is a bare rail rather than a panel", () => {
    const row = nearSection.slice(nearSection.indexOf("near-strip"), nearSection.indexOf("</div>"));
    expect(row).not.toContain("glass-panel");
  });

  it("bleeds to the screen edge so the last avatar can scroll fully into view", () => {
    expect(nearSection).toContain("-mx-4");
    expect(nearSection).toContain("px-4");
  });

  it("gives every column a fixed-height avatar slot so labels align across the row", () => {
    // The halo's padding varies by proximity; without this the names and
    // distance labels sit at different baselines per column.
    expect(nearSection).toContain("grid h-[4.5rem] w-full place-items-center");
  });
});

// ---------------------------------------------------------------------------
// Avatar + rings
// ---------------------------------------------------------------------------

describe("Near section avatar", () => {
  it("uses the canonical md Glow size", () => {
    // The Glow owns its own size scale now (sm/md/lg/hero), each mapped to a
    // real UserAvatar size, so the section names a Glow size rather than
    // reaching for an avatar class directly.
    expect(nearSection).toContain('size="md"');
    expect(userAvatar).toContain('md: "h-14 w-14');
  });

  it("keeps the premium ring thin rather than scaling it with the avatar", () => {
    const ringPadding = userAvatar.slice(userAvatar.indexOf("RING_PADDING"), userAvatar.indexOf("export function UserAvatar"));
    expect(ringPadding).toContain('near: "p-[2.5px]"');
  });

  it("keeps the canonical layer order: glow outside, ring inside, avatar innermost", () => {
    // ProximityGlow wraps UserAvatar, and UserAvatar owns the membership band.
    expect(glowAvatar).toContain("<ProximityGlow");
    expect(glowAvatar).toContain("<UserAvatar");
    expect(glowAvatar.indexOf("<ProximityGlow")).toBeLessThan(glowAvatar.indexOf("<UserAvatar"));
  });

  it("passes the tier through rather than restyling the ring on Home", () => {
    expect(nearSection).toContain("membershipTier={friend.membershipTier}");
    expect(nearSection).not.toContain("avatar-ring-plus");
    expect(nearSection).not.toContain("avatar-ring-pro");
  });

  it("does not animate the premium ring in this section", () => {
    expect(nearSection).not.toContain("avatar-ring-pro-animated");
  });
});

// ---------------------------------------------------------------------------
// Glow restraint
// ---------------------------------------------------------------------------

describe("Near section glow", () => {
  it("renders the canonical Glow rather than a second treatment", () => {
    // One component, one config table. A page-local halo is exactly what this
    // redesign replaced.
    expect(nearSection).toContain("<ProximityGlowAvatar");
    expect(nearSection).not.toContain("proximity-halo");
    expect(nearSection).not.toContain("box-shadow");
  });

  it("damps the whole scale uniformly, never one state", () => {
    // A per-state override on Home would let the section disagree with the
    // rest of the app about what a state looks like. `intensity` multiplies
    // the resolved strength, so every state calms by the same factor and the
    // six-way ordering survives.
    expect(glowComponent).toContain("config.strength * Math.max(0, intensity)");
    expect(nearSection).toContain("intensity={NEAR_GLOW_INTENSITY}");
    expect(home).toContain("const NEAR_GLOW_INTENSITY = 0.72");
  });

  it("takes its geometry from the shared config, not from the page", () => {
    expect(glowComponent).toContain("resolveGlowGeometry(level, size)");
    expect(nearSection).not.toMatch(/--glow-(ring|outer|blur|strength)/);
  });

  it("needs no Home-scoped Glow CSS at all", () => {
    // The old halo needed `.near-strip .proximity-halo-*` overrides per state.
    // A surface-scoped override is a second state authority by another name, so
    // the redesign leaves none behind and must not grow new ones.
    expect(css).not.toContain(".near-strip .proximity-glow");
    expect(css).not.toMatch(/\.near-strip[^{]*\{[^}]*--glow-/);
  });

  it("clamps intensity so no surface can flatten the top of the scale", () => {
    expect(glowComponent).toContain(
      "Math.min(1, Math.max(0, config.strength * Math.max(0, intensity)))"
    );
  });

  it("passes the server-resolved band straight through", () => {
    // Presentation only: the section must not alter or re-derive the backend
    // signal. The band is the whole proximity input now.
    expect(nearSection).toContain("band={friend.proximityBand}");
    expect(nearSection).not.toContain("bandForDistance");
    expect(nearSection).not.toContain("resolveProximityBand");
  });
});

// ---------------------------------------------------------------------------
// Name + distance label
// ---------------------------------------------------------------------------

describe("Near section labels", () => {
  it("shows the first name only, on one line, ellipsized", () => {
    expect(nearSection).toContain("{capitalize(firstName(name))}");
    expect(nearSection).toContain("w-full truncate text-sm font-semibold");
    expect(home).toContain("function firstName");
  });

  it("uses a coloured dot plus text, never an icon or a pill", () => {
    expect(nearSection).toContain("PROXIMITY_DOT_CLASS[friend.proximityLevel]");
    expect(nearSection).toContain("h-1.5 w-1.5 shrink-0 rounded-full");
    // The old coloured-pill treatment is gone.
    expect(nearSection).not.toContain("rounded-full px-2 py-0.5 text-[10px]");
  });

  it("styles the distance label as muted supporting text", () => {
    expect(nearSection).toContain("text-xs font-medium text-muted-foreground");
  });

  it("uses theme-aware dot colours rather than hardcoded hex", () => {
    const dots = home.slice(home.indexOf("PROXIMITY_DOT_CLASS"), home.indexOf("NEAR_GLOW_INTENSITY"));
    expect(dots).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("hides the decorative dot from screen readers", () => {
    // The proximity is already in the button's aria-label.
    const dotBlock = nearSection.slice(nearSection.indexOf("PROXIMITY_DOT_CLASS"));
    expect(dotBlock.slice(0, 400)).toContain('aria-hidden="true"');
  });
});

// ---------------------------------------------------------------------------
// Interaction + accessibility
// ---------------------------------------------------------------------------

describe("Near section interaction", () => {
  it("uses a subtle press scale that respects reduced motion", () => {
    expect(nearSection).toContain("active:scale-[0.98]");
    expect(nearSection).toContain("motion-reduce:active:scale-100");
  });

  it("adds no bounce", () => {
    expect(nearSection).not.toContain("animate-bounce");
  });

  it("opens the existing profile sheet rather than a new destination", () => {
    expect(nearSection).toContain("onClick={() => onSelect(friend.friendId)}");
  });

  it("labels each avatar with the person and their proximity", () => {
    expect(nearSection).toContain(
      "aria-label={`${capitalize(firstName(name))}, ${proximityBandLabel(friend.proximityBand)}`}"
    );
  });

  it("keeps a visible focus ring for keyboard users", () => {
    expect(nearSection).toContain("focus-ring");
  });

  it("meets the 44px touch target", () => {
    // 64px avatar inside a 4.5rem (72px) slot clears 44px comfortably.
    expect(nearSection).toContain("h-[4.5rem]");
  });
});

// ---------------------------------------------------------------------------
// Empty + loading
// ---------------------------------------------------------------------------

describe("Near section empty state", () => {
  it("is lightweight, not a large card", () => {
    const empty = nearSection.slice(nearSection.indexOf("No trusted Muddies nearby"));
    expect(empty).not.toContain("glass-panel");
    expect(empty).not.toContain("py-8");
  });

  it("uses the specified copy and offers both routes forward", () => {
    expect(nearSection).toContain("No trusted Muddies nearby.");
    expect(nearSection).toContain("Invite friends");
    expect(nearSection).toContain("or turn on your Glow.");
  });

  it("keeps the distinct ghost-mode message", () => {
    expect(nearSection).toContain("Visibility is paused");
  });
});

describe("Near section loading", () => {
  it("shows lightweight skeletons, not a loading card", () => {
    expect(nearSection).toContain("animate-pulse rounded-full bg-secondary/70");
    expect(nearSection).toContain("motion-reduce:animate-none");
  });

  it("matches the real column footprint so nothing resizes on load", () => {
    const skeleton = nearSection.slice(nearSection.indexOf("!loaded"), nearSection.indexOf("A bare horizontal rail"));
    expect(skeleton).toContain("w-[4.75rem] shrink-0");
    expect(skeleton).toContain("h-16 w-16");
  });

  it("only shows before the first fetch settles, never on refresh", () => {
    /* Both skeleton reasons require an EMPTY client list, so a refresh that
     * already has friends can never fall back into skeletons -- which is the
     * rule this protects.
     *
     * The second reason was added because the client fetch settling empty (or
     * failing) made Near claim "No trusted Muddies nearby" over the server's
     * own answer that somebody WAS nearby. Waiting is honest there; asserting
     * an empty room is not. */
    /* The guard is back to "empty AND unknown".
     *
     * It briefly also waited on `serverNearbyCount > 0`, which had no exit:
     * once the client list settled empty the skeleton was permanent. The rule
     * that guard existed for -- never claim an empty room over the server's
     * answer -- is now met by SEEDING the client list with the server's own
     * safe result, so there is nothing to contradict. */
    expect(nearSection).toContain("total === 0 && !loaded");
    expect(home).toContain("setNearbyLoaded(true)");
    expect(home).toContain("serverNearby.map(toDashboardFriend)");
  });

  it("cannot re-enter the skeleton once friends are on screen", () => {
    // total === 0 gates it, so a populated rail stays populated.
    const skeleton = nearSection.slice(nearSection.indexOf("total === 0 && !loaded"));
    expect(skeleton.slice(0, 80)).toContain("total === 0");
  });

  it("has no state in which the skeleton cannot clear", () => {
    /* The deadlock: a second clause stayed true forever whenever the client
     * list settled empty while the server had people. The condition now
     * depends only on `loaded`, which the fetch always sets. */
    const guard = nearSection.slice(nearSection.indexOf("{total === 0 &&"));
    expect(guard.slice(0, 60)).toContain("total === 0 && !loaded ?");
    expect(home).toContain("setNearbyLoaded(true)");
  });
});
