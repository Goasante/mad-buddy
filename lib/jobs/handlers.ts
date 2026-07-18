import "server-only";

import { deliverNotification } from "@/lib/notifications/server";
import {
  gracePeriodEndMs,
  shouldSendUnconfirmedAlert,
  unconfirmedAlertMessage
} from "@/lib/safety/safe-arrival";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { JobType } from "@/lib/jobs/rules";

/**
 * Job handlers (feature architecture batch 14). Each returns a count of work
 * done, or throws a JobError with a classified code.
 *
 * These finally invoke the logic batches 5-13 wrote and tested but never ran.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export class JobError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "JobError";
  }
}

export type JobHandler = (admin: Admin, payload: Record<string, unknown>) => Promise<number>;

// ---------------------------------------------------------------------------
// Safe Arrival unconfirmed alert (batch 5 §9), the safety-critical one.
// ---------------------------------------------------------------------------

/**
 * Notifies trusted contacts when a traveller hasn't confirmed arrival and the
 * grace period has fully elapsed. Without this running, a Safe Arrival session
 * silently does nothing, which is the exact promise the feature makes.
 *
 * `unconfirmed_notified_at` is the latch: it is set before notifying and
 * filtered on read, so the alert fires at most once per session even if two
 * workers overlap.
 */
export const handleSafeArrivalUnconfirmedAlert: JobHandler = async (admin) => {
  const nowMs = Date.now();
  const { data: sessions, error } = await admin
    .from("safe_arrival_sessions")
    .select("id, traveller_id, status, expected_arrival_at, grace_period_minutes, unconfirmed_notified_at")
    .in("status", ["active", "grace_period", "extended"])
    .is("unconfirmed_notified_at", null)
    .limit(200);

  if (error) throw new JobError("DATABASE_TIMEOUT", error.message);

  let sent = 0;
  for (const session of sessions ?? []) {
    const timing = {
      expectedArrivalMs: Date.parse(session.expected_arrival_at),
      gracePeriodMinutes: session.grace_period_minutes,
      nowMs
    };

    if (
      !shouldSendUnconfirmedAlert({
        status: session.status,
        alreadyNotified: Boolean(session.unconfirmed_notified_at),
        timing
      })
    ) {
      continue;
    }

    // Claim the alert first. The guarded update means a concurrent worker that
    // already claimed it gets zero rows and skips, the alert can't double-send.
    const { data: claimed } = await admin
      .from("safe_arrival_sessions")
      .update({
        unconfirmed_notified_at: new Date(nowMs).toISOString(),
        status: "unconfirmed",
        updated_at: new Date(nowMs).toISOString()
      })
      .eq("id", session.id)
      .is("unconfirmed_notified_at", null)
      .select("id");
    if (!claimed?.length) continue;

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("user_id", session.traveller_id)
      .maybeSingle();
    const name = profile?.full_name?.trim() || "A Muddy";

    const { data: contacts } = await admin
      .from("safe_arrival_contacts")
      .select("contact_user_id")
      .eq("session_id", session.id)
      .neq("acknowledgement_status", "declined");

    await Promise.all(
      (contacts ?? []).map((contact) =>
        deliverNotification(admin, {
          userId: contact.contact_user_id,
          priority: "critical",
          type: "safe_arrival:unconfirmed",
          title: "Safe Arrival check",
          // Neutral by construction, never "missing" (batch 5 §9).
          message: unconfirmedAlertMessage(name)
        })
      )
    );

    await admin.from("safe_arrival_events").insert({
      session_id: session.id,
      event_type: "unconfirmed_alert",
      created_by: null,
      metadata: { gracePeriodEndedAt: new Date(gracePeriodEndMs(timing)).toISOString() } as never
    });

    sent += 1;
  }

  return sent;
};

// ---------------------------------------------------------------------------
// Media deletion (batch 6 §45)
// ---------------------------------------------------------------------------

