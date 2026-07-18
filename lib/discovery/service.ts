import "server-only";

import { buildPublicTrustSummary, type PublicTrustSummary } from "@/lib/discovery/trust";
import { areApprovedMuddies, isBlockedEitherDirection } from "@/lib/social/permissions";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Discovery + trust server service (spec §65). Supplies facts to the pure
 * rules in lib/discovery/*. Uses the service-role admin client; callers must
 * have already authenticated the requester.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Server pepper for contact matching. Reuses the service-role key as key
 * material, it never leaves the server, and a database leak alone therefore
 * can't reverse a protected identifier.
 */
export function contactPepper(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
}

/** Signing secret for rotating personal QR tokens. */
export function qrSecret(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
}

/** Mutual Muddy count between two users, a count only, never the graph (§55). */
export async function mutualMuddyCount(admin: Admin, userA: string, userB: string): Promise<number> {
  const [aFriends, bFriends] = await Promise.all([friendIdsOf(admin, userA), friendIdsOf(admin, userB)]);
  let count = 0;
  for (const id of aFriends) if (bFriends.has(id)) count += 1;
  return count;
}

export async function friendIdsOf(admin: Admin, userId: string): Promise<Set<string>> {
  const { data } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`);
  return new Set(
    (data ?? []).map((row) => (row.user_one_id === userId ? row.user_two_id : row.user_one_id))
  );
}

async function verifiedFlags(admin: Admin, userId: string) {
  const { data } = await admin
    .from("account_verifications")
    .select("verification_type, status")
    .eq("user_id", userId)
    .eq("status", "verified");
  const types = new Set((data ?? []).map((row) => row.verification_type));
  return {
    email: types.has("email"),
    phone: types.has("phone"),
    institution: types.has("institution"),
    organisation: types.has("organisation")
  };
}

/**
 * The public trust summary for another user (spec §61). Returns only safe
 * signals, internal risk data never enters this path.
 */
export async function getPublicTrustSummary(
  admin: Admin,
  viewerId: string,
  targetId: string,
  nowMs = Date.now()
): Promise<PublicTrustSummary | null> {
  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, created_at, deleted_at")
    .eq("user_id", targetId)
    .maybeSingle();
  if (!profile || profile.deleted_at) return null;

  const [verified, mutuals, institution] = await Promise.all([
    verifiedFlags(admin, targetId),
    mutualMuddyCount(admin, viewerId, targetId),
    admin
      .from("account_verifications")
      .select("evidence_label")
      .eq("user_id", targetId)
      .eq("verification_type", "institution")
      .eq("status", "verified")
      .maybeSingle()
  ]);

  return buildPublicTrustSummary({
    verified,
    mutualCount: mutuals,
    accountCreatedAtMs: Date.parse(profile.created_at),
    nowMs,
    sharedCommunity: institution.data?.evidence_label ?? null
  });
}

/** Requests sent by this user in the trailing 24h (spec §11). */
export async function requestsSentToday(admin: Admin, userId: string, nowMs = Date.now()): Promise<number> {
  const since = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("friend_requests")
    .select("id", { count: "exact", head: true })
    .eq("sender_id", userId)
    .gte("created_at", since);
  return count ?? 0;
}

export type PairState = {
  alreadyFriends: boolean;
  isBlockedEitherDirection: boolean;
  hasPendingOutgoing: boolean;
  hasPendingIncoming: boolean;
};

/** Everything needed to decide whether a request may be sent (spec §16, §17). */
export async function resolvePairState(admin: Admin, senderId: string, recipientId: string): Promise<PairState> {
  const [friends, blocked, outgoing, incoming] = await Promise.all([
    areApprovedMuddies(admin, senderId, recipientId),
    isBlockedEitherDirection(admin, senderId, recipientId),
    admin
      .from("friend_requests")
      .select("id")
      .eq("sender_id", senderId)
      .eq("receiver_id", recipientId)
      .eq("status", "pending")
      .maybeSingle(),
    admin
      .from("friend_requests")
      .select("id")
      .eq("sender_id", recipientId)
      .eq("receiver_id", senderId)
      .eq("status", "pending")
      .maybeSingle()
  ]);

  return {
    alreadyFriends: friends,
    isBlockedEitherDirection: blocked,
    hasPendingOutgoing: Boolean(outgoing.data),
    hasPendingIncoming: Boolean(incoming.data)
  };
}

/**
 * Records an internal abuse signal. Never surfaced to users (spec §57),
 * writes only, read exclusively by staff tooling.
 */
export async function recordTrustEvent(
  admin: Admin,
  userId: string,
  eventType:
    | "request_declined"
    | "blocked_by_user"
    | "report_received"
    | "invite_abuse"
    | "duplicate_content"
    | "rapid_requests"
    | "impersonation_report",
  riskLevel: "low" | "medium" | "high" = "low"
) {
  await admin.from("account_trust_events").insert({
    user_id: userId,
    event_type: eventType,
    risk_level: riskLevel
  });
}
