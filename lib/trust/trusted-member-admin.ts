import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type { TrustedMemberStatus } from "@/lib/trust/trusted-member";

type Admin = SupabaseClient<Database>;

/**
 * The Trusted Member review queue.
 *
 * Its own surface rather than a corner of the users page: this workflow has a
 * lifecycle of its own — apply, approve, decline, revoke, re-apply — with
 * filters and history the general user table has no room for.
 */

export type TrustedMemberApplication = {
  id: string;
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  status: TrustedMemberStatus;
  note: string | null;
  /** What was true when they applied, not a fresh reading. */
  premiumDaysAtApply: number | null;
  journeysCompleteAtApply: number | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** Set only when this account currently holds the badge. */
  trustedSince: string | null;
};

/**
 * Load the queue.
 *
 * Pending first and oldest first within that, so the person who has waited
 * longest is reviewed next. Decided applications remain visible — the history
 * is how a reviewer sees that someone was declined twice before, which is
 * exactly the context a fresh queue would hide.
 */
export async function loadTrustedMemberQueue(
  admin: Admin,
  filter: "pending" | "all" = "pending",
  limit = 100
): Promise<TrustedMemberApplication[]> {
  let query = admin
    .from("trusted_member_applications")
    .select(
      "id, user_id, status, note, premium_days_at_apply, journeys_complete_at_apply, created_at, reviewed_at, review_note"
    )
    .order("created_at", { ascending: true })
    .limit(limit);

  if (filter === "pending") query = query.eq("status", "pending");

  const { data: applications } = await query;
  if (!applications?.length) return [];

  // One batched profile read rather than one per row.
  const userIds = [...new Set(applications.map((row) => row.user_id))];
  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, full_name, username, avatar_url, trusted_member_since")
    .in("user_id", userIds);
  const profileById = new Map((profiles ?? []).map((row) => [row.user_id, row]));

  return applications.flatMap((row) => {
    const profile = profileById.get(row.user_id);
    // A deleted account leaves its application behind briefly. Skipped rather
    // than rendered as a nameless row a reviewer cannot act on meaningfully.
    if (!profile) return [];

    return [
      {
        id: row.id,
        userId: row.user_id,
        displayName: profile.full_name?.trim() || profile.username,
        username: profile.username,
        avatarUrl: profile.avatar_url,
        status: row.status as TrustedMemberStatus,
        note: row.note,
        premiumDaysAtApply: row.premium_days_at_apply,
        journeysCompleteAtApply: row.journeys_complete_at_apply,
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at,
        reviewNote: row.review_note,
        trustedSince: profile.trusted_member_since
      }
    ];
  });
}

/**
 * Approve, decline or revoke.
 *
 * The badge itself lives on `profiles.trusted_member_since`, denormalised so
 * every surface that already reads a profile gets it without a join. This
 * writes both: the application records the decision, the profile carries the
 * badge, and they are updated together so a reviewer never sees one without
 * the other.
 *
 * Revoking clears the profile column while leaving the application row as
 * `revoked`. The history stays; only the badge goes.
 */
export async function decideTrustedMemberApplication(
  admin: Admin,
  input: {
    applicationId: string;
    reviewerId: string;
    decision: "approved" | "declined" | "revoked";
    reviewNote?: string | null;
  }
): Promise<{ ok: boolean; message: string; userId?: string }> {
  const { data: application } = await admin
    .from("trusted_member_applications")
    .select("id, user_id, status")
    .eq("id", input.applicationId)
    .maybeSingle();
  if (!application) return { ok: false, message: "That application is unavailable." };

  const nowIso = new Date().toISOString();
  const { error: applicationError } = await admin
    .from("trusted_member_applications")
    .update({
      status: input.decision,
      reviewed_by: input.reviewerId,
      reviewed_at: nowIso,
      review_note: input.reviewNote?.trim() || null,
      updated_at: nowIso
    })
    .eq("id", input.applicationId);
  if (applicationError) return { ok: false, message: "Couldn't record that decision. Try again." };

  // The badge follows the decision. Approving sets it; declining and revoking
  // clear it — declining an already-badged account is how a mistaken approval
  // gets undone.
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      trusted_member_since: input.decision === "approved" ? nowIso : null,
      updated_at: nowIso
    })
    .eq("user_id", application.user_id);

  if (profileError) {
    // Roll the decision back rather than leaving the queue saying one thing
    // and the profile another.
    await admin
      .from("trusted_member_applications")
      .update({ status: application.status, updated_at: nowIso })
      .eq("id", input.applicationId);
    return { ok: false, message: "Couldn't update the badge. Nothing was changed." };
  }

  return { ok: true, message: "Decision recorded.", userId: application.user_id };
}