/** Drains the media deletion queue: removes objects, then marks the row done. */
export const handleMediaDeleteQueued: JobHandler = async (admin) => {
  const { data: queued, error } = await admin
    .from("media_deletion_queue")
    .select("id, media_asset_id")
    .is("processed_at", null)
    .limit(100);
  if (error) throw new JobError("DATABASE_TIMEOUT", error.message);

  let deleted = 0;
  for (const row of queued ?? []) {
    const { data: asset } = await admin
      .from("media_assets")
      .select("id, storage_key")
      .eq("id", row.media_asset_id)
      .maybeSingle();

    if (asset) {
      const { data: variants } = await admin
        .from("media_variants")
        .select("storage_key")
        .eq("media_asset_id", asset.id);

      const keys = [asset.storage_key, ...(variants ?? []).map((variant) => variant.storage_key)];
      // Storage removal is best-effort: a missing object is already the goal.
      await admin.storage.from("media").remove(keys);

      await admin
        .from("media_assets")
        .update({ deleted_at: new Date().toISOString(), storage_key: `deleted/${asset.id}` })
        .eq("id", asset.id);
    }

    await admin
      .from("media_deletion_queue")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", row.id);
    deleted += 1;
  }
  return deleted;
};

// ---------------------------------------------------------------------------
// Scheduled downgrades (batch 10 §44, §47)
// ---------------------------------------------------------------------------

/**
 * Applies downgrades whose effective date has passed. Privacy fails closed:
 * a subject losing advanced visibility is set hidden rather than left on a
 * broader audience (batch 10 §48).
 */
export const handleApplyScheduledDowngrade: JobHandler = async (admin) => {
  const nowIso = new Date().toISOString();
  const { data: changes, error } = await admin
    .from("subscription_changes")
    .select("id, user_id, to_plan, change_type")
    .eq("status", "scheduled")
    .lte("effective_at", nowIso)
    .limit(100);
  if (error) throw new JobError("DATABASE_TIMEOUT", error.message);

  let applied = 0;
  for (const change of changes ?? []) {
    // Guarded: a concurrent worker that already applied this gets zero rows.
    const { data: claimed } = await admin
      .from("subscription_changes")
      .update({ status: "applied", applied_at: nowIso })
      .eq("id", change.id)
      .eq("status", "scheduled")
      .select("id");
    if (!claimed?.length) continue;

    await admin
      .from("subscriptions")
      .update({ plan: change.to_plan, updated_at: nowIso })
      .eq("user_id", change.user_id);

    // Safe fallback: end any active glow session rather than let a paid
    // audience persist on a plan that no longer includes it.
    if (change.to_plan === "free") {
      await admin
        .from("visibility_sessions")
        .update({ status: "ended", updated_at: nowIso })
        .eq("user_id", change.user_id)
        .eq("status", "active");
    }

    await admin.from("domain_events").insert({
      event_type: "subscription.updated",
      resource_type: "subscription",
      resource_id: null,
      actor_id: change.user_id,
      payload: { changeType: change.change_type, toPlan: change.to_plan } as never
    });

    applied += 1;
  }
  return applied;
};

// ---------------------------------------------------------------------------
// Expiry sweeps (spec §31)
// ---------------------------------------------------------------------------

function expirySweep(config: {
  table:
    | "user_statuses"
    | "visibility_sessions"
    | "meeting_pings"
    | "moments"
    | "muddy_drops"
    | "invite_links"
    | "friend_requests"
    | "event_circles";
  column: string;
  from: string[];
  to: string;
  /** The expiry timestamp column, not every table calls it expires_at. */
  timeColumn?: string;
}): JobHandler {
  return async (admin) => {
    const nowIso = new Date().toISOString();
    const query = admin
      .from(config.table)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ [config.column]: config.to } as any)
      // A null time (e.g. a visibility session that lasts "until I turn it
      // off") is correctly excluded, .lt never matches null.
      .lt(config.timeColumn ?? "expires_at", nowIso)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .in(config.column as any, config.from as any)
      .select("id");

    const { data, error } = await query;
    if (error) throw new JobError("DATABASE_TIMEOUT", error.message);
    return data?.length ?? 0;
  };
}

/**
 * Reads already filter on `expires_at`, so these sweeps are about state
 * hygiene rather than correctness of what users see, an expired row is
 * invisible either way. They keep counts and queues honest.
 */
export const handleExpireVisibilitySessions: JobHandler = expirySweep({
  table: "visibility_sessions",
  column: "status",
  from: ["active"],
  to: "ended",
  // visibility_sessions has ends_at, not expires_at, with the default
  // column this job errored on every run since batch 14.
  timeColumn: "ends_at"
});

