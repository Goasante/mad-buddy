"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAdminAccess, requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { getRepair, REPAIR_IDS } from "@/lib/admin/repairs";
import {
  blockedByRule,
  fixed,
  notApplicable,
  type RepairVerification,
  stillBroken
} from "@/lib/admin/repair-verification";

/**
 * `ok` reports whether the MUTATION was accepted. `verification` reports
 * whether the user's actual problem is solved, re-read from the database after
 * the write -- see lib/admin/repair-verification.ts for why those are not the
 * same question. Repairs that have not yet been given a verifier omit it, and
 * the UI says so rather than implying an unverified repair worked.
 */
export type RepairActionState = { ok: boolean; message: string; verification?: RepairVerification };

type Admin = Awaited<ReturnType<typeof requireSafetyAdmin>>["admin"];

// --- User search (minimum fields only) ------------------------------------
export type RepairUser = { userId: string; name: string; username: string; avatarUrl: string | null };
export type RepairSearchState = { ok: boolean; message: string; results: RepairUser[] };

const searchSchema = z.object({ query: z.string().trim().min(2).max(80) });

export async function searchRepairUsersAction(input: unknown): Promise<RepairSearchState> {
  const empty: RepairSearchState = { ok: false, message: "", results: [] };
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return { ...empty, message: "Enter a search term." };

  let admin: Admin;
  try {
    const { admin: client, context } = await requireSafetyAdmin();
    admin = client;
    await requireAdminPermission(admin, context, "admin.support.manage");
    const limit = await consumeRateLimit({ action: "admin.search", userId: context.userId });
    if (!limit.allowed) return { ...empty, message: rateLimitMessage(limit.resetAt) };
  } catch {
    return { ...empty, message: "Admin access is required." };
  }

  const term = parsed.data.query;
  const { data, error } = await admin
    .from("profiles")
    .select("user_id, full_name, username, avatar_url")
    .is("deleted_at", null)
    .or(`full_name.ilike.%${term}%,username.ilike.%${term}%`)
    .order("full_name", { ascending: true })
    .limit(8);
  if (error) return { ...empty, message: "Search could not be completed." };

  return {
    ok: true,
    message: "",
    results: (data ?? []).map((row) => ({
      userId: row.user_id,
      name: row.full_name,
      username: row.username,
      avatarUrl: row.avatar_url
    }))
  };
}

// --- Run a repair ---------------------------------------------------------
const runSchema = z.object({
  userId: z.string().uuid(),
  repairId: z.enum(REPAIR_IDS),
  reason: z.string().trim().max(300).optional()
});

/**
 * Executes one narrowly-scoped repair against one user. Every guard is
 * server-side: the acting user is resolved from the session, the per-repair
 * permission is re-checked, the target must exist and be active, and the
 * action is audited before it runs (audit-first: an unlogged repair is worse
 * than a failed one).
 */
export async function runAccountRepairAction(input: unknown): Promise<RepairActionState> {
  const parsed = runSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid repair and user." };

  const repair = getRepair(parsed.data.repairId);
  if (!repair) return { ok: false, message: "That repair is not available." };

  const { userId, reason } = parsed.data;
  if (repair.requiresReason && (!reason || reason.length < 3)) {
    return { ok: false, message: "Add a short reason for this repair." };
  }

  let admin: Admin;
  let actorId: string;
  try {
    const { admin: client, context } = await requireSafetyAdmin();
    admin = client;
    actorId = context.userId;
    // Per-repair permission — not just page access.
    await requireAdminPermission(admin, context, repair.permission);
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: actorId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
  } catch {
    return { ok: false, message: "You don't have permission to run this repair." };
  }

  // Target must be a real, non-deleted account.
  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, full_name, deleted_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile || profile.deleted_at) return { ok: false, message: "That account is unavailable." };

  // Audit-first.
  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: `repair:${repair.id}`,
    targetType: "user",
    targetId: userId,
    newState: { repairId: repair.id, risk: repair.risk },
    reason: reason || repair.label
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no repair was run." };

  const result = await executeRepair(admin, repair.id, userId);
  if (!result.ok) return result;

  revalidatePath("/admin/repairs");
  if (repair.id === "reconcile_direct_messaging") {
    revalidatePath("/messages");
    revalidatePath("/friends");
    revalidatePath("/dashboard");
  }
  if (repair.id === "reconcile_plan_chats") {
    revalidatePath("/plans");
    revalidatePath("/messages");
    revalidatePath("/dashboard");
  }
  if (repair.id === "settle_stranded_upfor_requests") {
    revalidatePath("/upfor");
    revalidatePath("/dashboard");
  }
  if (repair.id === "close_stalled_safe_arrival") {
    revalidatePath("/safe-arrival");
    revalidatePath("/dashboard");
  }
  // The verification travels with the result: dropping it here would hand the
  // operator a bare "success" for a repair that may have changed nothing.
  return { ok: true, message: result.message, verification: result.verification };
}

