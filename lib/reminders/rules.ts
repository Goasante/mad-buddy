import type { EventRsvpStatus, PlanStatus, RsvpStatus } from "@/lib/supabase/database.types";

/**
 * Plan and Event reminders: the pure decision core (Stage D).
 *
 * Everything about WHEN a reminder is due, WHETHER it is still worth sending,
 * and WHAT identity it carries lives here. No I/O, no clock of its own -- the
 * job handlers supply the facts and this decides, the same shape
 * lib/events/rules.ts and lib/social/plans.ts already use for their domains.
 *
 * ONE MODEL FOR TWO DOMAINS. A Plan and an Event are different records with
 * different participation tables, but "something you said you would attend is
 * starting soon" is one idea, and the stages/offsets/tolerances are identical
 * for both. Splitting them would mean two sets of constants drifting apart.
 */

// ---------------------------------------------------------------------------
// Stages and offsets
// ---------------------------------------------------------------------------

export type ReminderDomain = "plan" | "event";

export type ReminderStage = "24h" | "2h" | "near_start";

/** Every stage, soonest-firing last. Iteration order is the schedule order. */
export const REMINDER_STAGES: readonly ReminderStage[] = ["24h", "2h", "near_start"];

/**
 * How far before the start each stage fires, in minutes.
 *
 * CENTRAL, and deliberately the only place these numbers exist. A handler or
 * component that hardcoded "120" would be a second source of truth that a
 * later product change would miss.
 *
 * near_start is 30 minutes: long enough to actually leave for something,
 * short enough to still mean "now". There was no pre-existing canonical
 * near-start constant in the product to inherit -- `plans.reminder_minutes`
 * exists as a column but is written and never read, and is deliberately left
 * dormant rather than repurposed into a three-stage model it cannot express.
 */
export const REMINDER_OFFSET_MINUTES: Record<ReminderStage, number> = {
  "24h": 24 * 60,
  "2h": 2 * 60,
  near_start: 30
};

/**
 * How late a stage may fire and still be worth sending, in minutes.
 *
 * THE MAINTENANCE-RECOVERY RULE. Both production schedulers are paused as
 * this ships, so the first tick after they resume will find reminders whose
 * moment passed hours ago. Without a tolerance, that tick would deliver every
 * missed 24h/2h/30m reminder at once -- a burst of notifications about things
 * that already happened, which is worse than silence.
 *
 * Tolerances are stage-specific because lateness costs different amounts:
 *
 *   24h  -- 6 hours. "Tomorrow" is still true most of a day out, so a late
 *           24h reminder is merely imprecise, not wrong.
 *   2h   -- 45 minutes. Past that the "in about 2 hours" copy is a lie and
 *           the near-start reminder is the more useful one anyway.
 *   near_start -- 10 minutes, AND never once the thing has actually started
 *           (enforced separately in isReminderStillUseful, because "already
 *           began" is a stronger condition than "late"). Telling someone
 *           something starts in 30 minutes when it started 20 minutes ago is
 *           the single worst reminder this system could send.
 */
export const REMINDER_OVERDUE_TOLERANCE_MINUTES: Record<ReminderStage, number> = {
  "24h": 6 * 60,
  "2h": 45,
  near_start: 10
};

const MINUTE_MS = 60 * 1000;

/** The instant a stage's reminder should fire for something starting at `startAtMs`. */
export function reminderDueAtMs(startAtMs: number, stage: ReminderStage): number {
  return startAtMs - REMINDER_OFFSET_MINUTES[stage] * MINUTE_MS;
}

// ---------------------------------------------------------------------------
// Which stages are worth scheduling at all
// ---------------------------------------------------------------------------

/**
 * Should this stage be enqueued for something starting at `startAtMs`?
 *
 * SAME-DAY CREATION is the case this exists for. An event created 90 minutes
 * before it starts has already missed its 24h reminder and is inside its 2h
 * one; scheduling those would either fire immediately as stale catch-up spam
 * or sit in the queue as guaranteed no-ops. Only stages whose moment is still
 * ahead -- or so recently past that they remain useful -- are scheduled.
 *
 * The tolerance is applied here as well as at delivery so the queue does not
 * fill with jobs that can only ever no-op.
 */
export function shouldScheduleStage(startAtMs: number, stage: ReminderStage, nowMs: number): boolean {
  const dueAtMs = reminderDueAtMs(startAtMs, stage);
  if (dueAtMs >= nowMs) return true;
  // Already past: worth scheduling only if still inside tolerance AND the
  // thing itself has not started.
  return isReminderStillUseful(startAtMs, stage, nowMs);
}