export const handleExpirePings: JobHandler = expirySweep({
  table: "meeting_pings",
  column: "status",
  from: ["pending", "seen", "maybe", "counter_proposed"],
  to: "expired"
});

export const handleExpireMoments: JobHandler = async (admin) => {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("moments")
    .update({ status: "expired", updated_at: nowIso })
    .lt("expires_at", nowIso)
    .eq("status", "active")
    .select("id, media_id");
  if (error) throw new JobError("DATABASE_TIMEOUT", error.message);

  // An expired Moment's media follows it (batch 6 §8, §45).
  const withMedia = (data ?? []).filter((moment) => moment.media_id);
  if (withMedia.length > 0) {
    await admin.from("media_deletion_queue").upsert(
      withMedia.map((moment) => ({ media_asset_id: moment.media_id as string, reason: "parent_expired" as const })),
      { onConflict: "media_asset_id", ignoreDuplicates: true }
    );
  }
  return data?.length ?? 0;
};

export const handleExpireDrops: JobHandler = expirySweep({
  table: "muddy_drops",
  column: "status",
  from: ["scheduled", "active"],
  to: "expired"
});

export const handleExpireInvites: JobHandler = expirySweep({
  table: "invite_links",
  column: "status",
  from: ["active"],
  to: "expired"
});

export const handleExpireFriendRequests: JobHandler = async (admin) => {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("friend_requests")
    .update({ status: "expired", updated_at: nowIso })
    .lt("expires_at", nowIso)
    .eq("status", "pending")
    .select("id");
  if (error) throw new JobError("DATABASE_TIMEOUT", error.message);
  return data?.length ?? 0;
};

/** Expired admin access must actually stop granting (batch 13 §6). */
export const handleExpireAdminAssignments: JobHandler = async (admin) => {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("admin_assignments")
    .update({ status: "revoked", updated_at: nowIso })
    .lt("expires_at", nowIso)
    .eq("status", "active")
    .select("id");
  if (error) throw new JobError("DATABASE_TIMEOUT", error.message);
  return data?.length ?? 0;
};

/**
 * Completes confirmed/inviting plans whose end time has passed. Nothing else
 * ever sets "completed", so without this recaps count zero plansCompleted and
 * the plan achievements can never be earned. Grants first_plan / plan_maker
 * to the host and everyone who was going (criteria from the definitions).
 */
