/**
 * Factual friendship milestones.
 *
 * Pure. A milestone is a COUNT or a DATE that has been reached — never a
 * judgement. "Five plans together" is a fact; "great friendship" is not, and
 * nothing here produces the latter.
 *
 * Each milestone has a stable code used as the event's natural key, so
 * recomputing over the same history re-derives identical dedupe keys and the
 * append-only insert becomes a no-op. That is what makes rebuild safe.
 */

import { lifeDedupeKey, relationshipId } from "@/lib/life/events";

export type MilestoneCode =
  | "first_plan_together"
  | "five_plans_together"
  | "ten_plans_together"
  | "first_reconnect"
  | `anniversary_year_${number}`;

export type MilestoneFacts = {
  /** When the friendship began. Null if it never formed. */
  createdAtMs: number | null;
  /** Plans both people attended. */
  plansAttendedTogether: number;
  /** Completed reconnects. */
  reconnectsCompleted: number;
};

export type Milestone = {
  code: MilestoneCode;
  /** Neutral, factual label. Never evaluative. */
  label: string;
  /** When the milestone was reached, where that is knowable. */
  reachedAtMs: number | null;
};

const YEAR = 365 * 24 * 60 * 60 * 1000;

/**
 * Every milestone reached, in a deterministic order.
 *
 * Order is fixed rather than sorted by date because some milestones (counts)
 * have no precise reach date — only the fact that the threshold is passed.
 */
export function milestonesFor(facts: MilestoneFacts, nowMs: number): Milestone[] {
  const reached: Milestone[] = [];

  if (facts.plansAttendedTogether >= 1) {
    reached.push({ code: "first_plan_together", label: "First plan together", reachedAtMs: null });
  }
  if (facts.plansAttendedTogether >= 5) {
    reached.push({ code: "five_plans_together", label: "Five plans together", reachedAtMs: null });
  }
  if (facts.plansAttendedTogether >= 10) {
    reached.push({ code: "ten_plans_together", label: "Ten plans together", reachedAtMs: null });
  }
  if (facts.reconnectsCompleted >= 1) {
    reached.push({ code: "first_reconnect", label: "Reconnected", reachedAtMs: null });
  }

  // Anniversaries: one per completed year, so a rebuild produces the same set.
  if (facts.createdAtMs !== null) {
    const years = Math.floor((nowMs - facts.createdAtMs) / YEAR);
    for (let year = 1; year <= years; year += 1) {
      reached.push({
        code: `anniversary_year_${year}` as MilestoneCode,
        label: year === 1 ? "One year as Muddies" : `${year} years as Muddies`,
        reachedAtMs: facts.createdAtMs + year * YEAR
      });
    }
  }

  return reached;
}

/** The dedupe key for a milestone event, stable across rebuilds. */
export function milestoneDedupeKey(userA: string, userB: string, code: MilestoneCode): string {
  return lifeDedupeKey("friendship.milestone_reached", relationshipId(userA, userB), code);
}

/** Words a milestone label must never contain. */
export const MILESTONE_FORBIDDEN_WORDS = ["best", "closest", "strongest", "top", "favourite", "score", "rank"];
