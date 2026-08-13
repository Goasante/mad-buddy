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

// ---------------------------------------------------------------------------
// The card must not crush its own content
// ---------------------------------------------------------------------------

describe("the information column keeps its width", () => {
  const declarations = (selector: string) => {
    const at = css.indexOf(selector);
    return at === -1 ? "" : css.slice(at, css.indexOf("}", at));
  };

  /**
   * THE ROOT CAUSE.
   *
   * .linkr-plan-actions was flex-shrink:0 holding two stacked children, so
   * the column's width was set by the WIDER of them -- an unbounded, wrapping
   * "This weekend" badge -- and it never gave any of that width back. The
   * detail column absorbed the entire shortfall: at 320px it was left roughly
   * 70px, which is why the title rendered as "b." and the venue as "Ho".
   */
  /**
   * THE ACTUAL ROOT CAUSE.
   *
   * GlareHover renders a div whose own module class sets width/height and
   * `position: relative`. The card overlays it with `absolute inset-0`, but a
   * CSS Module class and a Tailwind utility have equal specificity, so which
   * won depended on stylesheet source order. When the module won, the sheen
   * stayed IN FLOW -- and .linkr-plan is a flex row, so it became a second
   * column taking roughly half the card and crushing the content beside it.
   *
   * The Event card renders no sheen, which is why it always looked correct
   * while the Plan card collapsed.
   */
  it("keeps the decorative sheen out of the layout", () => {
    expect(css).toContain('.linkr-plan > [class*="glareHover"]');
    const overlay = declarations('.linkr-plan > [class*="glareHover"] {');
    expect(overlay).toContain("position: absolute");
    expect(overlay).toContain("width: auto");
  });

  it("lets the controls column size to its own content", () => {
    // No cap needed once the sheen is out of flow: the row has its full
    // width back, exactly like the Event card's.
    const actions = declarations(".linkr-plan-actions {");
    expect(actions).toContain("flex: 0 0 auto");
  });

  it("stops the status badge from widening that column", () => {
    const urgency = declarations(".linkr-plan-urgency {");
    expect(urgency).toContain("white-space: nowrap");
    expect(urgency).toContain("max-width: 100%");
    expect(urgency).toContain("text-overflow: ellipsis");
  });

  it("gives the information column the remaining width", () => {
    const detail = declarations(".linkr-plan-detail {");
    expect(detail).toContain("flex: 1 1 auto");
    // Without min-width:0 a flex item cannot shrink below min-content, so the
    // title pushes the row wider instead of ellipsing.
    expect(detail).toContain("min-width: 0");
  });

  it("keeps short atomic values on one line", () => {
    // "7:55 AM" split across two lines is damage, not information.
    expect(css).toContain(".linkr-plan-going > span {");
  });

  it("never lets the date tile be compressed", () => {
    const date = declarations(".linkr-plan-date {");
    expect(date).toContain("flex-shrink: 0");
    expect(date).toContain("flex-basis:");
  });

  it("recomposes rather than squeezing at the narrowest widths", () => {
    // Below 22rem the controls take their own row, instead of every column
    // shrinking until the title is a single character.
    const at = css.lastIndexOf("@media (max-width: 22rem)");
    const narrow = css.slice(at, at + 700);
    expect(narrow).toContain("linkr-plan-actions");
    expect(narrow).toContain("flex-wrap: wrap");
    expect(narrow).toContain("flex-basis: 100%");
  });
});
