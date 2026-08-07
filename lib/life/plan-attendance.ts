import type { LifeEventInput } from "@/lib/life/events";
import { relationshipId } from "@/lib/life/events";

/**
 * Turning "who attended a plan" into "who attended it together".
 *
 * Pure, and deliberately shared by BOTH the live emitter (the plan-completion
 * job) and the rebuild replay. When two code paths independently decide which
 * pairs attended together, they eventually disagree, and a rebuild starts
 * inventing pairs that the live path never recorded — history that never
 * happened. One function, one answer.
 *
 * ATTENDANCE IS `rsvp_status = 'going'` ON A COMPLETED PLAN. Not "invited",
 * not "maybe": a plan someone was invited to is not a plan they were at, and
 * an unattended invitation is not a shared memory.
 */

/** One attendee of one plan, as read from `plan_participants`. */
export type PlanAttendee = { planId: string; userId: string };

/**
 * Every unordered pair of attendees, as `plan.attended_together` inputs.
 *
 * Two properties matter:
 *
 *  - PAIRS, NOT A GROUP. The Life timeline is per-relationship, so a plan of
 *    four people is six relationship facts, not one group fact.
 *  - ORDERED AND DEDUPED. Each pair is emitted once, with the lower id as the
 *    actor, so the same attendance produces the identical dedupe key no matter
 *    what order the rows came back in. Without this, one replay could record
 *    (A,B) and the next (B,A) — the same fact, twice.
 *
 * Quadratic in the attendee count by nature; `maxAttendees` bounds it, because
 * a 200-person plan is 19,900 pairs and that is a job hazard rather than a
 * useful timeline. Oversized plans are skipped whole — a partial set of pairs
 * would be arbitrary, and arbitrary history is worse than none.
 */
export function planAttendancePairs(
  attendees: readonly PlanAttendee[],
  occurredAt: string,
  maxAttendees = 25
): LifeEventInput[] {
  const byPlan = new Map<string, string[]>();
  for (const attendee of attendees) {
    if (!byPlan.has(attendee.planId)) byPlan.set(attendee.planId, []);
    const users = byPlan.get(attendee.planId)!;
    // A participant row is unique per (plan, user), but a caller could pass
    // rows from two reads; dedupe rather than trust.
    if (!users.includes(attendee.userId)) users.push(attendee.userId);
  }

  const inputs: LifeEventInput[] = [];
  for (const [planId, users] of byPlan) {
    if (users.length < 2 || users.length > maxAttendees) continue;
    const sorted = [...users].sort();
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        inputs.push({
          eventType: "plan.attended_together",
          actorId: sorted[i]!,
          subjectId: sorted[j]!,
          // The plan is what makes this fact unique in time: one plan, one
          // shared attendance, however many times the job re-runs.
          naturalKey: planId,
          // Ids only. Never the plan title, never its place — a title can hold
          // anything a user typed, and a place is a location.
          payload: { planId },
          occurredAt
        });
      }
    }
  }
  return inputs;
}

/** Exposed so tests and callers agree on what a relationship id is here. */
export { relationshipId };
