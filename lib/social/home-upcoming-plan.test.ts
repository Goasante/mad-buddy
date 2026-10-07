import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const home = read("components/dashboard/dashboard-page.tsx");
const service = read("lib/social/upcoming-plans.ts");
const stack = read("components/socialize/plan-stack.tsx");

/**
 * Home's Upcoming Plans section.
 *
 * Home previously rendered its OWN single-plan row — its own layout, its own
 * date formatting, its own attendance pill — while Linkr rendered the same
 * projection as a card. Two presentations of one thing drift, and a plan that
 * looks different depending on which screen you found it on is a plan you have
 * to re-read.
 *
 * Home now renders the shared PlanStack. The assertions that pinned the old
 * row's markup are REMOVED rather than rewritten to match new markup, because
 * a source assertion edited until it passes tests nothing. What they protected
 * — server ordering, an empty state, placement, one presentation — is asserted
 * here, and the card's own layout is covered in lib/plans/discovery.test.ts
 * and lib/plans/plan-stack.test.ts.
 */

describe("Home plan selection", () => {
  it("reuses the server ordering rather than ranking on the client", () => {
    // Soonest first, decided by the query.
    expect(service).toContain('.order("start_at", { ascending: true })');
    // No client-side sort of the plan list on Home.
    expect(home).not.toContain("agendaItems.sort");
    expect(home).not.toContain("[...agendaItems]");
  });

  it("shows the whole stack rather than only the soonest plan", () => {
    // Home loads three; rendering one hid two the user already paid for.
    expect(home).toContain("<PlanStack plans={comingUpItems}");
    expect(home).not.toContain("const plan = agendaItems[0];");
  });

  it("renders the empty state instead of hiding the section", () => {
    expect(home).toContain("<UpcomingMeetupEmpty />");
    expect(home).toContain("comingUpItems.length > 0 ?");
  });

  it("sits directly after Near and above Quick Actions", () => {
    const near = home.indexOf("<NearbyHero");
    const plans = home.indexOf('aria-labelledby="home-plans-heading"');
    const quickActions = home.indexOf("<QuickActionsHome");
    expect(near).toBeLessThan(plans);
    expect(plans).toBeLessThan(quickActions);
  });

  it("keeps the walkthrough target anchored to something that renders", () => {
    // The old row carried this id; removing it without re-anchoring would
    // leave a tour step highlighting nothing.
    expect(home).toContain("data-tour-id={TOUR_TARGET_IDS.HOME_UPCOMING_PLAN}");
  });
});

describe("Coming Up header", () => {
  it("uses the same pattern as Near", () => {
    expect(home).toContain("<PageSectionHeader");
    expect(home).toContain('id="home-plans-heading"');
    expect(home).toContain('title="Coming Up"');
  });

  it("does not send a mixed Plans/Events/Meetups stack to a Plans-only See all link", () => {
    const section = home.slice(home.indexOf('aria-labelledby="home-plans-heading"'));
    expect(section).not.toContain('href="/plans"');
    expect(section).not.toContain('actionAriaLabel="See all plans"');
  });
});

describe("one plan presentation, shared with Linkr", () => {
  it("renders the shared stack rather than a second Home-only card", () => {
    expect(home).toContain('import { PlanStack, type ComingUpMeetupItem } from "@/components/socialize/plan-stack"');
    expect(home).not.toContain("function UpcomingPlanRow");
  });

  it("does not expose legacy Plan RSVP actions on Home", () => {
    expect(home).not.toContain("rsvpAction(plan.id");
    expect(home).not.toContain('href="/plans"');
  });

  it("keeps the shared stack headerless so Home can name the mixed Coming Up section", () => {
    expect(stack).not.toContain("See all");
    expect(stack).not.toContain("PageSectionHeader");
  });

  it("uses the same stack shell for Events while preserving Event identity", () => {
    expect(stack).toContain('className="linkr-plan home-agenda-event"');
    expect(stack).toContain('event.myRsvp === "interested" ? "Interested" : "Going"');
    expect(stack).toContain(">Event</span>");
  });
});