/**
 * The one place repairs touch data. Each branch is scoped to a single user and
 * a canonical invariant. No branch deletes account-defining records such as
 * profiles, auth identities, subscriptions or messages.
 */
async function executeRepair(admin: Admin, repairId: string, userId: string): Promise<RepairActionState> {
  switch (repairId) {
    case "reconcile_direct_messaging":
      return reconcileDirectMessaging(admin, userId);
    case "reconcile_plan_chats":
      return reconcilePlanChats(admin, userId);
    case "settle_stranded_upfor_requests":
      return settleStrandedUpForRequests(admin, userId);
    case "close_stalled_safe_arrival":
      return closeStalledSafeArrival(admin, userId);
    case "pause_visibility": {
      const { error } = await admin.from("profiles").update({ visibility_status: "ghost" }).eq("user_id", userId);
      return error ? fail("pause visibility") : { ok: true, message: "Visibility paused (Ghost Mode)." };
    }
    case "reset_glow_signal": {
      const { data, error } = await admin.from("user_locations").delete().eq("user_id", userId).select("user_id");
      return error ? fail("reset the glow signal") : { ok: true, message: `Glow signal reset (${data?.length ?? 0} cleared).` };
    }
    case "clear_stuck_status": {
      const { data, error } = await admin.from("user_statuses").delete().eq("user_id", userId).select("id");
      return error ? fail("clear the status") : { ok: true, message: data && data.length ? "Stuck status cleared." : "No active status to clear." };
    }
    case "clear_notification_badge": {
      const { data, error } = await admin.from("notifications").update({ is_read: true }).eq("user_id", userId).eq("is_read", false).select("id");
      return error ? fail("clear the notification badge") : { ok: true, message: `Badge cleared (${data?.length ?? 0} marked read).` };
    }
    case "clear_push_subscriptions": {
      const { data, error } = await admin.from("push_subscriptions").delete().eq("user_id", userId).select("id");
      return error ? fail("reset push devices") : { ok: true, message: `Push devices reset (${data?.length ?? 0} removed).` };
    }
    case "clear_rate_limits": {
      const { data, error } = await admin.from("rate_limits").delete().eq("user_id", userId).select("id");
      return error ? fail("clear rate limits") : { ok: true, message: `Rate-limit lockout cleared (${data?.length ?? 0} counters).` };
    }
    case "reset_onboarding": {
      const { error } = await admin.from("profiles").update({ is_onboarded: false }).eq("user_id", userId);
      return error ? fail("re-trigger onboarding") : { ok: true, message: "Onboarding will restart on next open." };
    }
    default:
      return { ok: false, message: "That repair is not available." };
  }
}

/**
 * Repairs the exact class of lifecycle mismatch behind "we are Muddies again,
 * but messages still say Not sent" without weakening block authority.
 *
 * It never creates a friendship or a conversation. Only an already-archived
 * direct conversation for a CURRENT, UNBLOCKED friendship can be reopened.
 *
 * NOW A BACKSTOP, NOT THE PRIMARY AUTHORITY (migration 20260907140000).
 *
 * The database reopens this itself: `reopen_direct_conversation_on_friendship`
 * fires when a friendship goes live, and `reopen_direct_conversation_on_unblock`
 * fires when the LAST block is lifted, so whichever of the two events happens
 * second performs the restoration. No current code path can produce the drift
 * this repair targets.
 *
 * It is deliberately KEPT for rows that drifted BEFORE that migration shipped
 * (2026-09-07) -- those are real and the trigger is not retroactive. The rule
 * it applies is deliberately identical to the trigger's: live friendship, no
 * block in EITHER direction, only an `archived` direct conversation touched,
 * nothing created. If the two ever disagree the database wins and this should
 * be deleted, not "fixed" -- one lifecycle, one authority.
 *
 * Held by lib/admin/account-doctor-lifecycle.local.test.ts.
 */
