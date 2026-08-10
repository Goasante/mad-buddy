import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Account deletion, as one resumable workflow.
 *
 * WHY THIS IS NOT A SINGLE TRANSACTION: deletion spans three systems that
 * cannot share one -- Postgres tables, the storage bucket, and the Auth user
 * registry. Something has to run second, so the question is not "can this be
 * atomic" (it cannot) but "what does a half-finished deletion look like".
 *
 * The order below is chosen so that every intermediate state is SAFE and
 * RESUMABLE rather than merely unlikely:
 *
 *   1. Mark intent.      A durable record that this user asked to be deleted,
 *                        written BEFORE anything is destroyed. If every later
 *                        step fails, this row is what lets the deletion be
 *                        retried or swept -- without it, a failure after the
 *                        first destructive step leaves no evidence that the
 *                        user ever asked.
 *   2. Anonymise reports. Moderation history must outlive the account, so this
 *                        runs before the data it references disappears.
 *   3. Purge data.       The destructive bulk. Idempotent by construction:
 *                        deleting rows that are already gone is a no-op.
 *   4. Write the audit.  After the data is gone, before the login is removed.
 *   5. Remove the login. LAST, deliberately. While it exists the user can sign
 *                        in and retry; once it is gone the account cannot be
 *                        used to resume anything, so nothing may depend on it
 *                        afterwards.
 *
 * The previous implementation ran step 5 as an unguarded final call: if it
 * failed, all sixteen tables were already purged but the login survived, so
 * the user was told deletion had failed while their data was in fact gone.
 * That is the specific state this module exists to prevent.
 */

export type DeletionStage =
  | "requested"
  | "reports_anonymised"
  | "data_purged"
  | "audited"
  | "auth_removed";

export type DeletionOutcome =
  | { ok: true; stage: "auth_removed" }
  | { ok: false; stage: DeletionStage; message: string; resumable: boolean };

/** The tables purged, in one place so the list is auditable at a glance. */
export const DELETION_TABLES = [
  "proximity_events",
  "notifications",
  "meetup_requests",
  "best_buddies",
  "event_modes",
  "circle_members",
  "friend_circles",
  "privacy_zones",
  "user_preferences",
  "user_locations",
  "user_phone_identities",
  "blocked_users",
  "friend_requests",
  "friendships",
  "subscriptions",
  "consent_logs",
  "profiles"
] as const;

/**
 * Records the intent to delete, before anything is destroyed.
 *
 * Idempotent on user_id: a repeated request re-asserts the same intent rather
 * than creating a second workflow, so a user tapping twice -- or a native
 * client retrying after a dropped connection -- cannot start two deletions.
 */
export async function markDeletionRequested(
  admin: SupabaseClient,
  userId: string,
  reason: string | null
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await admin.from("account_deletion_requests").upsert(
    {
      user_id: userId,
      reason,
      stage: "requested" satisfies DeletionStage,
      requested_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return { ok: false, message: "Your deletion request could not be recorded." };
  }

  return { ok: true };
}

/** Advances the recorded stage, so a resumed run knows what is already done. */
export async function recordDeletionStage(
  admin: SupabaseClient,
  userId: string,
  stage: DeletionStage
): Promise<void> {
  // Best-effort: failing to advance the marker must never abort a deletion
  // that is otherwise succeeding. The cost of a stale marker is one repeated
  // idempotent step on resume, which is harmless.
  await admin
    .from("account_deletion_requests")
    .update({ stage, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
}

/**
 * Purges every table holding this user's data.
 *
 * Idempotent: re-running deletes nothing the first pass already removed, so a
 * resumed deletion can safely repeat this whole step rather than needing to
 * know precisely where it stopped.
 */
export async function purgeUserData(
  admin: SupabaseClient,
  userId: string
): Promise<{ ok: boolean; failedTable?: string }> {
  const scoped: Array<[string, PromiseLike<{ error: unknown }>]> = [
    ["proximity_events", admin.from("proximity_events").delete().or(`user_id.eq.${userId},friend_id.eq.${userId}`)],
    ["notifications", admin.from("notifications").delete().eq("user_id", userId)],
    ["meetup_requests", admin.from("meetup_requests").delete().or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)],
    ["best_buddies", admin.from("best_buddies").delete().or(`user_id.eq.${userId},friend_id.eq.${userId}`)],
    ["event_modes", admin.from("event_modes").delete().eq("user_id", userId)],
    ["circle_members", admin.from("circle_members").delete().eq("friend_id", userId)],
    ["friend_circles", admin.from("friend_circles").delete().eq("user_id", userId)],
    ["privacy_zones", admin.from("privacy_zones").delete().eq("user_id", userId)],
    ["user_preferences", admin.from("user_preferences").delete().eq("user_id", userId)],
    ["user_locations", admin.from("user_locations").delete().eq("user_id", userId)],
    // Contact discovery must not outlive the account. While this row exists
    // the number keeps producing matches, so a deleted person would still be
    // findable by anyone who has them saved.
    ["user_phone_identities", admin.from("user_phone_identities").delete().eq("user_id", userId)],
    ["blocked_users", admin.from("blocked_users").delete().or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)],
    ["friend_requests", admin.from("friend_requests").delete().or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)],
    // HARD delete, deliberately. Removing a Muddy soft-ends the row so the
    // relationship can resume; deleting an ACCOUNT must actually erase it. A
    // soft ending would retain one user's id inside another user's rows after
    // that user asked to be forgotten.
    // LIFE-HARD-DELETE: account erasure must remove relationship identity.
    ["friendships", admin.from("friendships").delete().or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)],
    ["subscriptions", admin.from("subscriptions").delete().eq("user_id", userId)],
    ["consent_logs", admin.from("consent_logs").delete().eq("user_id", userId)],
    ["profiles", admin.from("profiles").delete().eq("user_id", userId)]
  ];

  const results = await Promise.all(scoped.map(async ([table, query]) => ({ table, error: (await query).error })));
  const failed = results.find((result) => result.error);

  return failed ? { ok: false, failedTable: failed.table } : { ok: true };
}

/**
 * True when this user has already asked to be deleted and the workflow did not
 * finish. Lets a caller resume rather than refuse, and makes a repeated request
 * idempotent rather than an error.
 */
export async function pendingDeletion(
  admin: SupabaseClient,
  userId: string
): Promise<DeletionStage | null> {
  const { data } = await admin
    .from("account_deletion_requests")
    .select("stage")
    .eq("user_id", userId)
    .maybeSingle();

  return (data?.stage as DeletionStage | undefined) ?? null;
}
