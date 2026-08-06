import "server-only";

import { deliverNotification } from "@/lib/notifications/server";
import {
  assessSchedulerHealth,
  type SchedulerHealth,
  type TickRun
} from "@/lib/jobs/scheduler-health";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Delivery for scheduler incidents.
 *
 * The decision of WHETHER an incident exists belongs entirely to
 * scheduler-health.ts, which is pure and knows nothing about notifications.
 * This module only carries that decision to the Owners, and owns the state
 * that makes "one alert per incident" true.
 *
 * Two guarantees, both enforced in the database rather than in memory:
 *
 *  - ONE ALERT PER INCIDENT. A partial unique index allows a single open
 *    incident row, and `alerted_at` is set with a compare-and-swap, so two
 *    concurrent ticks cannot both notify.
 *  - RESTART SAFE. The tick runs in a serverless function that does not
 *    survive between invocations. Holding this in memory would re-alert every
 *    five minutes during an outage and lose the incident across a deployment.
 *
 * Nothing here reports a job payload, a user, or a secret — an incident is
 * counts and timestamps.
 */

/** The scheduler this module watches. */
export const CRON_SCHEDULER = "cron-tick-5min";

/** How many recent runs to assess. Enough to see a pattern, not a history. */
const RUN_WINDOW = 12;

export type SchedulerAlertOutcome =
  | { action: "none"; health: SchedulerHealth }
  | { action: "alerted"; health: SchedulerHealth; ownersNotified: number }
  | { action: "recovered"; health: SchedulerHealth; ownersNotified: number; outageMinutes: number };

/**
 * Every Owner who can receive a notification.
 *
 * Owners only — not admins and not support. A scheduler outage is an
 * operational emergency for whoever runs the product, and paging the wider
 * team for it would train them to ignore the alert.
 *
 * An Owner with no linked auth user cannot be notified through the in-app
 * pipeline and is skipped rather than failed on.
 */
async function ownerUserIds(admin: Admin): Promise<string[]> {
  const { data } = await admin
    .from("admin_users")
    .select("auth_user_id")
    .eq("role", "owner")
    .is("disabled_at", null);

  return (data ?? [])
    .map((row) => row.auth_user_id)
    .filter((id): id is string => Boolean(id));
}

async function notifyOwners(
  admin: Admin,
  input: { title: string; message: string }
): Promise<number> {
  const owners = await ownerUserIds(admin);
  if (owners.length === 0) return 0;

  await Promise.all(
    owners.map((userId) =>
      deliverNotification(admin, {
        userId,
        // Critical: an unrunnable scheduler stops safe_arrival.unconfirmed_alert,
        // so this must bypass quiet hours like any other safety-critical send.
        priority: "critical",
        // The existing canonical type for operational alerts — no new
        // notification channel is introduced.
        type: "system_alert",
        title: input.title,
        message: input.message
      })
    )
  );

  return owners.length;
}

/** Concise, count-only incident copy. */
function incidentMessage(health: SchedulerHealth, detectedAt: Date): string {
  const lines = [
    "Scheduler status: DOWN",
    `Consecutive failures: ${health.consecutiveFailures}`,
    `Missing ticks: ${health.missing ? "yes" : "no"}`,
    `Time detected: ${detectedAt.toISOString()}`
  ];
  return lines.join("\n");
}

function recoveryMessage(outageMinutes: number, failures: number, recoveredAt: Date): string {
  const lines = [
    `Outage duration: ${outageMinutes} minute${outageMinutes === 1 ? "" : "s"}`,
    `Failed ticks: ${failures}`,
    `Recovery time: ${recoveredAt.toISOString()}`,
    "Ticks resumed successfully."
  ];
  return lines.join("\n");
}

/**
 * Assess the scheduler and deliver any incident or recovery notice.
 *
 * Called from the cron tick itself, so the scheduler's own health is checked
 * by the thing it schedules. That has one deliberate limitation: a scheduler
 * that has stopped firing entirely cannot check itself. The GitHub backstop
 * covers exactly that case — it hits the same endpoint, so it runs this check
 * even while the primary is dead, which is the scenario worth catching.
 */
