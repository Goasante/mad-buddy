import "server-only";

import { deliverNotification } from "@/lib/notifications/server";
import { reminderCopy, reminderNotificationType } from "@/lib/reminders/copy";
import {
  eventRsvpWantsReminder,
  eventStatusAllowsReminder,
  isReminderStillUseful,
  planRsvpWantsReminder,
  planStatusAllowsReminder,
  reminderDueAtMs,
  reminderIdempotencyKey,
  schedulableStages,
  type ReminderDomain,
  type ReminderStage
} from "@/lib/reminders/rules";
import type { JobStatus, JobType } from "@/lib/jobs/rules";
import { batchBlockedIds } from "@/lib/social/permissions";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { EventRsvpStatus, PlanStatus, RsvpStatus } from "@/lib/supabase/database.types";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Plan and Event reminder scheduling and delivery (Stage D).
 *
 * TWO JOBS, ONE PURPOSE.
 *
 *   reminders.scan     runs periodically, reads a bounded window of upcoming
 *                      Plans and Events, batch-resolves who should be
 *                      reminded, and enqueues one precisely-timed delivery
 *                      job per (item, user, stage).
 *
 *   reminders.deliver  runs at its own run_at, re-reads canonical state for
 *                      exactly one recipient, and sends or no-ops.
 *
 * WHY THIS SHAPE, rather than the two obvious alternatives:
 *
 *   Pre-creating everything when a Plan/Event is written cannot react to a
 *   person who RSVPs later, and would need cancellation logic on every RSVP
 *   change, reschedule and cancellation -- three places to get wrong.
 *
 *   Re-scanning and re-deciding everything on every tick is precisely the
 *   cost pattern the cron optimization removed. It would also mean the
 *   reminder's accuracy depends on tick cadence: a 5-minute scan can only
 *   ever fire a "30 minutes before" reminder somewhere in a 5-minute band.
 *
 * The hybrid keeps scanning cheap and infrequent while delivery stays exact,
 * and the database's own unique index makes repeated scans free of duplicates
 * rather than requiring the scan to remember what it already did.
 */

/**
 * How far ahead the scan looks.
 *
 * Must exceed the largest reminder offset (24h) so a 24h reminder is enqueued
 * before its moment arrives; the margin absorbs a missed scan without losing
 * the stage. Bounded on BOTH sides -- the query never looks at the past and
 * never at the whole table -- so its cost is a function of how much is
 * happening in the next day and a bit, not of how much has ever happened.
 */
export const REMINDER_SCAN_HORIZON_MINUTES = 26 * 60;

/** Upper bound on rows read per scan, per domain. Keeps one tick bounded. */
export const REMINDER_SCAN_ITEM_LIMIT = 200;

/** Upper bound on delivery jobs enqueued per scan. */
export const REMINDER_SCAN_ENQUEUE_LIMIT = 2_000;

export type ReminderJobPayload = {
  domain: ReminderDomain;
  itemId: string;
  userId: string;
  stage: ReminderStage;
  /**
   * The start instant this job was scheduled against.
   *
   * The ONLY reason it is in the payload: delivery compares it to canonical
   * state to detect a reschedule. It is never trusted as the source of truth
   * for anything -- the record is re-read at delivery and its own start wins.
   */
  expectedStartAtMs: number;
};

type Candidate = {
  domain: ReminderDomain;
  itemId: string;
  userId: string;
  startAtMs: number;
};

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Finds everyone who should be reminded about something in the next horizon
 * and enqueues their delivery jobs.
 *
 * BATCHED THROUGHOUT. One query for upcoming Plans, one for their
 * participants, one for upcoming Events, one for their RSVPs, one for blocks
 * -- never one per item and never one per participant. A Plan with 100
 * Muddies costs the same number of round trips as a Plan with 2.
 */
