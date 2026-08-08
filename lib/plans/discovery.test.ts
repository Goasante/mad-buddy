import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FUTURE_PLAN_DISCOVERY,
  planDateParts,
  planGoingLabel,
  planJoinState,
  planTimeLabel,
  planUrgency
} from "@/lib/plans/discovery";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Plans discovery.
 *
 * Urgency is the part that fails invisibly: "Tonight" shown at 2am for
 * something that already happened, or "This weekend" on a Tuesday, still
 * renders — it is just wrong. So it is tested as arithmetic against a fixed
 * clock rather than eyeballed.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const card = stripComments(read("components/socialize/socialize-plan-card.tsx"));
const rails = stripComments(read("components/socialize/discovery-rails.tsx"));
const page = stripComments(read("components/socialize/socialize-page.tsx"));
// Not stripped: CSS comments are not JS comments, and the rules matter.
const css = read("app/globals.css");

// A fixed local clock: Friday 7 August 2026, 10:00.
const NOW = new Date(2026, 7, 7, 10, 0, 0).getTime();
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 7, day, hour, minute, 0).toISOString();

// ---------------------------------------------------------------------------
// Urgency
// ---------------------------------------------------------------------------

describe("urgency", () => {
  it("says Today for something later the same day", () => {
    expect(planUrgency(at(7, 14), NOW)).toEqual({ label: "Today", imminent: true });
  });

  it("says Tonight only when it genuinely reads as evening", () => {
    expect(planUrgency(at(7, 19), NOW).label).toBe("Tonight");
    // 4pm is still afternoon; calling it "Tonight" would be wrong.
    expect(planUrgency(at(7, 16), NOW).label).toBe("Today");
  });

  it("says Tomorrow for the next day", () => {
    expect(planUrgency(at(8, 11), NOW)).toEqual({ label: "Tomorrow", imminent: true });
  });

  it("says This weekend for an upcoming Saturday or Sunday", () => {
    // 8 Aug 2026 is a Saturday — but it is also tomorrow, and "Tomorrow" is
    // more precise, so the nearer label wins.
    expect(planUrgency(at(8, 11), NOW).label).toBe("Tomorrow");
    // 9 Aug is Sunday, two days out.
    expect(planUrgency(at(9, 11), NOW).label).toBe("This weekend");
  });

  it("names the weekday inside a week", () => {
    expect(planUrgency(at(12, 11), NOW).label).toBe(
      new Date(2026, 7, 12).toLocaleDateString(undefined, { weekday: "long" })
    );
  });

  it("INVENTS NO URGENCY beyond a week", () => {
    // A plan three weeks out is not urgent, and saying so would be pressure
    // the data does not support.
    expect(planUrgency(at(28, 11), NOW)).toEqual({ label: null, imminent: false });
  });

  it("says nothing for a plan that already started", () => {
    expect(planUrgency(at(7, 9), NOW).label).toBeNull();
    expect(planUrgency(at(1, 9), NOW).label).toBeNull();
  });

  it("marks only the nearest bands imminent, so one card lifts", () => {
    expect(planUrgency(at(7, 19), NOW).imminent).toBe(true);
    expect(planUrgency(at(8, 11), NOW).imminent).toBe(true);
    expect(planUrgency(at(9, 11), NOW).imminent).toBe(false);
    expect(planUrgency(at(28, 11), NOW).imminent).toBe(false);
  });

  it("survives an unparseable date", () => {
    expect(planUrgency("not-a-date", NOW)).toEqual({ label: null, imminent: false });
  });
});

// ---------------------------------------------------------------------------
// Date and time
// ---------------------------------------------------------------------------

describe("date and time", () => {
  it("splits the date into badge parts", () => {
    const parts = planDateParts(at(16, 16, 30));
    expect(parts?.day).toBe("16");
    expect(parts?.weekday).toBeTruthy();
    expect(parts?.month).toBeTruthy();
  });

  it("returns null rather than a broken badge", () => {
    expect(planDateParts("nope")).toBeNull();
    expect(planTimeLabel("nope")).toBeNull();
  });

  it("formats the time in the viewer's locale", () => {
    expect(planTimeLabel(at(16, 16, 30))).toContain("30");
  });
});

// ---------------------------------------------------------------------------
// Attendance and join state
// ---------------------------------------------------------------------------

describe("attendance", () => {
  it("states a real going count", () => {
    expect(planGoingLabel(12)).toBe("12 going");
    expect(planGoingLabel(1)).toBe("1 going");
  });

  it("says nothing rather than '0 going'", () => {
    // An empty plan reads as unwanted, when usually it is simply new.
    expect(planGoingLabel(0)).toBeNull();
    expect(planGoingLabel(-3)).toBeNull();
  });

  it("never fabricates attendance in the card", () => {
    for (const banned of ["almost full", "selling", "trending", "popular", "spots left"]) {
      expect(card.toLowerCase(), `the card must not show ${banned}`).not.toContain(banned);
    }
  });
});