export const handleCompletePastPlans: JobHandler = async (admin) => {
  const nowIso = new Date().toISOString();
  const { data: completed, error } = await admin
    .from("plans")
    .update({ status: "completed", updated_at: nowIso })
    .lt("end_at", nowIso)
    .in("status", ["inviting", "confirmed"])
    .select("id, creator_id");
  if (error) throw new JobError("DATABASE_TIMEOUT", error.message);
  if (!completed?.length) return 0;

  const { grantAchievement, grantCountAchievement } = await import("@/lib/engagement/achievements");
  const { data: goers } = await admin
    .from("plan_participants")
    .select("user_id")
    .in(
      "plan_id",
      completed.map((plan) => plan.id)
    )
    .eq("rsvp_status", "going");

  const userIds = [...new Set([...completed.map((plan) => plan.creator_id), ...(goers ?? []).map((row) => row.user_id)])];
  for (const userId of userIds) {
    await grantAchievement(admin, userId, "first_plan");
    const { count } = await admin
      .from("plan_participants")
      .select("id, plans!inner(status)", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("rsvp_status", "going")
      .eq("plans.status", "completed");
    await grantCountAchievement(admin, userId, "plan_maker", count ?? 0);
  }

  return completed.length;
};

export const handleExpireStatuses: JobHandler = async (admin) => {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin.from("user_statuses").delete().lt("expires_at", nowIso).select("id");
  if (error) throw new JobError("DATABASE_TIMEOUT", error.message);
  return data?.length ?? 0;
};

/** Event circles archive after their retention window (batch 5 §51). */
export const handleExpireEventCircles: JobHandler = async (admin) => {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("event_circles")
    .update({ status: "archived", updated_at: nowIso })
    .lt("archives_at", nowIso)
    .in("status", ["open", "active", "closing"])
    .select("id");
  if (error) throw new JobError("DATABASE_TIMEOUT", error.message);
  return data?.length ?? 0;
};

// ---------------------------------------------------------------------------
// Streak closing (batch 11)
// ---------------------------------------------------------------------------

/** Ends streaks that missed their week plus the grace week. Non-punitive. */
export const handleCloseExpiredStreaks: JobHandler = async (admin) => {
  const { weekKey } = await import("@/lib/engagement/rules");
  const nowMs = Date.now();
  const currentKey = weekKey(nowMs);
  const graceKey = weekKey(nowMs - 7 * 24 * 60 * 60 * 1000);
  const previousKey = weekKey(nowMs - 14 * 24 * 60 * 60 * 1000);

  const { data, error } = await admin
    .from("friendship_streaks")
    .update({ status: "ended", current_weeks: 0, updated_at: new Date(nowMs).toISOString() })
    .eq("status", "active")
    .not("last_qualified_period", "in", `(${[currentKey, graceKey, previousKey].map((k) => `"${k}"`).join(",")})`)
    .select("id");
  if (error) throw new JobError("DATABASE_TIMEOUT", error.message);
  return data?.length ?? 0;
};

// ---------------------------------------------------------------------------
// Monthly recap generation (batch 11 §10)
// ---------------------------------------------------------------------------

/**
 * Generates last month's recap for every user who was active in that month,
 * has recaps enabled, and whose plan includes friendship_recaps. Aggregated
 * counts only, every summary passes through sanitizeRecapSummary, so nothing
 * outside RECAP_ALLOWED_FIELDS can be stored (spec §4).
 *
 * Runs daily but is naturally idempotent: the (user, period_type,
 * period_start) unique constraint plus ignoreDuplicates means each month is
 * generated once, shortly after it ends.
 */
export const handleGenerateMonthlyRecaps: JobHandler = async (admin) => {
  const { sanitizeRecapSummary } = await import("@/lib/engagement/rules");
  const { resolveUserEntitlements } = await import("@/lib/billing/service");

  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startIso = periodStart.toISOString();
  const endIso = periodEnd.toISOString();

  // Pull the month's activity once and aggregate in memory. Bounded reads,
  // at current scale these are small; revisit with keyset pagination later.
  const [wavesRes, plansRes, participantsRes, friendshipsRes, hangoutsRes, sessionsRes] = await Promise.all([
    admin
      .from("waves")
      .select("sender_id, recipient_id, reply_to_wave_id")
      .gte("sent_at", startIso)
      .lt("sent_at", endIso)
      .limit(10000),
    admin
      .from("plans")
      .select("id, creator_id, status, plan_type")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .limit(10000),
    admin
      .from("plan_participants")
      .select("plan_id, user_id")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .limit(10000),
    admin
      .from("friendships")
      .select("user_one_id, user_two_id")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .limit(10000),
    admin
      .from("hangout_sessions")
      .select("owner_id, activity_type")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .limit(10000),
    admin
      .from("visibility_sessions")
      .select("user_id, visibility_mode, starts_at")
      .gte("starts_at", startIso)
      .lt("starts_at", endIso)
      .limit(10000)
  ]);
  for (const res of [wavesRes, plansRes, participantsRes, friendshipsRes, hangoutsRes, sessionsRes]) {
    if (res.error) throw new JobError("DATABASE_TIMEOUT", res.error.message);
  }

  const raw = new Map<string, Record<string, unknown> & { _interacted: Set<string>; _days: Set<string>; _activities: string[] }>();
  const forUser = (userId: string) => {
    let entry = raw.get(userId);
    if (!entry) {
      entry = { _interacted: new Set(), _days: new Set(), _activities: [] };
      raw.set(userId, entry);
    }
    return entry;
  };
  const bump = (userId: string, field: string, by = 1) => {
    const entry = forUser(userId);
    entry[field] = ((entry[field] as number) ?? 0) + by;
  };

  for (const wave of wavesRes.data ?? []) {
    bump(wave.sender_id, "wavesSent");
    forUser(wave.sender_id)._interacted.add(wave.recipient_id);
    forUser(wave.recipient_id)._interacted.add(wave.sender_id);
    if (wave.reply_to_wave_id) bump(wave.recipient_id, "wavesReturned");
  }

  const planCreators = new Map((plansRes.data ?? []).map((plan) => [plan.id, plan]));
  for (const plan of plansRes.data ?? []) {
    bump(plan.creator_id, "plansCreated");
    if (plan.status === "completed") bump(plan.creator_id, "plansCompleted");
  }
  for (const participant of participantsRes.data ?? []) {
    const plan = planCreators.get(participant.plan_id);
    if (!plan || participant.user_id === plan.creator_id) continue;
    forUser(participant.user_id)._interacted.add(plan.creator_id);
    forUser(plan.creator_id)._interacted.add(participant.user_id);
    if (plan.status === "completed") bump(participant.user_id, "plansCompleted");
  }

  for (const friendship of friendshipsRes.data ?? []) {
    bump(friendship.user_one_id, "newMuddies");
    bump(friendship.user_two_id, "newMuddies");
  }

  for (const hangout of hangoutsRes.data ?? []) {
    bump(hangout.owner_id, "hangoutSessions");
    forUser(hangout.owner_id)._activities.push(hangout.activity_type);
  }

  for (const session of sessionsRes.data ?? []) {
    const entry = forUser(session.user_id);
    if (session.visibility_mode === "hidden") bump(session.user_id, "ghostModeUsed");
    else entry._days.add(session.starts_at.slice(0, 10));
  }

  if (raw.size === 0) return 0;

  const userIds = [...raw.keys()];
  const [existingRes, prefsRes, engagementRes] = await Promise.all([
    admin
      .from("friendship_recaps")
      .select("user_id")
      .eq("period_type", "monthly")
      .eq("period_start", startIso)
      .in("user_id", userIds),
    admin.from("recap_preferences").select("user_id, monthly_enabled").in("user_id", userIds),
    admin.from("engagement_preferences").select("user_id, recaps_enabled").in("user_id", userIds)
  ]);

  const alreadyGenerated = new Set((existingRes.data ?? []).map((row) => row.user_id));
  const monthlyDisabled = new Set(
    (prefsRes.data ?? []).filter((row) => !row.monthly_enabled).map((row) => row.user_id)
  );
  for (const row of engagementRes.data ?? []) {
    if (!row.recaps_enabled) monthlyDisabled.add(row.user_id);
  }

  let generated = 0;
  for (const [userId, entry] of raw) {
    if (alreadyGenerated.has(userId) || monthlyDisabled.has(userId)) continue;

    const entitlements = await resolveUserEntitlements(admin, userId);
    if (!entitlements.friendship_recaps) continue;

    const activityCounts = new Map<string, number>();
    for (const activity of entry._activities) {
      activityCounts.set(activity, (activityCounts.get(activity) ?? 0) + 1);
    }
    const mostCommonActivity =
      [...activityCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const summary = sanitizeRecapSummary({
      ...entry,
      muddiesInteractedWith: entry._interacted.size,
      daysVisible: entry._days.size,
      mostCommonActivity
    });

    const { error } = await admin.from("friendship_recaps").upsert(
      {
        user_id: userId,
        period_type: "monthly",
        period_start: startIso,
        period_end: endIso,
        summary_data: summary as never,
        status: "ready"
      },
      { onConflict: "user_id,period_type,period_start", ignoreDuplicates: true }
    );
    if (error) throw new JobError("DATABASE_TIMEOUT", error.message);
    generated += 1;
  }

  return generated;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const JOB_HANDLERS: Partial<Record<JobType, JobHandler>> = {
  "safe_arrival.unconfirmed_alert": handleSafeArrivalUnconfirmedAlert,
  "media.delete_queued": handleMediaDeleteQueued,
  "billing.apply_scheduled_downgrade": handleApplyScheduledDowngrade,
  "streaks.close_expired_periods": handleCloseExpiredStreaks,
  "recap.generate_monthly": handleGenerateMonthlyRecaps,
  "expiry.plans": handleCompletePastPlans,
  "expiry.statuses": handleExpireStatuses,
  "expiry.visibility_sessions": handleExpireVisibilitySessions,
  "expiry.pings": handleExpirePings,
  "expiry.moments": handleExpireMoments,
  "expiry.drops": handleExpireDrops,
  "expiry.invites": handleExpireInvites,
  "expiry.friend_requests": handleExpireFriendRequests,
  "expiry.event_circles": handleExpireEventCircles,
  "expiry.admin_assignments": handleExpireAdminAssignments
};