export async function scanAndEnqueueReminders(admin: Admin, nowMs = Date.now()): Promise<number> {
  const horizonMs = nowMs + REMINDER_SCAN_HORIZON_MINUTES * 60 * 1000;
  const nowIso = new Date(nowMs).toISOString();
  const horizonIso = new Date(horizonMs).toISOString();

  const [planCandidates, eventCandidates] = await Promise.all([
    collectPlanCandidates(admin, nowIso, horizonIso),
    collectEventCandidates(admin, nowIso, horizonIso)
  ]);

  const candidates = [...planCandidates, ...eventCandidates];
  if (candidates.length === 0) return 0;

  const rows: Array<{
    job_type: JobType;
    payload: ReminderJobPayload;
    priority: number;
    status: JobStatus;
    idempotency_key: string;
    run_at: string;
  }> = [];

  for (const candidate of candidates) {
    for (const stage of schedulableStages(candidate.startAtMs, nowMs)) {
      if (rows.length >= REMINDER_SCAN_ENQUEUE_LIMIT) break;
      const dueAtMs = reminderDueAtMs(candidate.startAtMs, stage);
      rows.push({
        job_type: "reminders.deliver",
        payload: {
          domain: candidate.domain,
          itemId: candidate.itemId,
          userId: candidate.userId,
          stage,
          expectedStartAtMs: candidate.startAtMs
        },
        priority: 5,
        status: "scheduled",
        idempotency_key: reminderIdempotencyKey({
          domain: candidate.domain,
          itemId: candidate.itemId,
          userId: candidate.userId,
          stage,
          startAtMs: candidate.startAtMs
        }),
        // Never in the past: a stage inside its tolerance runs immediately
        // rather than being claimed as overdue work of unknown age.
        run_at: new Date(Math.max(dueAtMs, nowMs)).toISOString()
      });
    }
  }

  if (rows.length === 0) return 0;

  // ONE insert for the whole batch. Rows whose idempotency key already exists
  // are rejected by jobs_idempotency_unique rather than duplicated, which is
  // what makes re-running the scan free -- ignoreDuplicates keeps the rest of
  // the batch landing when some of it is already queued.
  const { data, error } = await admin
    .from("jobs")
    .upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true })
    .select("id");

  if (error) return 0;
  return data?.length ?? 0;
}

/** Upcoming Plans in the window, expanded to one candidate per eligible participant. */
async function collectPlanCandidates(
  admin: Admin,
  nowIso: string,
  horizonIso: string
): Promise<Candidate[]> {
  // BOUNDED AND INDEXED: plans_start_idx covers start_at, and the window is
  // closed at both ends. Undated plans are excluded by the range itself --
  // a null start_at matches neither bound -- so Stage A+B's unscheduled and
  // archived-unscheduled plans can never produce a reminder.
  const { data: plans } = await admin
    .from("plans")
    .select("id, creator_id, title, start_at, status")
    .gte("start_at", nowIso)
    .lte("start_at", horizonIso)
    .in("status", ["inviting", "polling", "confirmed"])
    .order("start_at", { ascending: true })
    .limit(REMINDER_SCAN_ITEM_LIMIT);

  const rows = plans ?? [];
  if (rows.length === 0) return [];

  const planIds = rows.map((plan) => plan.id);
  const { data: participants } = await admin
    .from("plan_participants")
    .select("plan_id, user_id, rsvp_status")
    .in("plan_id", planIds);

  const byPlan = new Map<string, Array<{ user_id: string; rsvp_status: string }>>();
  for (const row of participants ?? []) {
    const list = byPlan.get(row.plan_id) ?? [];
    list.push({ user_id: row.user_id, rsvp_status: row.rsvp_status });
    byPlan.set(row.plan_id, list);
  }

  const candidates: Candidate[] = [];
  for (const plan of rows) {
    const startAtMs = Date.parse(plan.start_at as string);
    if (!Number.isFinite(startAtMs)) continue;

    const seen = new Set<string>();
    for (const participant of byPlan.get(plan.id) ?? []) {
      if (!planRsvpWantsReminder(participant.rsvp_status as RsvpStatus)) continue;
      if (seen.has(participant.user_id)) continue;
      seen.add(participant.user_id);
      candidates.push({ domain: "plan", itemId: plan.id, userId: participant.user_id, startAtMs });
    }

    // The host, from canonical ownership rather than a fabricated participant
    // row. Added only if they are not already present as a participant, so a
    // creator who also holds a going row is not reminded twice.
    if (!seen.has(plan.creator_id)) {
      candidates.push({ domain: "plan", itemId: plan.id, userId: plan.creator_id, startAtMs });
    }
  }

  return candidates;
}