export async function checkSchedulerHealthAndAlert(
  admin: Admin,
  nowMs = Date.now()
): Promise<SchedulerAlertOutcome> {
  const runs = await recentRuns(admin);
  const health = assessSchedulerHealth(runs, nowMs);

  const { data: open } = await admin
    .from("scheduler_incidents")
    .select("id, opened_at, alerted_at, recovery_notified_at, consecutive_failures")
    .eq("scheduler", CRON_SCHEDULER)
    .is("resolved_at", null)
    .maybeSingle();

  // ---- Healthy: close anything open and say so once. --------------------
  if (health.state === "healthy") {
    if (!open) return { action: "none", health };

    const resolvedAt = new Date(nowMs);
    // Claim the resolution first: a concurrent tick that loses this update
    // gets zero rows and sends nothing.
    const { data: claimed } = await admin
      .from("scheduler_incidents")
      .update({ resolved_at: resolvedAt.toISOString(), recovery_notified_at: resolvedAt.toISOString() })
      .eq("id", open.id)
      .is("resolved_at", null)
      .select("id, opened_at, consecutive_failures");

    if (!claimed?.length) return { action: "none", health };

    const outageMinutes = Math.max(
      0,
      Math.round((nowMs - Date.parse(claimed[0]!.opened_at)) / 60_000)
    );
    const ownersNotified = await notifyOwners(admin, {
      title: "Scheduler Recovered",
      message: recoveryMessage(outageMinutes, claimed[0]!.consecutive_failures, resolvedAt)
    });

    return { action: "recovered", health, ownersNotified, outageMinutes };
  }

  // ---- Degraded: a single blip. Watch, do not page. ---------------------
  if (!health.shouldAlert) return { action: "none", health };

  // ---- Down: open an incident if there is not one already. --------------
  const detectedAt = new Date(nowMs);

  if (open) {
    // Already open. Alert only if a previous attempt failed before recording
    // that it had notified — never a second time for the same incident.
    if (open.alerted_at) return { action: "none", health };

    const { data: claimed } = await admin
      .from("scheduler_incidents")
      .update({ alerted_at: detectedAt.toISOString(), consecutive_failures: health.consecutiveFailures })
      .eq("id", open.id)
      .is("alerted_at", null)
      .select("id");
    if (!claimed?.length) return { action: "none", health };

    const ownersNotified = await notifyOwners(admin, {
      title: "Scheduler Health Alert",
      message: incidentMessage(health, detectedAt)
    });
    return { action: "alerted", health, ownersNotified };
  }

  // No open incident: create one. The partial unique index means a concurrent
  // tick attempting the same insert fails, and that tick simply does nothing.
  const { data: created, error } = await admin
    .from("scheduler_incidents")
    .insert({
      scheduler: CRON_SCHEDULER,
      opened_at: detectedAt.toISOString(),
      consecutive_failures: health.consecutiveFailures,
      missing_ticks: health.missing,
      alerted_at: detectedAt.toISOString()
    })
    .select("id")
    .maybeSingle();

  // Lost the race to another tick: it is alerting, so this one stays quiet.
  if (error || !created) return { action: "none", health };

  const ownersNotified = await notifyOwners(admin, {
    title: "Scheduler Health Alert",
    message: incidentMessage(health, detectedAt)
  });

  return { action: "alerted", health, ownersNotified };
}

/**
 * The recent run history, read through the existing diagnostics function.
 *
 * Reuses admin_cron_tick_runs rather than querying cron.job_run_details
 * directly, so there is one definition of "what a tick run looks like".
 */
async function recentRuns(admin: Admin): Promise<TickRun[]> {
  const { data } = await admin.rpc("admin_cron_tick_runs", { p_limit: RUN_WINDOW });

  return (data ?? []).map((row) => ({
    startedAtMs: Date.parse(row.started_at),
    status: row.status
  }));
}
