import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const home = read("components/dashboard/dashboard-page.tsx");
const css = read("app/globals.css");
const glowRing = read("components/glow/glow-ring.tsx");
const glowAvatar = read("components/glow/glow-avatar.tsx");
const userAvatar = read("components/ui/user-avatar.tsx");

/** The Near section's own markup, isolated from the rest of Home. */
const nearSection = home.slice(home.indexOf("function NearbyHero"), home.indexOf("// First-time quick actions"));

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

describe("Near section header", () => {
  it("is titled Near", () => {
    const heading = /<h2[^>]*id="home-nearby-heading"[\s\S]*?>([\s\S]*?)<\/h2>/.exec(nearSection);
    expect(heading?.[1]?.trim()).toBe("Near");
  });

  it("uses the large display size for the title", () => {
    expect(nearSection).toContain("text-[1.75rem] font-bold");
  });

  it("offers See all in brand orange at the specified weight", () => {
    expect(nearSection).toContain("See all");
    expect(nearSection).toContain("text-base font-medium text-[var(--color-brand-orange)]");
  });

  it("hides See all when nobody is nearby", () => {
    expect(nearSection).toContain("{total > 0 ? (");
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
  it("uses the dedicated 64px near size", () => {
    expect(nearSection).toContain('size="near"');
    expect(userAvatar).toContain('near: "h-16 w-16');
  });

  it("keeps the premium ring thin rather than scaling it with the avatar", () => {
    const ringPadding = userAvatar.slice(userAvatar.indexOf("RING_PADDING"), userAvatar.indexOf("export function UserAvatar"));
    expect(ringPadding).toContain('near: "p-[2.5px]"');
  });

  it("keeps the canonical layer order: glow outside, ring inside, avatar innermost", () => {
    // GlowRing wraps UserAvatar, and UserAvatar owns the membership band.
    expect(glowAvatar).toContain("<GlowRing");
    expect(glowAvatar).toContain("<UserAvatar");
    expect(glowAvatar.indexOf("<GlowRing")).toBeLessThan(glowAvatar.indexOf("<UserAvatar"));
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
  const scope = css.slice(css.indexOf(".near-strip .proximity-halo-very-close"), css.indexOf("/* NOTE:"));

  it("scopes its restraint rather than editing the canonical glow classes", () => {
    expect(scope).toContain(".near-strip .proximity-halo-very-close");
    expect(scope).toContain(".near-strip .proximity-halo-nearby");
    expect(scope).toContain(".near-strip .proximity-halo-around");
  });

  it("is the most restrained glow in the app", () => {
    const blur = (block: string) => Number(/--halo-blur:\s*([\d.]+)px/.exec(block)?.[1]);
    const near = blur(scope.slice(scope.indexOf("very-close")));
    // The default very-close blur is 26px; the Nearby strip's is 16px.
    expect(near).toBeLessThan(16);
  });

  it("makes closer mean tighter and further mean wider", () => {
    const spread = (name: string) => {
      const at = scope.indexOf(name);
      return Number(/--halo-spread:\s*([\d.]+)px/.exec(scope.slice(at))?.[1]);
    };
    expect(spread("very-close")).toBeLessThan(spread("nearby"));
    expect(spread("nearby")).toBeLessThan(spread("around"));
  });

  it("damps opacity through a GlowRing prop, since inline vars beat CSS", () => {
    // A `.near-strip .proximity-halo { --halo-*-opacity }` rule would be
    // silently ignored: GlowRing sets those inline.
    expect(glowRing).toContain("intensity");
    expect(glowRing).toContain("Math.max(0, intensity)");
    expect(nearSection).toContain("intensity={NEAR_GLOW_INTENSITY}");
    expect(home).toContain("const NEAR_GLOW_INTENSITY = 0.72");
  });

  it("applies intensity last, so the close > near > far ordering is preserved", () => {
    expect(glowRing).toContain(
      "stateOpacity * confidenceMultiplier * strengthMultiplier * Math.max(0, intensity)"
    );
  });

  it("leaves proximity, strength and confidence untouched", () => {
    // Presentation only: the section must not alter the backend signals.
    expect(nearSection).toContain("proximityLevel={friend.proximityLevel}");
    expect(nearSection).toContain("glowStrength={friend.glowStrength}");
    expect(nearSection).toContain("confidence={friend.confidence}");
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
      "aria-label={`${capitalize(firstName(name))}, ${proximityLabels[friend.proximityLevel]}`}"
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
    expect(nearSection).toContain("!loaded && total === 0");
    expect(home).toContain("setNearbyLoaded(true)");
  });
});
