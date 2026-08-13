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

  it("shows only plans that are genuinely still upcoming", () => {
    // Re-anchored on the guarantee rather than the old SQL literal. The
    // filter used to be `.gte("start_at", nowIso)` alone, which dropped a
    // plan from Home the moment it began even when it ran for hours. The
    // query now casts wider -- start OR end still ahead -- and the canonical
    // helper makes the actual decision, so Home and the Plans page cannot
    // disagree about the same plan.
    expect(loader).toContain("isUpcomingPlan(");
    expect(loader).toContain('from "@/lib/social/plans"');
    // Undated plans still never reach Home; they live under "Waiting on a
    // time" on the Plans page until they are given one.
    expect(loader).toContain('.not("start_at", "is", null)');
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

  it("keeps one horizontal card geometry through 320 to 430px", () => {
    expect(css).toContain("@media (max-width: 26.875rem)");
    const compact = css.slice(css.indexOf("@media (max-width: 26.875rem)"));
    expect(compact.slice(0, 500)).not.toContain("flex-wrap: wrap");
    expect(compact.slice(0, 500)).toContain("padding: 0.875rem");
  });
});

// ---------------------------------------------------------------------------
// One stack, one card shape
// ---------------------------------------------------------------------------

describe("Plan and Event cards are the same size", () => {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
  const stack = readFileSync(join(process.cwd(), "components/socialize/plan-stack.tsx"), "utf8");

  /**
   * A Plan card carries two rows an Event card does not -- the attendee
   * avatars and the Going button -- so each sized to its own content and the
   * stack changed shape as you swiped between them.
   */
  it("holds one minimum height on the stack container", () => {
    // The cards are absolutely positioned, so the CONTAINER owns the height.
    // Putting it on the card made the card taller than the box holding it:
    // it overflowed, and its own row was squeezed to fit.
    const container = stripComments(css).slice(
      stripComments(css).indexOf(".plan-stack {"),
      stripComments(css).indexOf(".plan-stack-card {")
    );
    expect(container).toContain("min-height:");
  });

  it("does not put a competing height on the card itself", () => {
    const shell = stripComments(css).slice(
      stripComments(css).indexOf(".linkr-plan {"),
      stripComments(css).indexOf(".linkr-plan:hover")
    );
    expect(shell).not.toContain("min-height:");
    // The card still fills whatever the container gives it.
    expect(shell).toContain("height: 100%");
  });

  it("does not give the Event card its own height", () => {
    // The fix belongs on the shared shell, not on one variant.
    const eventCard = stack.slice(stack.indexOf("function EventAgendaCard"));
    expect(eventCard).not.toContain("min-h-");
    expect(eventCard).not.toContain("height:");
  });

  /**
   * THE REGRESSION THIS GUARDS.
   *
   * `.linkr-plan` is a flex ROW, so making the body growable let it shrink
   * below its own content width: the date tile drifted into the middle of
   * the card, the title clipped to one character, and the copy wrapped
   * letter by letter. The previous version of this test asserted the very
   * rule that caused it, so it passed while the card was visibly broken.
   */
  it("never lets the card body shrink below its content", () => {
    // Comments stripped first: the note explaining this regression names the
    // very declaration it forbids.
    const body = stripComments(css).slice(
      stripComments(css).indexOf(".linkr-plan-body {"),
      stripComments(css).indexOf(".linkr-plan-date {")
    );
    expect(body).not.toContain("flex: 1 1 auto");
    // Full row width, top-aligned children.
    expect(body).toContain("width: 100%");
    expect(body).toContain("align-items: flex-start");
  });

  it("keeps the date tile at the top rather than stretched", () => {
    const tile = css.slice(css.indexOf(".linkr-plan-date {"), css.indexOf(".linkr-plan-date-weekday"));
    expect(tile).toContain("align-self: flex-start");
  });

  it("keeps both kinds on the one card shell", () => {
    // Neither variant may fork into its own container.
    expect(stack).toContain("linkr-plan-body");
    const eventCard = stack.slice(stack.indexOf("function EventAgendaCard"));
    expect(eventCard).toContain("linkr-plan-body");
  });
});
