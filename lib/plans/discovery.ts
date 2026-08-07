import type { HomeUpcomingPlan } from "@/lib/social/upcoming-plans";

/**
 * Plan discovery presentation — the decisions, as pure functions.
 *
 * Urgency is the part most likely to go quietly wrong: "Tonight" shown at 2am
 * for something that already happened, or "This weekend" on a Tuesday, is
 * worse than no label at all. Every threshold here is derived from real
 * timestamps and tested as arithmetic.
 *
 * Nothing in this module invents pressure. There is no "Almost full", no
 * "Selling fast", no countdown on a plan that is weeks away — urgency is
 * reported when it genuinely exists and omitted when it does not.
 */

/**
 * Extension points, named so they are reviewable. Each needs data that does
 * not exist yet; adding one means adding its derivation here, not editing the
 * card or the rail.
 */
export const FUTURE_PLAN_DISCOVERY = [
  "ai_recommendations",
  "nearby_plans",
  "spark_recommendations",
  "friends_attending",
  "plus_discovery",
  "trending_plans"
] as const;

export type PlanUrgency = {
  /** Short label for the badge, or null when the date speaks for itself. */
  label: string | null;
  /** True only for the most immediate band, so the card can lift one plan. */
  imminent: boolean;
};

/**
 * How soon this plan is, in words.
 *
 * Bands, in order:
 *   - already started → null (it is not upcoming; the caller filters these)
 *   - within today    → "Tonight" after 5pm local, otherwise "Today"
 *   - tomorrow        → "Tomorrow"
 *   - Sat/Sun ahead   → "This weekend"
 *   - within a week   → the weekday name
 *   - beyond          → null, and the date badge carries it
 *
 * Compared in the VIEWER's local day, so "Today" means their today. A UTC
 * comparison would call a 1am plan "Tomorrow" for anyone west of Greenwich.
 */
export function planUrgency(startAt: string, nowMs = Date.now()): PlanUrgency {
  const start = Date.parse(startAt);
  if (Number.isNaN(start)) return { label: null, imminent: false };
  if (start <= nowMs) return { label: null, imminent: false };

  const startDate = new Date(start);
  const now = new Date(nowMs);

  const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const daysAway = Math.round((startDay - today) / dayMs);

  if (daysAway === 0) {
    // "Tonight" only when it genuinely reads as an evening — before that,
    // "Today" is the honest word.
    return { label: startDate.getHours() >= 17 ? "Tonight" : "Today", imminent: true };
  }
  if (daysAway === 1) return { label: "Tomorrow", imminent: true };

  if (daysAway <= 7) {
    const weekday = startDate.getDay();
    // Saturday or Sunday, and close enough that "this weekend" is unambiguous.
    if ((weekday === 6 || weekday === 0) && daysAway <= 6) {
      return { label: "This weekend", imminent: false };
    }
    return {
      label: startDate.toLocaleDateString(undefined, { weekday: "long" }),
      imminent: false
    };
  }

  // Further out than a week: the date badge already says everything useful,
  // and a label here would be manufacturing urgency that does not exist.
  return { label: null, imminent: false };
}

/** The date badge: a short weekday, the day number, and a short month. */
export function planDateParts(startAt: string): { weekday: string; day: string; month: string } | null {
  const start = Date.parse(startAt);
  if (Number.isNaN(start)) return null;
  const date = new Date(start);
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: "short" }),
    day: String(date.getDate()),
    month: date.toLocaleDateString(undefined, { month: "short" })
  };
}

/** Start time in the viewer's locale, or null when unparseable. */
export function planTimeLabel(startAt: string): string | null {
  const start = Date.parse(startAt);
  if (Number.isNaN(start)) return null;
  return new Date(start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export type PlanJoinState = {
  kind: "join" | "going" | "requested" | "maybe";
  label: string;
  disabled: boolean;
};

/**
 * What the RSVP control should say.
 *
 * Mirrors the canonical `rsvp_status` values, so the card never offers a state
 * the server does not recognise. "Full" and "Cancelled" are deliberately NOT
 * handled here: the upcoming projection filters cancelled plans out entirely,
 * and it carries no capacity field, so a "Full" badge would be a guess.
 */
export function planJoinState(plan: Pick<HomeUpcomingPlan, "myRsvp">): PlanJoinState {
  switch (plan.myRsvp) {
    case "going":
      return { kind: "going", label: "Going", disabled: true };
    case "maybe":
      return { kind: "maybe", label: "Maybe", disabled: false };
    case "invited":
    case "viewed":
      return { kind: "join", label: "Join", disabled: false };
    default:
      return { kind: "join", label: "Join", disabled: false };
  }
}

/**
 * Going count, only when it is worth stating.
 *
 * Zero returns null rather than "0 going": an empty plan reads as unwanted,
 * when in truth it is usually just new. Being first is not a warning.
 */
export function planGoingLabel(goingCount: number): string | null {
  if (goingCount <= 0) return null;
  return `${goingCount} going`;
}