async function reconcileDirectMessaging(admin: Admin, userId: string): Promise<RepairActionState> {
  const [{ data: friendships, error: friendshipError }, { data: blocks, error: blockError }, { data: memberships, error: membershipError }] =
    await Promise.all([
      admin
        .from("friendships")
        .select("user_one_id, user_two_id")
        .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
        .is("ended_at", null),
      admin
        .from("blocked_users")
        .select("blocker_id, blocked_id")
        .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
      admin.from("conversation_members").select("conversation_id").eq("user_id", userId)
    ]);

  if (friendshipError || blockError || membershipError) return fail("inspect direct messaging state");

  const friendIds = new Set(
    (friendships ?? []).map((row) => (row.user_one_id === userId ? row.user_two_id : row.user_one_id))
  );
  const blockedIds = new Set(
    (blocks ?? []).map((row) => (row.blocker_id === userId ? row.blocked_id : row.blocker_id))
  );
  const eligibleFriendIds = new Set([...friendIds].filter((id) => !blockedIds.has(id)));
  if (eligibleFriendIds.size === 0) {
    /* Two very different situations, and Support must not be told the same
       thing for both. If every Muddy is blocked, the product is refusing on
       purpose and no repair should ever cross that. If there are simply no
       Muddies, there was nothing here to fix and the report is about
       something else. */
    /* Derived from blocks THEMSELVES, not from an intersection with live
       friendships. Blocking ENDS the friendship (blockUserAction sets
       ended_at), so by the time Support looks there is no live friendship left
       to intersect -- and asking "is a blocked person still a Muddy" always
       answered no, reporting "nothing to repair" to someone whose real
       situation is "you blocked them". Any standing block on this account is
       enough to say the product is refusing on purpose. */
    const blockedAway = blockedIds.size > 0;
    return {
      ok: true,
      message: "No current unblocked Muddy conversations need reconciliation.",
      verification: blockedAway
        ? blockedByRule(
            "an unblocked, currently-live friendship exists for the conversation",
            "A live block outranks friendship, in either direction",
            "This account has a live block, and blocking ends the friendship it applies to. No conversation may be reopened while it stands."
          )
        : notApplicable(
            "an unblocked, currently-live friendship exists for the conversation",
            "This account has no current Muddy relationships, so there is no direct conversation to reconcile."
          )
    };
  }

  const conversationIds = [...new Set((memberships ?? []).map((row) => row.conversation_id))];
  if (conversationIds.length === 0) {
    return { ok: true, message: "No existing direct conversations need reconciliation." };
  }

  const { data: conversations, error: conversationError } = await admin
    .from("conversations")
    .select("id, direct_key, status")
    .eq("conversation_type", "direct")
    .in("id", conversationIds);
  if (conversationError) return fail("inspect direct conversations");

  const eligibleConversationIds: string[] = [];
  const eligibleMemberIds = new Set<string>([userId]);
  /* Counted separately so the verification can tell Support WHY a thread is
     still closed. Blocking ends the friendship, so a blocked pair's archived
     conversation is skipped by the same `continue` as an ordinary ex-Muddy --
     and reporting "nothing to repair" to someone whose real situation is a
     live block sends the operator hunting for a bug that is not there. */
  let blockedArchivedCount = 0;
  for (const conversation of conversations ?? []) {
    const otherId = otherUserFromDirectKey(conversation.direct_key, userId);
    if (!otherId) continue;
    if (conversation.status !== "archived") continue;
    if (blockedIds.has(otherId)) {
      blockedArchivedCount += 1;
      continue;
    }
    if (!eligibleFriendIds.has(otherId)) continue;
    eligibleConversationIds.push(conversation.id);
    eligibleMemberIds.add(otherId);
  }

  if (eligibleConversationIds.length === 0) {
    return {
      ok: true,
      message: "Direct messaging already matches current friendship and block state.",
      verification:
        blockedArchivedCount > 0
          ? blockedByRule(
              "no archived direct conversation belongs to a live, unblocked friendship",
              "A live block outranks friendship, in either direction",
              `${blockedArchivedCount} conversation${blockedArchivedCount === 1 ? " is" : "s are"} closed because of a live block. That is correct, and Admin must not reopen it — the block has to be lifted by the person who made it.`
            )
          : notApplicable(
              "no archived direct conversation belongs to a live, unblocked friendship",
              "Direct messaging was already consistent, so nothing was changed."
            )
    };
  }

  const now = new Date().toISOString();
  const { error: conversationUpdateError } = await admin
    .from("conversations")
    .update({ status: "active", updated_at: now })
    .in("id", eligibleConversationIds)
    .eq("conversation_type", "direct")
    .eq("status", "archived");
  if (conversationUpdateError) return fail("reopen eligible direct conversations");

  const { error: memberUpdateError } = await admin
    .from("conversation_members")
    .update({ status: "joined", left_at: null, updated_at: now })
    .in("conversation_id", eligibleConversationIds)
    .in("user_id", [...eligibleMemberIds]);
  if (memberUpdateError) return fail("restore direct conversation membership");

  /* THE INVARIANT, RE-READ. Not "the update succeeded" -- the state the user
     actually experiences: every conversation we just touched is active, and
     both people are joined to it. `resolveCanSendMessage` refuses on either
     condition, so checking one would still let a broken thread report FIXED. */
  const [{ data: verifyConversations }, { data: verifyMembers }] = await Promise.all([
    admin.from("conversations").select("id, status").in("id", eligibleConversationIds),
    admin
      .from("conversation_members")
      .select("conversation_id, user_id, status")
      .in("conversation_id", eligibleConversationIds)
  ]);

  const stillArchived = (verifyConversations ?? []).filter((row) => row.status !== "active");
  const joinedByConversation = new Map<string, number>();
  for (const row of verifyMembers ?? []) {
    if (row.status !== "joined") continue;
    joinedByConversation.set(row.conversation_id, (joinedByConversation.get(row.conversation_id) ?? 0) + 1);
  }
  const missingMembers = eligibleConversationIds.filter((id) => (joinedByConversation.get(id) ?? 0) < 2);

  const count = eligibleConversationIds.length;
  const message = `Direct messaging reconciled (${count} conversation${count === 1 ? "" : "s"} restored).`;
  const invariant = "every repaired direct conversation is active with both people joined";

  if (stillArchived.length > 0 || missingMembers.length > 0) {
    return {
      ok: true,
      message,
      verification: stillBroken(
        invariant,
        stillArchived.length > 0
          ? `${stillArchived.length} conversation${stillArchived.length === 1 ? " is" : "s are"} still not active after the repair.`
          : `${missingMembers.length} conversation${missingMembers.length === 1 ? " is" : "s are"} missing a joined member after the repair.`
      )
    };
  }

  return {
    ok: true,
    message,
    verification: fixed(
      invariant,
      `${count} direct conversation${count === 1 ? " is" : "s are"} usable again, with both people joined and history intact.`
    )
  };
}