/**
 * Direct staff recognition from the Users console.
 *
 * This intentionally writes the same profile field and the same permanent
 * review-history row as the application workflow. It is not a second badge
 * system and it does not weaken the server-authoritative projection used by
 * profile, Messages, Muddies, Groups, or Linkr.
 */
export async function setTrustedMemberRecognition(
  admin: Admin,
  input: {
    userId: string;
    reviewerId: string;
    trusted: boolean;
    reason: string;
  }
): Promise<{ ok: boolean; changed: boolean; message: string }> {
  const [{ data: profile }, { data: existingApplication }] = await Promise.all([
    admin
      .from("profiles")
      .select("user_id, trusted_member_since, deleted_at")
      .eq("user_id", input.userId)
      .maybeSingle(),
    admin
      .from("trusted_member_applications")
      .select("id, status, reviewed_by, reviewed_at, review_note, updated_at")
      .eq("user_id", input.userId)
      .maybeSingle()
  ]);

  if (!profile || profile.deleted_at) {
    return { ok: false, changed: false, message: "That account is unavailable." };
  }
  if (Boolean(profile.trusted_member_since) === input.trusted) {
    return {
      ok: true,
      changed: false,
      message: input.trusted ? "This user is already a Trusted Member." : "This user does not have the Trusted Member badge."
    };
  }

  const nowIso = new Date().toISOString();
  const status = input.trusted ? "approved" : "revoked";
  let applicationId: string | null = existingApplication?.id ?? null;

  if (existingApplication) {
    const { error } = await admin
      .from("trusted_member_applications")
      .update({
        status,
        reviewed_by: input.reviewerId,
        reviewed_at: nowIso,
        review_note: input.reason.trim(),
        updated_at: nowIso
      })
      .eq("id", existingApplication.id);
    if (error) return { ok: false, changed: false, message: "Couldn't record the Trusted Member decision." };
  } else {
    const { data, error } = await admin
      .from("trusted_member_applications")
      .insert({
        user_id: input.userId,
        status,
        reviewed_by: input.reviewerId,
        reviewed_at: nowIso,
        review_note: input.reason.trim(),
        updated_at: nowIso
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, changed: false, message: "Couldn't record the Trusted Member decision." };
    applicationId = data.id;
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ trusted_member_since: input.trusted ? nowIso : null, updated_at: nowIso })
    .eq("user_id", input.userId);

  if (profileError) {
    if (existingApplication) {
      await admin
        .from("trusted_member_applications")
        .update({
          status: existingApplication.status,
          reviewed_by: existingApplication.reviewed_by,
          reviewed_at: existingApplication.reviewed_at,
          review_note: existingApplication.review_note,
          updated_at: existingApplication.updated_at
        })
        .eq("id", existingApplication.id);
    } else if (applicationId) {
      await admin.from("trusted_member_applications").delete().eq("id", applicationId);
    }
    return { ok: false, changed: false, message: "Couldn't update the badge. Nothing was changed." };
  }

  return {
    ok: true,
    changed: true,
    message: input.trusted ? "Trusted Member badge granted." : "Trusted Member badge removed."
  };
}