/**
 * Is a reminder still worth DELIVERING right now?
 *
 * Checked again at delivery time, not only at scheduling time: a job queued
 * before a maintenance window may be claimed long after, and the queue itself
 * carries no notion of "too late to matter".
 */
export function isReminderStillUseful(startAtMs: number, stage: ReminderStage, nowMs: number): boolean {
  // NOTHING pre-start fires once the thing has begun. This is deliberately
  // checked for every stage, not just near_start: a 24h reminder arriving
  // mid-event is nonsense even though six hours of tolerance would otherwise
  // allow it.
  if (nowMs >= startAtMs) return false;

  const dueAtMs = reminderDueAtMs(startAtMs, stage);
  if (nowMs < dueAtMs) return false; // not due yet

  const lateByMs = nowMs - dueAtMs;
  return lateByMs <= REMINDER_OVERDUE_TOLERANCE_MINUTES[stage] * MINUTE_MS;
}

/** The stages worth scheduling for something starting at `startAtMs`. */
export function schedulableStages(startAtMs: number, nowMs: number): ReminderStage[] {
  return REMINDER_STAGES.filter((stage) => shouldScheduleStage(startAtMs, stage, nowMs));
}

// ---------------------------------------------------------------------------
// Identity: idempotency and reschedule safety
// ---------------------------------------------------------------------------

/**
 * The canonical dedupe identity for one reminder.
 *
 * RESCHEDULE SAFETY WITHOUT A SCHEMA FIELD. The start timestamp is part of
 * the key, so moving an event from Friday 19:00 to Saturday 20:00 produces
 * entirely different keys: the new time enqueues fresh jobs, and the stale
 * ones cannot collide with them. The stale jobs are additionally harmless
 * because delivery revalidates the start time against canonical state before
 * sending (see the handler) -- identity stops duplicates, revalidation stops
 * wrong sends, and neither depends on physically deleting the old rows.
 *
 * Paired with the partial unique index on jobs(idempotency_key), a repeated
 * scan enqueues nothing extra: the second insert is rejected by the database,
 * which is the same at-most-once mechanism periodic job scheduling already
 * relies on.
 */
export function reminderIdempotencyKey(input: {
  domain: ReminderDomain;
  itemId: string;
  userId: string;
  stage: ReminderStage;
  startAtMs: number;
}): string {
  return [
    "reminder",
    input.domain,
    input.itemId,
    input.userId,
    input.stage,
    String(input.startAtMs)
  ].join(":");
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * Plan participation states that receive attendance reminders.
 *
 * going  -- committed, the obvious case.
 * maybe  -- reminded, because an undecided person is exactly who a reminder
 *           helps; the copy stays neutral rather than asserting they are
 *           attending (see reminderCopy).
 *
 * NOT reminded: not_going and removed (they said no), waitlisted (no seat to
 * turn up for), and -- deliberately -- `invited`/`viewed`. Someone who never
 * answered has not committed to anything, and reminding them as though they
 * had is how a reminder system starts feeling like nagging. They still see
 * the plan on the Plans page and in their agenda.
 */
export const PLAN_REMINDER_RSVP_STATUSES: readonly RsvpStatus[] = ["going", "maybe"];

export function planRsvpWantsReminder(status: RsvpStatus): boolean {
  return (PLAN_REMINDER_RSVP_STATUSES as readonly string[]).includes(status);
}

/**
 * Event RSVP states that receive attendance reminders.
 *
 * Only `going`. `interested` is explicitly excluded by the Stage C product
 * decision -- interest is not attendance, and Interested-only events never
 * reach the personal agenda either, so reminding about them would contradict
 * the surface the user actually sees.
 */
export function eventRsvpWantsReminder(status: EventRsvpStatus): boolean {
  return status === "going";
}

/** Plan statuses that can still produce a reminder. */
export function planStatusAllowsReminder(status: PlanStatus): boolean {
  // Mirrors the "still going to happen" set the Stage A+B lifecycle uses:
  // draft is unpublished, and cancelled/completed/expired are over.
  return status === "inviting" || status === "polling" || status === "confirmed";
}

/** Event statuses that can still produce a reminder. */
export function eventStatusAllowsReminder(status: string): boolean {
  // `active` is included because an event may be marked active slightly
  // before its start instant; the start-time check in isReminderStillUseful
  // is what actually stops a mid-event reminder.
  return status === "scheduled" || status === "active";
}