describe("join state", () => {
  it("offers Join when not yet responded", () => {
    expect(planJoinState({ myRsvp: "invited" })).toEqual({ kind: "join", label: "Join", disabled: false });
  });

  it("shows Going and stays inert", () => {
    expect(planJoinState({ myRsvp: "going" })).toEqual({ kind: "going", label: "Going", disabled: true });
  });

  it("lets a Maybe still commit", () => {
    const state = planJoinState({ myRsvp: "maybe" });
    expect(state.disabled).toBe(false);
  });

  it("reuses the canonical RSVP action", () => {
    expect(page).toContain('rsvpAction(plan.id, "going")');
  });
});

// ---------------------------------------------------------------------------
// Card and rail
// ---------------------------------------------------------------------------

describe("plan card", () => {
  it("reuses the canonical cover resolver rather than a second system", () => {
    expect(card).toContain("resolvePlanCover(plan)");
    expect(card).toContain('cover.source === "upload"');
  });

  it("renders category art when there is no uploaded cover", () => {
    expect(card).toContain("cover.art.from");
    expect(card).toContain("cover.art.to");
  });

  it("makes the date a visual object, not a line of text", () => {
    expect(card).toContain("{date.weekday}");
    expect(card).toContain("{date.day}");
    expect(card).toContain("{date.month}");
  });

  it("keeps the title the strongest text", () => {
    // The guarantee is hierarchy, not a literal utility string: the title
    // must be semibold and larger than the 0.8125rem metadata beneath it.
    // lastIndexOf finds the rendered title, not the aria-label above it
    // that also interpolates plan.title.
    const titleAt = card.lastIndexOf("{plan.title}");
    const titleLink = card.slice(card.lastIndexOf("<Link", titleAt), titleAt);
    expect(titleLink).toContain("linkr-plan-title");
    // Weight and size live on the class, so the hierarchy is asserted there.
    const rule = css.slice(css.indexOf(".linkr-plan-title {"));
    expect(rule.slice(0, 300)).toContain("font-weight: 700");
    // The metadata rows sit at 0.8125rem, so the title must outweigh them.
    expect(rule.slice(0, 300)).toContain("font-size: 1.0625rem");
  });

  it("hides place and time when absent", () => {
    expect(card).toContain("{time ? <span>{time}</span> : null}");
    expect(card).toContain("plan.placeText ? (");
  });

  it("shows real attendee faces only when someone is going", () => {
    expect(card).toContain("plan.attendees.slice(0, 3)");
    expect(card).toContain("{going ? (");
  });

  it("is memoised", () => {
    expect(card).toContain("memo(PlanCard)");
  });

  it("lazy-loads uploaded covers", () => {
    expect(card).toContain('loading="lazy"');
    expect(card).toContain('decoding="async"');
  });

  it("ships a card-shaped skeleton", () => {
    expect(card).toContain("SocializePlanCardSkeleton");
    expect(card).toContain('aspect-[16/9] w-full animate-pulse');
  });

  it("keeps the CTA a comfortable touch target and names the card accessibly", () => {
    expect(card).toContain("linkr-plan-cta");
    const rule = css.slice(css.indexOf(".linkr-plan-cta {"));
    // 38px: trimmed from 40 so the host name stops truncating, still well
    // above the practical touch floor.
    expect(rule.slice(0, 500)).toContain("min-height: 2.375rem");
    expect(card).toContain("aria-label={`${plan.title}");
  });

  it("respects reduced motion", () => {
    // Motion lives on the card's own classes, disabled wholesale in the
    // reduced-motion block rather than per-utility on the element.
    expect(card).toContain("linkr-plan");
    const rules = css.slice(css.indexOf(".linkr-plan {"));
    expect(rules.slice(0, 5200)).toContain("prefers-reduced-motion");
  });

  it("shows plans as a stack rather than a half-read horizontal card", () => {
    // The rail asked the user to scroll sideways before discovering there was
    // anything past the first card. The stack shows the depth immediately,
    // and PlanStack keeps the chronological order intact.
    expect(rails).toContain("<PlanStack");
  });

  it("offers a way forward when there are no plans", () => {
    expect(rails).toContain("Nothing planned yet");
    expect(rails).toContain("Create a plan");
  });

  it("reserves future discovery without exposing it", () => {
    for (const reserved of FUTURE_PLAN_DISCOVERY) {
      expect(card).not.toContain(reserved);
      expect(rails).not.toContain(reserved);
    }
    expect(FUTURE_PLAN_DISCOVERY).toContain("friends_attending");
  });

  it("adds no duplicate query — the rail reuses the page's projection", () => {
    expect(rails).not.toContain("loadUpcomingPlans");
    expect(card).not.toContain("from(");
  });
});