/**
 * Uses the existing canonical Plan lifecycle authority rather than manually
 * editing conversation membership. This is deliberately a reconciliation, not
 * an invitation mechanism.
 */
async function reconcilePlanChats(admin: Admin, userId: string): Promise<RepairActionState> {
  const { data: participantRows, error: participantError } = await admin
    .from("plan_participants")
    .select("plan_id")
    .eq("user_id", userId)
    .in("rsvp_status", ["going", "maybe"])
    .limit(50);
  if (participantError) return fail("inspect Plan participation");

  const participantPlanIds = [...new Set((participantRows ?? []).map((row) => row.plan_id))];
  if (participantPlanIds.length === 0) return { ok: true, message: "No active Plan Chat memberships need reconciliation." };

  const { data: plans, error: plansError } = await admin
    .from("plans")
    .select("id")
    .in("id", participantPlanIds)
    .in("status", ["draft", "inviting", "polling", "confirmed"])
    .limit(50);
  if (plansError) return fail("inspect active Plans");

  const planIds = (plans ?? []).map((row) => row.id);
  if (planIds.length === 0) {
    return {
      ok: true,
      message: "No active Plan Chat memberships need reconciliation.",
      verification: notApplicable(
        "the user is a joined member of every active Plan they are going to",
        "This account has no active Plans, so there is no Plan Chat membership to reconcile."
      )
    };
  }

  let reconciled = 0;
  for (const planId of planIds) {
    const { error } = await admin.rpc("reconcile_plan_conversation_members", { p_plan_id: planId });
    if (error) return fail("reconcile Plan Chat membership");
    reconciled += 1;
  }

  /* THE INVARIANT, RE-READ. The reconciler returning cleanly is not the claim:
     it runs happily and admits nobody when the person is genuinely ineligible.
     The claim is that this user is now a joined member of each active Plan's
     chat -- which is what they reported they could not reach.

     A Plan with no conversation is not a failure here. The canonical lifecycle
     creates one on reconcile, so its absence means the Plan legitimately has
     none yet, not that the repair failed. */
  const { data: planConversations } = await admin
    .from("conversations")
    .select("id, context_id")
    .eq("context_type", "plan")
    .in("context_id", planIds);

  const conversationIds = (planConversations ?? []).map((row) => row.id);
  const { data: myMemberships } = conversationIds.length
    ? await admin
        .from("conversation_members")
        .select("conversation_id, status")
        .eq("user_id", userId)
        .in("conversation_id", conversationIds)
    : { data: [] };

  const joined = new Set(
    (myMemberships ?? [])
      .filter((row: { status: string }) => row.status === "joined")
      .map((row: { conversation_id: string }) => row.conversation_id)
  );
  const missing = conversationIds.filter((id) => !joined.has(id));

  const message = `Plan Chats reconciled (${reconciled} active Plan${reconciled === 1 ? "" : "s"} checked).`;
  const invariant = "the user is a joined member of every active Plan Chat they are going to";

  if (missing.length > 0) {
    /* The reconciler ran and still did not admit them. That is the canonical
       authority declining -- a removed participant, a block against the host,
       or a closed Plan -- not account drift Admin should force past. */
    return {
      ok: true,
      message,
      verification: blockedByRule(
        invariant,
        "Plan Chat membership is decided by the canonical Plan lifecycle, which Admin does not override",
        `${missing.length} Plan Chat${missing.length === 1 ? "" : "s"} still exclude${missing.length === 1 ? "s" : ""} this account. The Plan lifecycle is refusing on purpose — check for a removal, a block against the host, or a closed Plan.`
      )
    };
  }

  return {
    ok: true,
    message,
    verification: fixed(
      invariant,
      conversationIds.length === 0
        ? "No Plan Chats exist for these Plans yet, and the account's participation is consistent."
        : `The account is a joined member of all ${conversationIds.length} active Plan Chat${conversationIds.length === 1 ? "" : "s"}.`
    )
  };
}

