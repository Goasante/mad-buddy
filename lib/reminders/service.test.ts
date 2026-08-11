import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { SCHEDULE } from "@/lib/jobs/rules";
import {
  REMINDER_SCAN_ENQUEUE_LIMIT,
  REMINDER_SCAN_HORIZON_MINUTES,
  REMINDER_SCAN_ITEM_LIMIT
} from "@/lib/reminders/service";
import { REMINDER_OFFSET_MINUTES } from "@/lib/reminders/rules";

/**
 * Reminder scanning and delivery (Stage D).
 *
 * The service is server-only and admin-client backed, so these are
 * source-text assertions on the guarantees -- the same pattern
 * lib/events/rsvp-and-agenda.test.ts and lib/social/plan-lifecycle-surfaces
 * .test.ts already use. What is asserted is structural: batching, bounded
 * queries, revalidation, and the absence of any quiet-hours bypass.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const service = stripComments(read("lib/reminders/service.ts"));
const handlers = stripComments(read("lib/jobs/handlers.ts"));
const copy = stripComments(read("lib/reminders/copy.ts"));

// ---------------------------------------------------------------------------
// The scan is bounded — this is what protects the cron optimization
// ---------------------------------------------------------------------------

describe("reminder discovery is bounded", () => {
  it("looks far enough ahead to cover the largest offset", () => {
    // A 24h reminder must be enqueued before its moment arrives; the margin
    // absorbs a missed scan without losing the stage.
    expect(REMINDER_SCAN_HORIZON_MINUTES).toBeGreaterThan(REMINDER_OFFSET_MINUTES["24h"]);
  });

  it("queries a CLOSED time window, never the whole table", () => {
    // Both bounds present for both domains: the cost is a function of what is
    // happening in the next day, not of how much has ever happened.
    expect((service.match(/\.gte\("start_at", nowIso\)/g) ?? []).length).toBe(1);
    expect((service.match(/\.lte\("start_at", horizonIso\)/g) ?? []).length).toBe(1);
    expect((service.match(/\.gte\("starts_at", nowIso\)/g) ?? []).length).toBe(1);
    expect((service.match(/\.lte\("starts_at", horizonIso\)/g) ?? []).length).toBe(1);
  });

  it("caps the rows read per scan", () => {
    expect(REMINDER_SCAN_ITEM_LIMIT).toBeGreaterThan(0);
    expect((service.match(/\.limit\(REMINDER_SCAN_ITEM_LIMIT\)/g) ?? []).length).toBe(2);
  });

  it("caps the jobs enqueued per scan", () => {
    expect(REMINDER_SCAN_ENQUEUE_LIMIT).toBeGreaterThan(0);
    expect(service).toContain("rows.length >= REMINDER_SCAN_ENQUEUE_LIMIT");
  });

  it("excludes undated plans by construction", () => {
    // A null start_at matches neither bound, so Stage A+B's unscheduled and
    // archived-unscheduled plans can never produce a reminder -- no separate
    // filter needed, and none can be forgotten.
    const planQuery = service.slice(service.indexOf('from("plans")'), service.indexOf('from("plan_participants")'));
    expect(planQuery).toContain('.gte("start_at", nowIso)');
    expect(planQuery).toContain('.lte("start_at", horizonIso)');
  });

  it("filters to live statuses in the query rather than after reading", () => {
    expect(service).toContain('.in("status", ["inviting", "polling", "confirmed"])');
    expect(service).toContain('.in("status", ["scheduled", "active"])');
  });
});

// ---------------------------------------------------------------------------
// No N+1
// ---------------------------------------------------------------------------

describe("recipients are resolved in batches", () => {
  it("reads all plan participants in one query, not one per plan", () => {
    const participants = service.slice(service.indexOf('from("plan_participants")'));
    expect(participants.slice(0, 200)).toContain('.in("plan_id", planIds)');
  });

  it("reads all event RSVPs in one query, not one per event", () => {
    const rsvps = service.slice(service.indexOf('from("event_rsvps")'));
    expect(rsvps.slice(0, 200)).toContain('.in("event_id", eventIds)');
  });

  it("asks the database for Going RSVPs only", () => {
    // Interested and not_going never reach the application at all, using the
    // (event_id, status) index Stage C added for exactly this read.
    const rsvps = service.slice(service.indexOf('from("event_rsvps")'));
    expect(rsvps.slice(0, 250)).toContain('.eq("status", "going")');
  });

  it("enqueues the whole batch in one insert", () => {
    expect((service.match(/\.from\("jobs"\)/g) ?? []).length).toBe(1);
    expect(service).toContain(".upsert(rows,");
  });

  it("uses the canonical batched block helper", () => {
    expect(service).toContain("batchBlockedIds");
    expect(service).not.toMatch(/from\(["']blocked_users["']\)/);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("repeated scans do not duplicate reminders", () => {
  it("gives every enqueued job the canonical idempotency key", () => {
    expect(service).toContain("idempotency_key: reminderIdempotencyKey({");
  });

  it("lets the database reject duplicates rather than tracking them itself", () => {
    // jobs_idempotency_unique is the guarantee; ignoreDuplicates keeps the
    // rest of the batch landing when part of it is already queued.
    expect(service).toContain('onConflict: "idempotency_key"');
    expect(service).toContain("ignoreDuplicates: true");
  });

  it("never schedules a job to run in the past", () => {
    // An overdue-but-still-useful stage runs now rather than being claimed as
    // work of unknown age.
    expect(service).toContain("Math.max(dueAtMs, nowMs)");
  });
});

// ---------------------------------------------------------------------------
// Delivery-time revalidation — trust nothing in the payload
// ---------------------------------------------------------------------------

describe("delivery revalidates canonical state", () => {
  it("re-reads the record rather than trusting the payload", () => {
    // Anchored on substrings that survive CRLF rather than a literal \n,
    // which does not match on a checkout where git has normalised line
    // endings -- caught by isolating this commit before landing it.
    const planDelivery = service.slice(service.indexOf("async function deliverPlanReminder"));
    expect(planDelivery).toContain('from("plans")');
    expect(planDelivery).toContain('.select("id, creator_id, title, start_at, status")');

    const eventDelivery = service.slice(service.indexOf("async function deliverEventReminder"));
    expect(eventDelivery).toContain('from("events")');
    expect((service.match(/\.eq\("id", payload\.itemId\)/g) ?? []).length).toBe(2);
  });

  it("detects a reschedule by comparing against canonical start", () => {
    // The single most important check: a stale job for the old time no-ops.
    expect((service.match(/startAtMs !== payload\.expectedStartAtMs/g) ?? []).length).toBe(2);
  });

  it("re-checks status, so a cancelled item delivers nothing", () => {
    expect(service).toContain("planStatusAllowsReminder(plan.status as PlanStatus)");
    expect(service).toContain("eventStatusAllowsReminder(event.status)");
  });

  it("re-checks the tolerance at delivery, not only at scheduling", () => {
    expect((service.match(/isReminderStillUseful\(startAtMs, payload\.stage, nowMs\)/g) ?? []).length).toBe(2);
  });

  it("re-checks participation, so a late change of mind stops the reminder", () => {
    expect(service).toContain("planRsvpWantsReminder(status)");
    expect(service).toContain("eventRsvpWantsReminder(rsvp.status as EventRsvpStatus)");
  });

  it("re-checks event access and blocks at delivery time", () => {
    const eventDelivery = service.slice(service.indexOf("async function deliverEventReminder"));
    expect(eventDelivery).toContain('event.visibility === "invite"');
    expect(eventDelivery).toContain("batchBlockedIds(admin, payload.userId, [event.host_id])");
  });

  it("returns a distinct outcome for each skip reason", () => {
    for (const outcome of ['"skipped_obsolete"', '"skipped_ineligible"', '"skipped_missing"']) {
      expect(service, outcome).toContain(outcome);
    }
  });
});

// ---------------------------------------------------------------------------
// Host behaviour
// ---------------------------------------------------------------------------

describe("hosts are reminded without fabricated rows", () => {
  it("derives host eligibility from canonical ownership", () => {
    expect(service).toContain("plan.creator_id === payload.userId");
    expect(service).toContain("event.host_id === payload.userId");
  });

  it("never writes a participant or RSVP row for the host", () => {
    // The Stage C rule: hosting and RSVPing stay separate concepts.
    expect(service).not.toContain('from("event_rsvps").insert');
    expect(service).not.toContain('from("plan_participants").insert');
    expect(service).not.toContain(".upsert({ event_id");
  });

  it("does not remind a host twice when they also hold a participant row", () => {
    expect(service).toContain("if (!seen.has(plan.creator_id))");
    expect(service).toContain("if (!seen.has(event.host_id))");
  });
});

// ---------------------------------------------------------------------------
// Notification policy — no bypass
// ---------------------------------------------------------------------------

describe("reminders respect the existing notification policy", () => {
  it("sends through the one canonical delivery path", () => {
    expect((service.match(/await deliverNotification\(admin, \{/g) ?? []).length).toBe(2);
  });

  it("never marks a reminder critical", () => {
    // critical bypasses quiet hours and the budget; that is reserved for
    // Safe Arrival-class alerts, not "your plan starts soon".
    expect(service).not.toContain('priority: "critical"');
    expect((service.match(/priority: "normal"/g) ?? []).length).toBe(2);
  });

  it("does not re-implement preferences or quiet hours", () => {
    for (const forbidden of ["quietHours", "isWithinQuietHours", "decideNotification", "normalizePreferences"]) {
      expect(service, `${forbidden} belongs to the notification layer`).not.toContain(forbidden);
    }
  });

  it("uses the existing plans category for both domains", () => {
    // One user intent -- "something I am attending is starting" -- so no new
    // preference toggle is introduced.
    expect((service.match(/category: "plans"/g) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Routing and copy
// ---------------------------------------------------------------------------

describe("reminder notifications route to the real record", () => {
  it("uses the existing type convention the destination resolver understands", () => {
    expect(copy).toContain("`plan:${itemId}`");
    expect(copy).toContain("`event:${itemId}`");
  });

  it("keeps the narrow template-literal type rather than widening to string", () => {
    expect(copy).toContain("`plan:${string}` | `event:${string}`");
  });

  it("carries no check-in language, which is Stage E", () => {
    for (const forbidden of ["check in", "Check in", "checkin", "Are you here"]) {
      expect(copy, forbidden).not.toContain(forbidden);
    }
  });

  it("addresses a host as a host, not an attendee", () => {
    expect(copy).toContain("isHost");
  });

  it("softens the copy for a tentative participant", () => {
    expect(copy).toContain("isTentative");
    expect(copy).toContain("You said maybe.");
  });
});

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

describe("job payload stays minimal", () => {
  it("carries only identity, stage and the expected start", () => {
    const payloadType = service.slice(service.indexOf("export type ReminderJobPayload"));
    const body = payloadType.slice(0, payloadType.indexOf("};"));
    for (const field of ["domain", "itemId", "userId", "stage", "expectedStartAtMs"]) {
      expect(body, field).toContain(field);
    }
    // Nothing that would go stale or leak if the row sat in the queue.
    for (const field of ["title", "message", "venue", "profile", "location"]) {
      expect(body, field).not.toContain(field);
    }
  });

  it("validates the payload before use rather than casting it", () => {
    expect(handlers).toContain("function parseReminderPayload");
    expect(handlers).toContain('if (domain !== "plan" && domain !== "event") return null;');
    expect(handlers).toContain("if (!parsed) return 0;");
  });
});

// ---------------------------------------------------------------------------
// Scheduler integration
// ---------------------------------------------------------------------------

describe("the scan cooperates with the optimized scheduler", () => {
  it("is registered on SCHEDULE so isScheduleDue gates it", () => {
    const entry = SCHEDULE.find((spec) => spec.jobType === "reminders.scan");
    expect(entry).toBeDefined();
    expect(entry!.everyMinutes).toBe(15);
  });

  it("runs less often than the 5-minute tick", () => {
    // Delivery precision comes from each job's run_at, never from this
    // cadence, so scanning more often would buy nothing and cost DB work.
    const entry = SCHEDULE.find((spec) => spec.jobType === "reminders.scan")!;
    expect(entry.everyMinutes).toBeGreaterThan(5);
  });

  it("keeps delivery OFF the periodic schedule", () => {
    // reminders.deliver is created with an exact run_at; putting it on a
    // cadence would make it fire for everyone at once.
    expect(SCHEDULE.some((spec) => spec.jobType === "reminders.deliver")).toBe(false);
  });

  it("stays below the Safe Arrival alert in priority", () => {
    const safeArrival = SCHEDULE.find((spec) => spec.jobType === "safe_arrival.unconfirmed_alert")!;
    const scan = SCHEDULE.find((spec) => spec.jobType === "reminders.scan")!;
    expect(scan.priority).toBeGreaterThan(safeArrival.priority);
  });

  it("registers both handlers", () => {
    expect(handlers).toContain('"reminders.scan":');
    expect(handlers).toContain('"reminders.deliver":');
  });

  it("treats a skip as a completed no-op, not a retryable failure", () => {
    // A cancelled/declined/too-late reminder is permanently unprocessable;
    // retrying it five times before dead-lettering would be noise.
    expect(handlers).toContain('outcome === "delivered" ? 1 : 0');
  });
});
