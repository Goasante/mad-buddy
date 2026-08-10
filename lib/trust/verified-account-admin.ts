import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { VerificationStatus } from "@/lib/trust/verified-account";

/**
 * The admin side of account verification.
 *
 * Without this the feature is dormant: `account_verifications` has no write
 * policy (deliberately -- see the RLS note below), so the only way to verify
 * anyone was to run SQL by hand. That is not a workflow, and hand-written SQL
 * against an identity table is exactly where a mistyped user id becomes
 * somebody else's badge.
 *
 * WHY NO MIGRATION IS NEEDED: the table, its status constraint, its unique
 * key, the `admin.verification.review` permission and the `verification_reviewer`
 * role all already exist. This adds the queue and the decision, nothing else.
 *
 * WHY THE SERVICE ROLE: `account_verifications` carries exactly one RLS policy,
 * an owner SELECT. There is no INSERT/UPDATE/DELETE policy at all, so a client
 * cannot write verification under any circumstances -- and the only way to
 * write it is code holding the service key, which is this module. That is the
 * property the security tests assert, and it is why the write lives here
 * rather than behind a normal action.
 */

/** The single verification type this queue manages. */
export const MANUAL_VERIFICATION_TYPE = "manual_review";

export type VerificationQueueEntry = {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  status: VerificationStatus;
  /** A short human label for what was checked. Never evidence itself. */
  evidenceLabel: string | null;
  verifiedAt: string | null;
  updatedAt: string;
};

/**
 * The review queue.
 *
 * Verified first is deliberately NOT the ordering. Most recently changed comes
 * first, because the question an admin arrives with is usually "what did we
 * just do" or "who needs looking at", not "who is verified" -- that is what
 * the badge on their profile is for.
 */
export async function loadVerificationQueue(
  admin: SupabaseClient,
  { statuses, limit = 100 }: { statuses?: VerificationStatus[]; limit?: number } = {}
): Promise<VerificationQueueEntry[]> {
  let query = admin
    .from("account_verifications")
    .select("user_id, status, evidence_label, verified_at, updated_at")
    .eq("verification_type", MANUAL_VERIFICATION_TYPE)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (statuses?.length) query = query.in("status", statuses);

  const { data: rows } = await query;
  if (!rows?.length) return [];

  // Profiles batched for the whole queue -- one read, never one per row.
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, full_name, username, avatar_url")
    .in("user_id", userIds);

  const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));

  return rows.map((row) => {
    const profile = profileById.get(row.user_id);
    return {
      userId: row.user_id,
      displayName: profile?.full_name?.trim() || "A Muddy",
      username: profile?.username || "muddy",
      avatarUrl: profile?.avatar_url ?? null,
      status: row.status as VerificationStatus,
      evidenceLabel: row.evidence_label,
      verifiedAt: row.verified_at,
      updatedAt: row.updated_at
    };
  });
}

export type VerificationDecision = "verified" | "revoked" | "failed";

/**
 * Records a verification decision.
 *
 * Upserts on (user_id, verification_type), which the table's unique key
 * already enforces: a person has ONE manual verification record whose status
 * changes over time, rather than a pile of rows where the newest silently
 * wins. Revoking therefore genuinely revokes -- it does not leave an older
 * `verified` row behind for `hasVerifiedAccountStatus` to find.
 *
 * `verified_at` is set only on approval and cleared otherwise, so it always
 * means "when this was verified" rather than "when it was last touched".
 */
export async function decideAccountVerification(
  admin: SupabaseClient,
  {
    userId,
    decision,
    evidenceLabel
  }: {
    userId: string;
    decision: VerificationDecision;
    /** What was checked, in a few words. Never the evidence itself. */
    evidenceLabel?: string;
  }
): Promise<{ ok: boolean; message: string }> {
  const now = new Date().toISOString();

  const { error } = await admin.from("account_verifications").upsert(
    {
      user_id: userId,
      verification_type: MANUAL_VERIFICATION_TYPE,
      status: decision,
      // Cleared on anything other than approval, so a revoked record cannot
      // read as verified-at-some-point to a careless query.
      verified_at: decision === "verified" ? now : null,
      evidence_label: evidenceLabel?.trim() || null,
      updated_at: now
    },
    { onConflict: "user_id,verification_type" }
  );

  if (error) {
    return { ok: false, message: "That verification decision could not be saved." };
  }

  return {
    ok: true,
    message:
      decision === "verified"
        ? "Account verified. The badge now appears wherever their name is shown."
        : decision === "revoked"
          ? "Verification revoked. The badge no longer appears."
          : "Marked as failed. No badge is shown."
  };
}

/** The current manual verification record for one account, or null. */
export async function getAccountVerification(
  admin: SupabaseClient,
  userId: string
): Promise<{ status: VerificationStatus; verifiedAt: string | null } | null> {
  const { data } = await admin
    .from("account_verifications")
    .select("status, verified_at")
    .eq("user_id", userId)
    .eq("verification_type", MANUAL_VERIFICATION_TYPE)
    .maybeSingle();

  return data ? { status: data.status as VerificationStatus, verifiedAt: data.verified_at } : null;
}