/**
 * Declines requests left pending on the account's OWN closed UpFors.
 *
 * Scoped to sessions this user owns, so it can only ever end a wait the user
 * themselves created. It adds nobody to anything: a declined request grants no
 * membership, and a live session is never touched.
 */
async function settleStrandedUpForRequests(admin: Admin, userId: string): Promise<RepairActionState> {
  const { data: closedSessions, error: sessionError } = await admin
    .from("hangout_sessions")
    .select("id")
    .eq("owner_id", userId)
    .in("status", ["expired", "cancelled", "converted_to_plan"]);
  if (sessionError) return fail("inspect this account's UpFor sessions");

  const sessionIds = (closedSessions ?? []).map((row) => row.id);
  const invariant = "no request is left pending on a closed UpFor";
  if (sessionIds.length === 0) {
    return {
      ok: true,
      message: "No closed UpFors on this account.",
      verification: notApplicable(invariant, "This account owns no closed UpFor sessions.")
    };
  }

  const { data: settled, error: settleError } = await admin
    .from("hangout_requests")
    .update({ status: "declined" })
    .eq("status", "pending")
    .in("hangout_session_id", sessionIds)
    .select("id");
  if (settleError) return fail("settle the stranded requests");

  const attempted = (settled ?? []).length;

  // THE INVARIANT, RE-READ.
  const { data: remaining } = await admin
    .from("hangout_requests")
    .select("id")
    .eq("status", "pending")
    .in("hangout_session_id", sessionIds);

  const message = `Stranded requests settled (${attempted}).`;
  if (attempted === 0) {
    return {
      ok: true,
      message: "No requests were stranded on closed UpFors.",
      verification: notApplicable(invariant, "Nobody was left waiting on a closed UpFor.")
    };
  }
  if ((remaining ?? []).length > 0) {
    return {
      ok: true,
      message,
      verification: stillBroken(
        invariant,
        `${(remaining ?? []).length} request${(remaining ?? []).length === 1 ? " is" : "s are"} still pending on a closed UpFor.`
      )
    };
  }
  return {
    ok: true,
    message,
    verification: fixed(
      invariant,
      `${attempted} stranded request${attempted === 1 ? "" : "s"} settled. Nobody was added to anything — the requests were closed, not granted.`
    )
  };
}

/**
 * Expires journeys that are past both the arrival time and the grace period.
 *
 * `unconfirmed` IS EXCLUDED, and that exclusion is the whole safety argument
 * of this repair. That status means the traveller did not confirm arrival and
 * their watchers were told; closing it would erase a signal somebody may still
 * be acting on. The status filter below is the enforcement, not a comment.
 */
