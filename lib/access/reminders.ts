import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/server";

/**
 * WELCOME ACCESS REMINDERS.
 *
 * Welcome Access is a temporary ad-free period, not a feature trial. Mad Buddy
 * keeps working when it ends; the only product change is that the account may
 * become eligible for advertising when the Admin advertising switches are on.
 *
 * The reminder schedule stays deliberately light:
 *
 *   4 days left   early enough to make an informed renewal choice
 *   1 day left    the final useful heads-up
 *
 * No expiry-day push is sent. Settings -> Mad Buddy Access always carries the
 * current state, and two reminders are enough for a benefit that ends without
 * taking away the app or charging anyone automatically.
 *
 * ── NO DARK PATTERNS ──────────────────────────────────────────────────────
 *
 * Copy says exactly what changes: the ad-free period ends. It never suggests
 * Linkr, UpFor, relationships, conversations or Plans will disappear; never
 * invents people waiting or false urgency; and states that Welcome Access does
 * not charge or renew itself.
 *
 * ── IDEMPOTENCY ───────────────────────────────────────────────────────────
 *
 * Overlapping cron runs, retries after a partial failure, and a job that runs
 * twice in a minute must not produce two identical notifications. The dedupe
 * key is (grant, milestone), recorded in `access_reminder_log`, with a unique
 * constraint doing the enforcing -- so correctness does not depend on the job
 * running exactly once.
 */

/** Days-remaining thresholds that produce a notification. */
export const REMINDER_MILESTONES = [
  { key: "welcome_t4", daysRemaining: 4 },
  { key: "welcome_t1", daysRemaining: 1 }
] as const;

export type ReminderMilestone = (typeof REMINDER_MILESTONES)[number]["key"];

const COPY: Record<ReminderMilestone, { title: string; message: string }> = {
  welcome_t4: {
    title: "4 ad-free days left",
    message:
      "Your Welcome Access ends in 4 days. Mad Buddy, including Linkr and UpFor, stays available afterward; ads may appear if advertising is enabled. Nothing will be charged automatically."
  },
  welcome_t1: {
    title: "Your ad-free Welcome Access ends tomorrow",
    message:
      "Mad Buddy stays available when it ends. Your account may start showing ads if advertising is enabled. Welcome Access does not renew or charge you automatically."
  }
};

/**
 * Whole days from now until `expiresAt`, rounded up — the same arithmetic the
 * resolver uses, so a reminder never disagrees with the Settings page.
 */
function daysRemaining(expiresAt: string, now: Date): number {
  const ms = Date.parse(expiresAt) - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

export type ReminderRun = {
  considered: number;
  sent: number;
  skippedAlreadySent: number;
  skippedHasOtherAccess: number;
};

/**
 * Send due Welcome Access reminders.
 *
 * Safe to run on any schedule and safe to run twice.
 */
export async function processWelcomeAccessReminders(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  now: Date = new Date()
): Promise<ReminderRun> {
  const run: ReminderRun = { considered: 0, sent: 0, skippedAlreadySent: 0, skippedHasOtherAccess: 0 };
  const nowIso = now.toISOString();

  /* Only live welcome grants inside the widest reminder window. Bounded by the
     window rather than scanning every grant ever issued. */
  const horizon = new Date(now.getTime() + REMINDER_MILESTONES[0].daysRemaining * 86_400_000).toISOString();

  const { data: grants } = await admin
    .from("access_grants")
    .select("id, user_id, expires_at")
    .eq("source", "welcome_access")
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .lte("expires_at", horizon);

  for (const grant of grants ?? []) {
    if (!grant.expires_at) continue;
    run.considered += 1;

    const remaining = daysRemaining(grant.expires_at, now);
    const milestone = REMINDER_MILESTONES.find((m) => m.daysRemaining === remaining);
    if (!milestone) continue;

    /* DO NOT WARN SOMEBODY WHOSE AD-FREE ACCESS IS NOT ACTUALLY ENDING.
     *
     * A person may hold a paid subscription, an admin grant, or be covered by
     * a global promotion at the same time as their welcome window. Their
     * welcome grant expiring changes nothing for them, and telling them their
     * ad-free period ends would be false. Sources remain independent. */
    const [{ data: otherGrants }, { data: globalWindows }, { data: subscription }] = await Promise.all([
      admin
        .from("access_grants")
        .select("id")
        .eq("user_id", grant.user_id)
        .neq("source", "welcome_access")
        .is("revoked_at", null)
        .lte("starts_at", nowIso)
        .or(`expires_at.is.null,expires_at.gt.${grant.expires_at}`)
        .limit(1),
      admin
        .from("access_global_windows")
        .select("id")
        .is("revoked_at", null)
        .lte("starts_at", nowIso)
        .or(`expires_at.is.null,expires_at.gt.${grant.expires_at}`)
        .limit(1),
      admin
        .from("subscriptions")
        .select("id")
        .eq("user_id", grant.user_id)
        .in("status", ["active", "trialing"])
        .limit(1)
        .maybeSingle()
    ]);

    if ((otherGrants ?? []).length > 0 || (globalWindows ?? []).length > 0 || subscription) {
      run.skippedHasOtherAccess += 1;
      continue;
    }

    /* THE DEDUPE. Claim the (grant, milestone) pair first; a unique violation
       means another run already sent it. Claiming BEFORE sending means the
       worst case is a missed reminder, never a duplicate one -- the right way
       round for something that interrupts a person. */
    const { error: claimError } = await admin
      .from("access_reminder_log")
      .insert({ grant_id: grant.id, user_id: grant.user_id, milestone: milestone.key });

    if (claimError) {
      run.skippedAlreadySent += 1;
      continue;
    }

    const copy = COPY[milestone.key];
    await createNotification(admin, {
      userId: grant.user_id,
      type: "system_alert",
      title: copy.title,
      message: copy.message
    });
    run.sent += 1;
  }

  return run;
}
