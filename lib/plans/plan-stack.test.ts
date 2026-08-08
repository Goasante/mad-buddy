import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

/**
 * Guards for the upcoming-plans stack.
 *
 * The reference Stack component this is modelled on reorders its array on
 * every interaction — the card sent back becomes last. For photographs that is
 * harmless. For plans it destroys the one fact the card exists to convey:
 * which one is next. These assert that browsing is a view over a fixed
 * chronological list, never a mutation of it.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const stack = stripComments(read("components/socialize/plan-stack.tsx"));
const loader = stripComments(read("lib/social/upcoming-plans.ts"));
const rails = stripComments(read("components/socialize/discovery-rails.tsx"));
const css = read("app/globals.css");

describe("soonest first, always", () => {
  it("orders by start time at the query, not in the component", () => {
    // Sorting in the component would leave every other consumer of this
    // projection with an arbitrary order.
    expect(loader).toContain('.order("start_at", { ascending: true })');
  });

  it("shows only plans that have not already started", () => {
    expect(loader).toContain('.gte("start_at", nowIso)');
  });

  it("never reorders the array it was given", () => {
    // The failure mode being guarded: after one flick, the soonest plan is no
    // longer on top. A view index cannot cause that; a mutated array can.
    expect(stack).not.toMatch(/\.splice\(/);
    expect(stack).not.toMatch(/\.unshift\(/);
    expect(stack).not.toMatch(/setPlans|sendToBack/);
  });

  it("rotates a view index over the fixed list", () => {
    expect(stack).toContain("const [top, setTop] = useState(0)");
    expect(stack).toContain("plans[(top + depth) % count]");
  });

  it("returns to the soonest plan when the rotation wraps", () => {
    // Modulo arithmetic in both directions, so browsing always comes home.
    expect(stack).toContain("(current + 1) % count");
    expect(stack).toContain("(current - 1 + count) % count");
  });

  it("names the first position rather than leaving it to be inferred", () => {
    expect(stack).toContain('top === 0 ? "Soonest"');
  });
});

describe("the stack replaces the rail without hiding plans", () => {
  it("renders a stack, not a horizontal scroller", () => {
    expect(rails).toContain("<PlanStack");
    const plansSection = rails.slice(rails.indexOf("export function PlansRail"));
    expect(plansSection.slice(0, 900)).not.toContain('<Rail label="Upcoming plans">');
  });

  it("degrades to a plain card when there is only one plan", () => {
    // A stack of one has nothing to browse; the counter and drag would be
    // controls for an interaction that cannot happen.
    expect(stack).toContain("if (count === 1)");
  });

  it("keeps every plan reachable without a gesture", () => {
    expect(stack).toContain('aria-label="Previous plan"');
    expect(stack).toContain('aria-label="Next plan"');
  });

  it("announces the position for screen readers", () => {
    expect(stack).toContain("aria-roledescription=\"stack\"");
    expect(stack).toContain("aria-live=\"polite\"");
    expect(stack).toContain("aria-hidden={!isTop}");
  });

  it("respects reduced motion", () => {
    expect(stack).toContain("reducedMotion");
    expect(stack).toContain("{ duration: 0 }");
  });
});

describe("tapping a plan opens it", () => {
  const plansPage = stripComments(read("components/plans/plans-page.tsx"));
  const card = stripComments(read("components/socialize/socialize-plan-card.tsx"));

  it("links to the plan on the canonical plans page", () => {
    expect(card).toContain("`/plans?plan=${plan.id}`");
  });

  it("opens the plan on a CLIENT-SIDE navigation, not only a fresh load", () => {
    // selectedPlanId and activeBucket are useState INITIALISERS, so they run
    // once at mount. Arriving from Linkr is a client transition into an
    // already-mounted page: without this the link silently did nothing.
    expect(plansPage).toContain("const planParam = searchParams.get(\"plan\")");
    expect(plansPage).toContain("if (trackedPlanParam !== planParam)");
  });

  it("tracks the param value, so closing the modal keeps it closed", () => {
    // Tracking mere presence would re-open the plan on every later render.
    expect(plansPage).toContain("setTrackedPlanParam(planParam)");
  });

  it("follows the plan into its own bucket", () => {
    // A hosted plan opened from the "upcoming" tab would otherwise sit behind
    // a filter that hides it.
    expect(plansPage).toContain("setActiveBucket(bucketFor(target))");
  });

  it("leaves the page alone when the plan is not visible to this user", () => {
    // Rather than opening an empty modal.
    expect(plansPage).toContain("if (target) {");
  });
});

describe("the host name fits", () => {
  it("lets the detail column shrink, so truncation engages at all", () => {
    // A flex item defaults to min-content width: without min-width:0 the name
    // widens the row instead of ellipsing.
    const detail = css.slice(css.indexOf(".linkr-plan-detail {"));
    expect(detail.slice(0, 400)).toContain("min-width: 0");
  });

  it("keeps the CTA from taking width the name needs", () => {
    const cta = css.slice(css.indexOf(".linkr-plan-cta {"));
    expect(cta.slice(0, 500)).toContain("white-space: nowrap");
    // Narrower padding than the original 1rem, which was the space the host
    // line was losing.
    expect(cta.slice(0, 500)).toContain("padding-inline: 0.75rem");
  });
});
