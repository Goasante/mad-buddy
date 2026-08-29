import "server-only";

import { deliverNotification } from "@/lib/notifications/server";
import { batchBlockedIds } from "@/lib/social/permissions";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";
import {
  gracePeriodEndMs,
  safeArrivalNotification,
  shouldSendUnconfirmedAlert
} from "@/lib/safety/safe-arrival";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { JobType } from "@/lib/jobs/rules";
import {
  INCOMPLETE_CHAT_ORPHAN_AGE_MS,
  READY_CHAT_ORPHAN_AGE_MS
} from "@/lib/media/constants";
import { deliverBirthdayNotifications } from "@/lib/profile/birthday-service";
import { isPlanChatClosed, PLAN_DEFAULT_ACTIVE_MS } from "@/lib/social/plans";

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

/** How many Plan Chats one closure tick may close. Bounds the transaction;
 *  a backlog drains over successive hourly ticks rather than one long run. */
const PLAN_CHAT_CLOSE_BATCH = 200;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Delivers the durable, after-commit work queued by the canonical Plans RPCs.
 * The database transaction is the authority for recipients; the payload is
 * narrowed and then checked against the current Plan/participant rows before
 * a notification is attempted.
 */
export const handlePlanLifecycleSideEffect: JobHandler = async (admin, payload) => {
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  const actorId = typeof payload.actorId === "string" ? payload.actorId : "";
  const planId = typeof payload.planId === "string" ? payload.planId : "";
  const recipientId = typeof payload.recipientId === "string" ? payload.recipientId : "";

  if (!UUID_PATTERN.test(actorId) || !UUID_PATTERN.test(planId)) {
    throw new JobError("VALIDATION_FAILED", "Invalid Plan lifecycle job identifiers.");
  }

  const { data: plan } = await admin
    .from("plans")
    .select("creator_id, title")
    .eq("id", planId)
    .maybeSingle();
  if (!plan || plan.creator_id !== actorId) {
    throw new JobError("CONTEXT_INVALID", "Plan lifecycle context is no longer valid.");
  }

  if (kind === "first_plan_milestone") {
    const { recordMilestone } = await import("@/lib/onboarding/service");
    await recordMilestone(admin, actorId, "first_plan_created");
    return 1;
  }

  if (
    !(["plan_invitation", "upfor_converted"] as const).includes(
      kind as "plan_invitation" | "upfor_converted"
    ) ||
    !UUID_PATTERN.test(recipientId)
  ) {
    throw new JobError("VALIDATION_FAILED", "Invalid Plan lifecycle job kind.");
  }

  const [{ data: participant }, { data: actor }] = await Promise.all([
    admin
      .from("plan_participants")
      .select("rsvp_status")
      .eq("plan_id", planId)
      .eq("user_id", recipientId)
      .maybeSingle(),
    admin.from("profiles").select("full_name").eq("user_id", actorId).maybeSingle()
  ]);

  if (!participant || participant.rsvp_status === "removed") {
    throw new JobError("CONTEXT_INVALID", "Plan lifecycle context is no longer valid.");
  }

  /* CLAIM BEFORE DELIVERING, so a retry cannot notify twice.
   *
   * THE WINDOW THIS CLOSES. The job row is uniquely keyed, so the same logical
   * invitation can only ever be enqueued once -- but that is job idempotency,
   * not effect idempotency. A worker that delivered the notification and then
   * died before recording completion left the job retryable, and
   * deliverNotification inserts, so the invitee would be told twice about one
   * invitation.
   *
   * The latch is the job row itself: it carries the deterministic key
   * `plan-invite:<planId>:<recipientId>`, it is never deleted, and it already
   * exists exactly once per logical invitation. Stamping `delivered` into its
   * payload before calling deliverNotification is the same technique Safe
   * Arrival uses for its unconfirmed alert -- set the latch first, filter on it
   * after -- and needs no schema change.
   *
   * ORDERING IS THE POINT. Claiming first means the worst case is a
   * notification that is never sent (crash between claim and delivery), rather
   * than one sent twice. For an invitation that is the right way round: a
   * missing invite is visible in the Plan itself, while a duplicate is a
   * notification the person cannot explain or undo.
   *
   * A FAILED CLAIM IS NOT AN ERROR. It means another attempt already delivered
   * this invitation, so the correct outcome is to report success and let the
   * job complete -- retrying forever against a delivered invitation would
   * dead-letter work that actually succeeded. */
  const inviteJobKey = `plan-invite:${planId}:${recipientId}`;
  const { data: claimed } = await admin
    .from("jobs")
    .update({ payload: { kind, planId, actorId, recipientId, delivered: true } })
    .eq("idempotency_key", inviteJobKey)
    .is("payload->>delivered", null)
    .select("id");

  // No row claimed: either already delivered by an earlier attempt, or the
  // job row is gone. Either way this invitation must not be sent again.
  if (!claimed || claimed.length === 0) return 0;

  const name = actor?.full_name?.trim() || "A Muddy";
  await deliverNotification(admin, {
    userId: recipientId,
    senderId: actorId,
    category: "plans",
    type: `plan:${planId}`,
    title: kind === "upfor_converted" ? "Your hangout became a plan" : "New plan invite",
    message:
      kind === "upfor_converted"
        ? `${name} created "${plan.title}".`
        : `${name} invited you to "${plan.title}".`
  });
  return 1;
};

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

    // Neutral by construction, never "missing", never an emergency (batch 5 §9).
    // Same copy helper the traveller-initiated events use, so every lifecycle
    // notification for a journey reads consistently.
    const overdue = safeArrivalNotification("overdue", {
      travellerName: name,
      timeLabel: new Date(timing.expectedArrivalMs).toLocaleTimeString("en-GB", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: DEFAULT_RECIPIENT_TIMEZONE
      })
    });
    await Promise.all(
      (contacts ?? []).map((contact) =>
        deliverNotification(admin, {
          userId: contact.contact_user_id,
          priority: "critical",
          // Deep-links to this exact journey, not the feature root.
          type: `safe_arrival:${session.id}`,
          title: overdue.title,
          message: overdue.message
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
export const handleCleanupOrphanChatMedia: JobHandler = async (admin) => {
  const now = Date.now();
  const { data, error } = await admin.rpc("queue_stale_unattached_chat_media", {
    p_ready_before: new Date(now - READY_CHAT_ORPHAN_AGE_MS).toISOString(),
    p_incomplete_before: new Date(now - INCOMPLETE_CHAT_ORPHAN_AGE_MS).toISOString(),
    p_limit: 100
  });
  if (error) throw new JobError("DATABASE_TIMEOUT", error.message);
  return data ?? 0;
};

export const handleMediaDeleteQueued: JobHandler = async (admin) => {
  const { data: queued, error } = await admin
    .from("media_deletion_queue")
    .select("id, media_asset_id, reason")
    .is("processed_at", null)
    .limit(100);
  if (error) throw new JobError("DATABASE_TIMEOUT", error.message);

  let deleted = 0;
  for (const row of queued ?? []) {
    if (row.reason === "orphaned_upload") {
      const { data: attached } = await admin
        .from("messages")
        .select("id")
        .eq("media_id", row.media_asset_id)
        .limit(1)
        .maybeSingle();
      if (attached) {
        // Defensive second check. The database trigger already makes a queued
        // asset unattachable, but this protects data during rolling deploys.
        await admin.from("media_deletion_queue").delete().eq("id", row.id);
        continue;
      }
    }

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
// Financial intelligence
// ---------------------------------------------------------------------------

export const handleCaptureDailyFinancialSnapshot: JobHandler = async (admin) => {
  const { captureDailyFinancialSnapshots } = await import("@/lib/revenue/snapshots");
  const rows = await captureDailyFinancialSnapshots(admin);
  return rows.length;
};

export const handleReconcilePaystackFees: JobHandler = async (admin) => {
  const { reconcileMissingPaystackFees } = await import("@/lib/revenue/paystack-fees");
  return reconcileMissingPaystackFees(admin, 50);
};

export const handlePremiumTrialLifecycle: JobHandler = async (admin) => {
  const { processTrialLifecycle } = await import("@/lib/trials/service");
  return processTrialLifecycle(admin);
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
  // A start-only plan is finished once the fallback window has elapsed, so the
  // cutoff for those is that far in the past. Read from the shared constant --
  // the number is never re-typed here.
  const startOnlyCutoffIso = new Date(Date.now() - PLAN_DEFAULT_ACTIVE_MS).toISOString();
  // MATCHES THE READ-TIME RULE IN lib/social/plans.ts (planPhase): a plan is
  // over once its end time passes, or once PLAN_DEFAULT_ACTIVE_MS has elapsed
  // since its start when it has no end. The filter used to be
  // `.lt("end_at", nowIso)` alone, and almost no plan carries an end time --
  // every dated plan in production has a null one -- so this job completed
  // nothing and those plans sat at `inviting` indefinitely while the UI had
  // already moved them to Past. Two rules for one question is what let the
  // database and the screen disagree.
  //
  // THE FALLBACK MUST BE APPLIED HERE TOO. planPhase now keeps a start-only
  // plan `active` for PLAN_DEFAULT_ACTIVE_MS so that "is it happening right
  // now" has an answer. Completing it at `start_at` would set a terminal
  // status, and terminal status wins in planPhase -- so the job would age a
  // plan to Past while people were still at it, re-creating the exact
  // disagreement this comment exists to prevent.
  //
  // Undated plans are deliberately NOT touched here. They are set aside by
  // the grace window at read time, which needs no write and can be undone by
  // simply adding a date.
  const { data: completed, error } = await admin
    .from("plans")
    .update({ status: "completed", updated_at: nowIso })
    .or(`end_at.lt.${nowIso},and(end_at.is.null,start_at.lt.${startOnlyCutoffIso})`)
    .in("status", ["inviting", "confirmed"])
    .select("id, creator_id");
  if (error) throw new JobError("DATABASE_TIMEOUT", error.message);
  if (!completed?.length) return 0;

  const { grantAchievement, grantCountAchievement } = await import("@/lib/engagement/achievements");
  const { data: goers } = await admin
    .from("plan_participants")
    .select("plan_id, user_id")
    .in(
      "plan_id",
      completed.map((plan) => plan.id)
    )
    .eq("rsvp_status", "going");

  // Life: attending a plan together is a relationship fact. Emitted here
  // because this job is the only thing that ever completes a plan, and
  // compensating — a failed event never un-completes the plan above.
  const { planAttendancePairs } = await import("@/lib/life/plan-attendance");
  const { emitLifeEvents } = await import("@/lib/life/emit");
  await emitLifeEvents(
    admin,
    planAttendancePairs(
      (goers ?? []).map((row) => ({ planId: row.plan_id, userId: row.user_id })),
      nowIso
    )
  );

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
    await grantCountAchievement(admin, userId, "plan_regular", count ?? 0);
  }

  return completed.length;
};

/**
 * Closes Plan Chats whose Plan ended long enough ago.
 *
 * CLOSE, NEVER DELETE. This job flips two switches and writes nothing else:
 *
 *   1. conversations.status -> 'archived', which is what actually stops new
 *      messages. Every send path in the product (text, quick actions, media,
 *      forwards, structured shares, polls, voice) resolves through
 *      canSendMessage -> resolveCanSendMessage, and that refuses any
 *      conversation whose status is not 'active'. Closing here therefore
 *      closes all of them at once, and cannot be bypassed by calling a server
 *      action directly -- there is no send path that does not pass it.
 *   2. conversation_user_preferences.archived_at for each member, which is the
 *      authority the inbox already uses to move a conversation out of the
 *      active list and into the existing "Archived" filter, where it stays
 *      readable and findable.
 *
 * No message is touched. No conversation is deleted. Membership is untouched,
 * so exactly the people who could read the chat before can still read it.
 *
 * ONE RULE, SHARED. Whether a chat is due is decided by isPlanChatClosed in
 * lib/social/plans.ts -- the same function the read path uses to explain the
 * state. The job does not re-derive timing in SQL, which is how
 * handleCompletePastPlans came to disagree with the Plans page for weeks.
 *
 * IDEMPOTENT BY CONSTRUCTION. The conversation query filters on
 * status = 'active', so a second run sees nothing it already closed. The
 * per-member preference write is an upsert keyed on (conversation_id, user_id)
 * that only fills a null archived_at, so it never overwrites the timestamp
 * from the first run and never re-archives a chat a member deliberately
 * un-archived after closure.
 *
 * BOUNDED. It starts from the partial index on active Plan Chats rather than
 * scanning conversations, resolves their Plans in one batched read, and caps
 * the batch -- a backlog drains over several ticks instead of one long
 * transaction.
 */
export const handleClosePlanChats: JobHandler = async (admin) => {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Active Plan Chats only: anything already archived is done, and a
  // restricted or deleted conversation is not this job's business.
  const { data: chats, error: chatsError } = await admin
    .from("conversations")
    .select("id, context_id")
    .eq("context_type", "plan")
    .eq("status", "active")
    .limit(PLAN_CHAT_CLOSE_BATCH);
  if (chatsError) throw new JobError("DATABASE_TIMEOUT", chatsError.message);
  if (!chats?.length) return 0;

  const planIds = [...new Set(chats.map((chat) => chat.context_id).filter((id): id is string => Boolean(id)))];
  if (planIds.length === 0) return 0;

  const { data: plans, error: plansError } = await admin
    .from("plans")
    .select("id, status, start_at, end_at, created_at, cancelled_at, completed_at, chat_close_days")
    .in("id", planIds);
  if (plansError) throw new JobError("DATABASE_TIMEOUT", plansError.message);

  const planById = new Map((plans ?? []).map((plan) => [plan.id, plan]));

  const dueConversationIds = chats
    .filter((chat) => {
      const plan = chat.context_id ? planById.get(chat.context_id) : undefined;
      /* NO PLAN, NO CLOSURE. A Plan Chat whose Plan row is missing is left
         open on purpose. Closing on the strength of an absent record would
         mean a failed read, a replication lag or a hard-deleted fixture could
         silently shut a live conversation -- and this job runs unattended
         every hour. Leaving it open is visible and reversible; closing it is
         neither. */
      if (!plan) return false;
      return isPlanChatClosed(
        {
          status: plan.status,
          startAt: plan.start_at,
          endAt: plan.end_at,
          createdAt: plan.created_at,
          closeDays: plan.chat_close_days,
          terminalAt: plan.cancelled_at ?? plan.completed_at
        },
        nowMs
      );
    })
    .map((chat) => chat.id);

  if (dueConversationIds.length === 0) return 0;

  // THE CLOSURE ITSELF. Re-filtered on status = 'active' so two overlapping
  // workers cannot both count the same chat as work done.
  const { data: closed, error: closeError } = await admin
    .from("conversations")
    .update({ status: "archived", updated_at: nowIso })
    .in("id", dueConversationIds)
    .eq("status", "active")
    .select("id");
  if (closeError) throw new JobError("DATABASE_TIMEOUT", closeError.message);
  if (!closed?.length) return 0;

  const closedIds = closed.map((row) => row.id);

  // Move it out of every member's active inbox. Joined members only: someone
  // who left or was removed has no inbox row to tidy.
  const { data: members } = await admin
    .from("conversation_members")
    .select("conversation_id, user_id")
    .in("conversation_id", closedIds)
    .eq("status", "joined");

  for (const member of members ?? []) {
    /* Only fills an empty archived_at. A member who had already archived this
       chat keeps their own timestamp, and -- more importantly -- a member who
       un-archives a closed chat later is not re-archived by the next tick,
       because the conversation is no longer 'active' and never reaches this
       code again. */
    await admin
      .from("conversation_user_preferences")
      .upsert(
        {
          conversation_id: member.conversation_id,
          user_id: member.user_id,
          archived_at: nowIso,
          updated_at: nowIso
        },
        { onConflict: "conversation_id,user_id", ignoreDuplicates: true }
      );
    await admin
      .from("conversation_user_preferences")
      .update({ archived_at: nowIso, updated_at: nowIso })
      .eq("conversation_id", member.conversation_id)
      .eq("user_id", member.user_id)
      .is("archived_at", null);
  }

  return closed.length;
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
      // LIFE-HISTORICAL: counts friendships FORMED in this window, so an
      // ended_at filter would be wrong — a friendship that formed and then
      // ended still happened during the period being recapped.
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

/**
 * Event Update fanout.
 *
 * A publish writes one row and queues one job; this delivers it. Doing that
 * work inside the request would mean a host with thirty thousand Going
 * attendees waits for thirty thousand notification writes, and a single
 * failure anywhere would look to them like their Update never posted.
 *
 * RE-CHECKED AT DELIVERY, NOT AT ENQUEUE. Someone who tapped Going yesterday
 * may have tapped Not Going an hour ago; the Event itself may have been
 * cancelled. Membership resolved when the job was created would be a snapshot
 * of a moment that has passed, so recipients are resolved here.
 *
 * IDEMPOTENT BY LATCH. deliverNotification inserts, so a retry after a partial
 * batch would notify some people twice. The job payload carries a cursor of
 * how far delivery got; a retry resumes rather than restarts. This is the same
 * claim-before-acting shape the Plan invitation handler uses, for the same
 * reason -- a duplicate notification is something the recipient cannot undo.
 */
export const handleEventUpdateFanout: JobHandler = async (admin, payload) => {
  const eventId = typeof payload.eventId === "string" ? payload.eventId : "";
  const updateId = typeof payload.updateId === "string" ? payload.updateId : "";
  if (!UUID_PATTERN.test(eventId) || !UUID_PATTERN.test(updateId)) {
    throw new JobError("VALIDATION_FAILED", "Invalid Event Update fanout identifiers.");
  }

  const [{ data: update }, { data: event }] = await Promise.all([
    admin.from("event_updates").select("id, body, author_id, priority").eq("id", updateId).maybeSingle(),
    admin.from("events").select("id, name, host_id, status").eq("id", eventId).maybeSingle()
  ]);
  // A deleted Update or Event is not a failure to retry forever -- there is
  // simply nothing left to deliver.
  if (!update || !event) return 0;
  if (event.status === "cancelled") return 0;

  /* GOING ONLY.
   *
   * Interested is a weaker signal: those people can read Updates on the Event
   * whenever they look, but pushing every normal Update to everyone who ever
   * tapped Interested is how a useful channel becomes one people mute. */
  const { data: rsvps } = await admin
    .from("event_rsvps")
    .select("user_id")
    .eq("event_id", eventId)
    .eq("status", "going");
  if (!rsvps?.length) return 0;

  // The author never notifies themselves about their own announcement.
  const recipients = rsvps.map((r) => r.user_id).filter((id) => id !== update.author_id);
  if (recipients.length === 0) return 0;

  // Resume point, so a retry after a partial batch does not re-notify anyone.
  const deliveredSoFar = typeof payload.deliveredCount === "number" ? payload.deliveredCount : 0;
  const remaining = recipients.slice(deliveredSoFar);
  if (remaining.length === 0) return 0;

  // Bounded per tick. A large Event is delivered across several claims rather
  // than one unbounded burst that could exceed the worker time limit.
  const BATCH = 200;
  const batch = remaining.slice(0, BATCH);

  const blocked = await batchBlockedIds(admin, event.host_id, batch);
  const title = update.priority === "high" ? `Update: ${event.name}` : event.name;
  let delivered = 0;
  for (const userId of batch) {
    if (blocked.has(userId)) continue;
    await deliverNotification(admin, {
      userId,
      senderId: update.author_id,
      category: "plans",
      type: `event:${eventId}`,
      title,
      message: update.body.slice(0, 140)
    });
    delivered += 1;
  }

  const nextCursor = deliveredSoFar + batch.length;
  if (nextCursor < recipients.length) {
    // More to do: advance the cursor and let the job run again rather than
    // holding one claim open across the whole audience.
    await admin
      .from("jobs")
      .update({ payload: { eventId, updateId, deliveredCount: nextCursor } })
      .eq("idempotency_key", `event-update-fanout:${updateId}`);
    // RATE_LIMITED is the transient code: the worker backs off and claims this
    // job again, resuming from the cursor. A permanent code would dead-letter a
    // fanout that is simply not finished yet.
    throw new JobError("RATE_LIMITED", "Event Update fanout continues.");
  }

  return delivered;
};

export const JOB_HANDLERS: Partial<Record<JobType, JobHandler>> = {
  "plans.lifecycle_side_effect": handlePlanLifecycleSideEffect,
  "events.update_fanout": handleEventUpdateFanout,
  "safe_arrival.unconfirmed_alert": handleSafeArrivalUnconfirmedAlert,
  "media.cleanup_orphan_chat": handleCleanupOrphanChatMedia,
  "media.delete_queued": handleMediaDeleteQueued,
  "billing.apply_scheduled_downgrade": handleApplyScheduledDowngrade,
  "financial.capture_daily_snapshot": handleCaptureDailyFinancialSnapshot,
  "financial.reconcile_paystack_fees": handleReconcilePaystackFees,
  "trials.lifecycle": handlePremiumTrialLifecycle,
  "access.welcome_reminders": async (admin) => {
    const { processWelcomeAccessReminders } = await import("@/lib/access/reminders");
    const run = await processWelcomeAccessReminders(admin);
    /* The contract is a count of things processed. `sent` is the honest number:
       grants skipped because the person already holds other access were
       correctly NOT notified, and counting them would inflate the figure. */
    return run.sent;
  },
  "streaks.close_expired_periods": handleCloseExpiredStreaks,
  "recap.generate_monthly": handleGenerateMonthlyRecaps,
  "birthdays.notify": async (admin) => deliverBirthdayNotifications(admin),
  "rewards.earned_premium": async (admin) => {
    const { processEarnedRewards } = await import("@/lib/rewards/earned-premium-service");
    return processEarnedRewards(admin);
  },
  "expiry.plans": handleCompletePastPlans,
  "plans.close_chats": handleClosePlanChats,
  "expiry.statuses": handleExpireStatuses,
  "expiry.visibility_sessions": handleExpireVisibilitySessions,
  "expiry.pings": handleExpirePings,
  "expiry.moments": handleExpireMoments,
  "expiry.drops": handleExpireDrops,
  "expiry.invites": handleExpireInvites,
  "expiry.friend_requests": handleExpireFriendRequests,
  "expiry.event_circles": handleExpireEventCircles,
  "expiry.admin_assignments": handleExpireAdminAssignments,
  "reminders.scan": async (admin) => {
    const { scanAndEnqueueReminders } = await import("@/lib/reminders/service");
    return scanAndEnqueueReminders(admin);
  },
  "reminders.deliver": async (admin, payload) => {
    const { deliverReminder } = await import("@/lib/reminders/service");
    const parsed = parseReminderPayload(payload);
    // A malformed payload is permanently unprocessable, never a transient
    // fault: retrying cannot repair it, so it is a completed no-op rather
    // than a job that burns five attempts before dead-lettering.
    if (!parsed) return 0;
    const outcome = await deliverReminder(admin, parsed);
    // Only a real send counts as work done. Every skip is a legitimate,
    // terminal outcome -- cancelled, moved, declined, too late -- and must
    // not look like a failure to the worker.
    return outcome === "delivered" ? 1 : 0;
  }
};

/**
 * Narrows an untyped job payload, returning null when it cannot be trusted.
 *
 * Every field is checked against the literal unions rather than cast: a job
 * row is data, and a payload written by an older deploy (or corrupted) must
 * not be able to reach the delivery path as though it were valid.
 */
function parseReminderPayload(
  payload: Record<string, unknown>
): import("@/lib/reminders/service").ReminderJobPayload | null {
  const { domain, itemId, userId, stage, expectedStartAtMs } = payload as {
    domain?: unknown;
    itemId?: unknown;
    userId?: unknown;
    stage?: unknown;
    expectedStartAtMs?: unknown;
  };

  if (domain !== "plan" && domain !== "event") return null;
  if (typeof itemId !== "string" || typeof userId !== "string") return null;
  if (stage !== "24h" && stage !== "2h" && stage !== "near_start") return null;
  if (typeof expectedStartAtMs !== "number" || !Number.isFinite(expectedStartAtMs)) return null;

  return { domain, itemId, userId, stage, expectedStartAtMs };
}