/** Upcoming Events in the window, expanded to Going RSVPs plus the host. */
async function collectEventCandidates(
  admin: Admin,
  nowIso: string,
  horizonIso: string
): Promise<Candidate[]> {
  // events_time_idx covers starts_at; same closed window as plans.
  const { data: events } = await admin
    .from("events")
    .select("id, host_id, name, starts_at, status")
    .gte("starts_at", nowIso)
    .lte("starts_at", horizonIso)
    .in("status", ["scheduled", "active"])
    .order("starts_at", { ascending: true })
    .limit(REMINDER_SCAN_ITEM_LIMIT);

  const rows = events ?? [];
  if (rows.length === 0) return [];

  const eventIds = rows.map((event) => event.id);
  // Only `going`. Interested and not_going never reach this query at all,
  // using the (event_id, status) index Stage C added for exactly this read.
  const { data: rsvps } = await admin
    .from("event_rsvps")
    .select("event_id, user_id, status")
    .in("event_id", eventIds)
    .eq("status", "going");

  const byEvent = new Map<string, string[]>();
  for (const row of rsvps ?? []) {
    const list = byEvent.get(row.event_id) ?? [];
    list.push(row.user_id);
    byEvent.set(row.event_id, list);
  }

  // Blocks, in one batched pass for every host at once -- the same helper and
  // the same reasoning as the Stage C fix: a reminder must not reach someone
  // who can no longer see the event it is about.
  const hostIds = [...new Set(rows.map((event) => event.host_id))];
  const blockedByViewer = new Map<string, Set<string>>();
  const allViewerIds = [...new Set((rsvps ?? []).map((row) => row.user_id))];
  await Promise.all(
    allViewerIds.map(async (viewerId) => {
      blockedByViewer.set(viewerId, await batchBlockedIds(admin, viewerId, hostIds));
    })
  );

  const candidates: Candidate[] = [];
  for (const event of rows) {
    const startAtMs = Date.parse(event.starts_at as string);
    if (!Number.isFinite(startAtMs)) continue;

    const seen = new Set<string>();
    for (const userId of byEvent.get(event.id) ?? []) {
      if (blockedByViewer.get(userId)?.has(event.host_id)) continue;
      if (seen.has(userId)) continue;
      seen.add(userId);
      candidates.push({ domain: "event", itemId: event.id, userId, startAtMs });
    }

    // Host by projection, never an event_rsvps row -- the Stage C rule.
    if (!seen.has(event.host_id)) {
      candidates.push({ domain: "event", itemId: event.id, userId: event.host_id, startAtMs });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export type ReminderDeliveryOutcome =
  | "delivered"
  | "skipped_obsolete"
  | "skipped_ineligible"
  | "skipped_missing";

/**
 * Delivers one reminder, after re-reading everything it depends on.
 *
 * FAILS CLOSED, AND TRUSTS THE PAYLOAD FOR NOTHING except which record and
 * which person to look up. The record may have been cancelled, moved,
 * deleted, declined or blocked since the job was queued -- possibly hours ago
 * if it sat through a maintenance window -- so every condition is checked
 * against canonical state at this instant.
 */
export async function deliverReminder(
  admin: Admin,
  payload: ReminderJobPayload,
  nowMs = Date.now()
): Promise<ReminderDeliveryOutcome> {
  return payload.domain === "plan"
    ? deliverPlanReminder(admin, payload, nowMs)
    : deliverEventReminder(admin, payload, nowMs);
}

async function deliverPlanReminder(
  admin: Admin,
  payload: ReminderJobPayload,
  nowMs: number
): Promise<ReminderDeliveryOutcome> {
  const { data: plan } = await admin
    .from("plans")
    .select("id, creator_id, title, start_at, status")
    .eq("id", payload.itemId)
    .maybeSingle();

  if (!plan) return "skipped_missing";
  if (!planStatusAllowsReminder(plan.status as PlanStatus)) return "skipped_ineligible";
  if (!plan.start_at) return "skipped_obsolete";

  const startAtMs = Date.parse(plan.start_at);
  if (!Number.isFinite(startAtMs)) return "skipped_obsolete";
  // RESCHEDULE CHECK. The plan moved since this job was queued, so a fresh
  // scan has already enqueued the correct jobs for the new time and this one
  // is stale by construction.
  if (startAtMs !== payload.expectedStartAtMs) return "skipped_obsolete";
  if (!isReminderStillUseful(startAtMs, payload.stage, nowMs)) return "skipped_obsolete";

  const isHost = plan.creator_id === payload.userId;
  let isTentative = false;

  if (!isHost) {
    const { data: participant } = await admin
      .from("plan_participants")
      .select("rsvp_status")
      .eq("plan_id", payload.itemId)
      .eq("user_id", payload.userId)
      .maybeSingle();
    if (!participant) return "skipped_ineligible";
    const status = participant.rsvp_status as RsvpStatus;
    // Covers the "changed their mind after the job was queued" case: a
    // not_going or removed participant is simply no longer eligible.
    if (!planRsvpWantsReminder(status)) return "skipped_ineligible";
    isTentative = status === "maybe";
  }

  const copy = reminderCopy({
    domain: "plan",
    stage: payload.stage,
    title: plan.title,
    startAtMs,
    isHost,
    isTentative
  });

  // deliverNotification owns preferences, quiet hours, Exam Mode and the
  // daily budget. Stage D re-implements none of that and cannot bypass it:
  // priority stays "normal", so quiet hours suppress the push exactly as they
  // do for every other non-critical notification.
  await deliverNotification(admin, {
    userId: payload.userId,
    type: reminderNotificationType("plan", plan.id),
    title: copy.title,
    message: copy.message,
    category: "plans",
    priority: "normal",
    senderId: null
  });

  return "delivered";
}

async function deliverEventReminder(
  admin: Admin,
  payload: ReminderJobPayload,
  nowMs: number
): Promise<ReminderDeliveryOutcome> {
  const { data: event } = await admin
    .from("events")
    .select("id, host_id, name, starts_at, status, visibility")
    .eq("id", payload.itemId)
    .maybeSingle();

  if (!event) return "skipped_missing";
  if (!eventStatusAllowsReminder(event.status)) return "skipped_ineligible";

  const startAtMs = Date.parse(event.starts_at);
  if (!Number.isFinite(startAtMs)) return "skipped_obsolete";
  if (startAtMs !== payload.expectedStartAtMs) return "skipped_obsolete";
  if (!isReminderStillUseful(startAtMs, payload.stage, nowMs)) return "skipped_obsolete";

  const isHost = event.host_id === payload.userId;

  if (!isHost) {
    // Access can be revoked between queueing and delivery, so visibility and
    // blocks are both re-checked rather than assumed from scan time.
    if (event.visibility === "invite") return "skipped_ineligible";

    const blocked = await batchBlockedIds(admin, payload.userId, [event.host_id]);
    if (blocked.has(event.host_id)) return "skipped_ineligible";

    const { data: rsvp } = await admin
      .from("event_rsvps")
      .select("status")
      .eq("event_id", payload.itemId)
      .eq("user_id", payload.userId)
      .maybeSingle();
    if (!rsvp) return "skipped_ineligible";
    // Going -> Not Going since the job was queued: future reminders stop,
    // without deleting the RSVP row that recorded the decision.
    if (!eventRsvpWantsReminder(rsvp.status as EventRsvpStatus)) return "skipped_ineligible";
  }

  const copy = reminderCopy({
    domain: "event",
    stage: payload.stage,
    title: event.name,
    startAtMs,
    isHost
  });

  await deliverNotification(admin, {
    userId: payload.userId,
    type: reminderNotificationType("event", event.id),
    title: copy.title,
    message: copy.message,
    category: "plans",
    priority: "normal",
    senderId: null
  });

  return "delivered";
}