async function closeStalledSafeArrival(admin: Admin, userId: string): Promise<RepairActionState> {
  const invariant = "no Safe Arrival session is marked live past its grace period";

  const { data: sessions, error } = await admin
    .from("safe_arrival_sessions")
    .select("id, status, expected_arrival_at, grace_period_minutes")
    .eq("traveller_id", userId)
    .in("status", ["active", "grace_period", "extended"]);
  if (error) return fail("inspect this account's journeys");

  const now = Date.now();
  const stalledIds = (sessions ?? [])
    .filter(
      (row) =>
        Boolean(row.expected_arrival_at) &&
        Date.parse(row.expected_arrival_at!) + (row.grace_period_minutes ?? 0) * 60_000 <= now
    )
    .map((row) => row.id);

  if (stalledIds.length === 0) {
    return {
      ok: true,
      message: "No journeys are stalled past their grace period.",
      verification: notApplicable(invariant, "This account has no journeys stalled past their grace period.")
    };
  }

  const { error: updateError } = await admin
    .from("safe_arrival_sessions")
    .update({ status: "expired", expired_at: new Date().toISOString() })
    .in("id", stalledIds)
    /* Restated on the write itself. If a session transitioned to `unconfirmed`
       between the read above and this update, it must not be caught here. */
    .in("status", ["active", "grace_period", "extended"]);
  if (updateError) return fail("close the finished journeys");

  const { data: stillLive } = await admin
    .from("safe_arrival_sessions")
    .select("id")
    .in("id", stalledIds)
    .in("status", ["active", "grace_period", "extended"]);

  const message = `Finished journeys closed (${stalledIds.length}).`;
  if ((stillLive ?? []).length > 0) {
    return {
      ok: true,
      message,
      verification: stillBroken(
        invariant,
        `${(stillLive ?? []).length} journey${(stillLive ?? []).length === 1 ? " is" : "s are"} still marked live after the repair.`
      )
    };
  }
  return {
    ok: true,
    message,
    verification: fixed(
      invariant,
      `${stalledIds.length} finished journey${stalledIds.length === 1 ? "" : "s"} closed. This corrects the record only — it says nothing about whether the person arrived safely, and no watcher alert was withdrawn.`
    )
  };
}

function otherUserFromDirectKey(directKey: string | null, userId: string): string | null {
  if (!directKey) return null;
  const pair = directKey.split(":");
  if (pair.length !== 2 || !pair.includes(userId)) return null;
  return pair[0] === userId ? pair[1] ?? null : pair[0] ?? null;
}

function fail(what: string): RepairActionState {
  return { ok: false, message: `Couldn't ${what}. No change was made.` };
}

// --- Recent repairs for a user (audit-backed history) ---------------------
export type RepairHistoryEntry = { id: string; repairLabel: string; actorName: string; reason: string | null; createdAt: string };
export type RepairHistoryState = { ok: boolean; entries: RepairHistoryEntry[] };

const historySchema = z.object({ userId: z.string().uuid() });

export async function getRecentRepairsAction(input: unknown): Promise<RepairHistoryState> {
  const parsed = historySchema.safeParse(input);
  if (!parsed.success) return { ok: false, entries: [] };

  let admin: Admin;
  try {
    const { admin: client, context } = await requireSafetyAdmin();
    admin = client;
    const access = await getAdminAccess(admin, context);
    if (!access.permissions.has("admin.support.manage")) return { ok: false, entries: [] };
  } catch {
    return { ok: false, entries: [] };
  }

  const { data } = await admin
    .from("admin_audit_events")
    .select("id, actor_id, action, reason, created_at")
    .eq("target_id", parsed.data.userId)
    .like("action", "repair:%")
    .order("created_at", { ascending: false })
    .limit(10);
  const rows = data ?? [];

  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
  const actorName = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: actors } = await admin.from("profiles").select("user_id, full_name").in("user_id", actorIds);
    for (const actor of actors ?? []) actorName.set(actor.user_id, actor.full_name);
  }

  return {
    ok: true,
    entries: rows.map((row) => {
      const repair = getRepair(row.action.replace("repair:", ""));
      return {
        id: row.id,
        repairLabel: repair?.label ?? row.action.replace("repair:", "").replaceAll("_", " "),
        actorName: row.actor_id ? actorName.get(row.actor_id) ?? "Staff member" : "System",
        reason: row.reason,
        createdAt: row.created_at
      };
    })
  };
}
