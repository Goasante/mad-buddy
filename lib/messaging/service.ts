import "server-only";

import {
  directConversationKey,
  resolveCanSendMessage,
  resolveDirectMessageEligibility,
  systemMessageText,
  type MessagePermission
} from "@/lib/messaging/rules";
import { areApprovedMuddies, isBlockedEitherDirection, isCloseFriend } from "@/lib/social/permissions";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  ConversationRole,
  ConversationMemberStatus,
  ConversationStatus,
  GroupPostingMode,
  SystemEventType
} from "@/lib/supabase/database.types";

/**
 * Messaging server service (spec §69). Every "can A message / access / add"
 * decision routes through here, layered on the batch-2 permission service, so
 * the relationship and block rules stay in one audited place. Membership is
 * never trusted from the client (spec §20).
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type CommunicationPreferences = {
  messagePermission: MessagePermission;
  groupAddPermission: "anyone" | "close_friends" | "ask_me" | "nobody";
  readReceiptsEnabled: boolean;
  typingIndicatorEnabled: boolean;
  presenceEnabled: boolean;
  notificationPreview: "sender_and_message" | "sender_only" | "generic" | "none";
};

export const DEFAULT_COMMUNICATION_PREFERENCES: CommunicationPreferences = {
  messagePermission: "all_muddies",
  // Default: ask me first (spec §55).
  groupAddPermission: "ask_me",
  readReceiptsEnabled: true,
  typingIndicatorEnabled: true,
  presenceEnabled: true,
  // Privacy-first default: no message text on the lock screen (spec §56).
  notificationPreview: "sender_only"
};

export function normalizeCommunicationPreferences(raw: unknown): CommunicationPreferences {
  const base = DEFAULT_COMMUNICATION_PREFERENCES;
  if (!raw || typeof raw !== "object") return base;
  const value = raw as Partial<CommunicationPreferences>;

  const messagePermissions: MessagePermission[] = ["all_muddies", "close_friends", "selected_circles", "nobody"];
  const groupAdds: CommunicationPreferences["groupAddPermission"][] = ["anyone", "close_friends", "ask_me", "nobody"];
  const previews: CommunicationPreferences["notificationPreview"][] = [
    "sender_and_message",
    "sender_only",
    "generic",
    "none"
  ];

  return {
    messagePermission: messagePermissions.includes(value.messagePermission as MessagePermission)
      ? (value.messagePermission as MessagePermission)
      : base.messagePermission,
    groupAddPermission: groupAdds.includes(value.groupAddPermission as CommunicationPreferences["groupAddPermission"])
      ? (value.groupAddPermission as CommunicationPreferences["groupAddPermission"])
      : base.groupAddPermission,
    readReceiptsEnabled:
      typeof value.readReceiptsEnabled === "boolean" ? value.readReceiptsEnabled : base.readReceiptsEnabled,
    typingIndicatorEnabled:
      typeof value.typingIndicatorEnabled === "boolean" ? value.typingIndicatorEnabled : base.typingIndicatorEnabled,
    presenceEnabled: typeof value.presenceEnabled === "boolean" ? value.presenceEnabled : base.presenceEnabled,
    notificationPreview: previews.includes(value.notificationPreview as CommunicationPreferences["notificationPreview"])
      ? (value.notificationPreview as CommunicationPreferences["notificationPreview"])
      : base.notificationPreview
  };
}

export async function loadCommunicationPreferences(
  admin: Admin,
  userId: string
): Promise<CommunicationPreferences> {
  const { data } = await admin
    .from("user_preferences")
    .select("communication_preferences")
    .eq("user_id", userId)
    .maybeSingle();
  return normalizeCommunicationPreferences(data?.communication_preferences);
}

/** Whether `senderId` may open/continue a direct conversation with `recipientId`. */
export async function canCreateDirectConversation(
  admin: Admin,
  senderId: string,
  recipientId: string
): Promise<{ allowed: boolean; reason: string }> {
  if (senderId === recipientId) return { allowed: false, reason: "self" };

  const [mutual, blocked, prefs, closeFriend] = await Promise.all([
    areApprovedMuddies(admin, senderId, recipientId),
    isBlockedEitherDirection(admin, senderId, recipientId),
    loadCommunicationPreferences(admin, recipientId),
    isCloseFriend(admin, recipientId, senderId)
  ]);

  let sharesCircle = false;
  if (prefs.messagePermission === "selected_circles") {
    const { data: circles } = await admin.from("friend_circles").select("id").eq("user_id", recipientId);
    const circleIds = (circles ?? []).map((circle) => circle.id);
    if (circleIds.length > 0) {
      const { data: membership } = await admin
        .from("circle_members")
        .select("id")
        .eq("friend_id", senderId)
        .in("circle_id", circleIds)
        .limit(1);
      sharesCircle = Boolean(membership?.length);
    }
  }

  return resolveDirectMessageEligibility({
    areApprovedMuddies: mutual,
    isBlockedEitherDirection: blocked,
    recipientPermission: prefs.messagePermission,
    senderIsCloseFriendOfRecipient: closeFriend,
    senderSharesSelectedCircle: sharesCircle,
    recipientSuspended: false,
    senderSuspended: false
  });
}

/**
 * Finds or creates the single direct conversation for an approved pair. The
 * canonical direct_key + unique index makes a concurrent double-create collide
 * rather than produce two conversations (spec §4).
 */
export async function getOrCreateDirectConversation(
  admin: Admin,
  senderId: string,
  recipientId: string,
  context?: { contextType: "plan" | "event" | "event_circle" | "safe_arrival" | "ping" | "wave"; contextId: string }
): Promise<{ conversationId: string | null; error?: string }> {
  const eligibility = await canCreateDirectConversation(admin, senderId, recipientId);
  if (!eligibility.allowed) return { conversationId: null, error: eligibility.reason };

  const key = directConversationKey(senderId, recipientId);
  const { data: existing } = await admin
    .from("conversations")
    .select("id")
    .eq("direct_key", key)
    .eq("conversation_type", "direct")
    .maybeSingle();
  if (existing) return { conversationId: existing.id };

  const { data: created, error } = await admin
    .from("conversations")
    .insert({
      conversation_type: "direct",
      created_by: senderId,
      direct_key: key,
      context_type: context?.contextType ?? null,
      context_id: context?.contextId ?? null,
      status: "active"
    })
    .select("id")
    .single();

  // Lost a create race: the other insert won, so read theirs.
  if (error || !created) {
    const { data: raced } = await admin
      .from("conversations")
      .select("id")
      .eq("direct_key", key)
      .eq("conversation_type", "direct")
      .maybeSingle();
    return raced ? { conversationId: raced.id } : { conversationId: null, error: "create_failed" };
  }

  await admin.from("conversation_members").insert([
    { conversation_id: created.id, user_id: senderId, role: "member" as const, status: "joined" as const },
    { conversation_id: created.id, user_id: recipientId, role: "member" as const, status: "joined" as const }
  ]);

  return { conversationId: created.id };
}

export type ConversationAccess = {
  exists: boolean;
  status: ConversationStatus | null;
  role: ConversationRole | null;
  memberStatus: ConversationMemberStatus | null;
  postingMode: GroupPostingMode;
  canView: boolean;
  historyVisibleFrom: string | null;
};

/** Resolves a requester's membership and rights on a conversation (spec §20). */
export async function resolveConversationAccess(
  admin: Admin,
  userId: string,
  conversationId: string
): Promise<ConversationAccess> {
  const { data: conversation } = await admin
    .from("conversations")
    .select("id, status, conversation_type")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) {
    return {
      exists: false,
      status: null,
      role: null,
      memberStatus: null,
      postingMode: "all_members",
      canView: false,
      historyVisibleFrom: null
    };
  }

  const [{ data: member }, { data: settings }] = await Promise.all([
    admin
      .from("conversation_members")
      .select("role, status, history_visible_from")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .maybeSingle(),
    admin.from("group_settings").select("posting_mode").eq("conversation_id", conversationId).maybeSingle()
  ]);

  return {
    exists: true,
    status: conversation.status,
    role: member?.role ?? null,
    memberStatus: member?.status ?? null,
    postingMode: settings?.posting_mode ?? "all_members",
    canView: member?.status === "joined",
    historyVisibleFrom: member?.history_visible_from ?? null
  };
}

/** Full send check: membership, conversation state, posting mode, and, for
 *  direct chats, the live block/relationship state (spec §21: a block mid-chat
 *  must stop messages immediately). */
export async function canSendMessage(
  admin: Admin,
  userId: string,
  conversationId: string
): Promise<{ allowed: boolean; reason: string }> {
  const access = await resolveConversationAccess(admin, userId, conversationId);
  if (!access.exists) return { allowed: false, reason: "not_found" };

  const base = resolveCanSendMessage({
    conversationStatus: access.status ?? "archived",
    memberStatus: access.memberStatus,
    role: access.role,
    postingMode: access.postingMode
  });
  if (!base.allowed) return base;

  // Re-check the pair on every direct send, relationships change mid-chat.
  const { data: conversation } = await admin
    .from("conversations")
    .select("conversation_type, direct_key")
    .eq("id", conversationId)
    .maybeSingle();
  if (conversation?.conversation_type === "direct" && conversation.direct_key) {
    const otherId = conversation.direct_key.split(":").find((id) => id !== userId);
    if (otherId) {
      const eligibility = await canCreateDirectConversation(admin, userId, otherId);
      if (!eligibility.allowed) return { allowed: false, reason: eligibility.reason };
    }
  }

  return { allowed: true, reason: "allowed" };
}

/** Server-generated system message (spec §40), never client-authored. */
export async function publishSystemMessage(
  admin: Admin,
  conversationId: string,
  event: SystemEventType,
  detail?: string
) {
  await admin.from("messages").insert({
    conversation_id: conversationId,
    sender_id: null,
    message_type: "system",
    system_event_type: event,
    text_content: systemMessageText(event, detail),
    status: "sent"
  });
  await admin
    .from("conversations")
    .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

/**
 * Finds or creates the Plan Chat for a plan, adding active participants
 * (spec §37, §38). Idempotent via the unique (context_type, context_id) index.
 */
export async function createConversationForPlan(
  admin: Admin,
  planId: string
): Promise<string | null> {
  const { data: existing } = await admin
    .from("conversations")
    .select("id")
    .eq("context_type", "plan")
    .eq("context_id", planId)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: plan } = await admin.from("plans").select("id, creator_id, title").eq("id", planId).maybeSingle();
  if (!plan) return null;

  const { data: created, error } = await admin
    .from("conversations")
    .insert({
      conversation_type: "plan",
      created_by: plan.creator_id,
      context_type: "plan",
      context_id: planId,
      status: "active"
    })
    .select("id")
    .single();
  if (error || !created) {
    const { data: raced } = await admin
      .from("conversations")
      .select("id")
      .eq("context_type", "plan")
      .eq("context_id", planId)
      .maybeSingle();
    return raced?.id ?? null;
  }

  const { data: participants } = await admin
    .from("plan_participants")
    .select("user_id, role")
    .eq("plan_id", planId)
    .in("rsvp_status", ["invited", "viewed", "going", "maybe", "waitlisted"]);

  const rows = (participants ?? []).map((participant) => ({
    conversation_id: created.id,
    user_id: participant.user_id,
    role: (participant.role === "host" ? "owner" : "member") as ConversationRole,
    status: "joined" as const,
    // Plan Chat shows full history to participants, it's a shared context.
    history_visible_from: new Date(0).toISOString()
  }));
  if (rows.length > 0) await admin.from("conversation_members").insert(rows);

  await publishSystemMessage(admin, created.id, "conversation_created");
  return created.id;
}

/**
 * Applies a block across conversations (spec §60): the pair's direct
 * conversation is archived so neither side can send. Shared group membership
 * is left intact, group visibility filtering is handled at read time.
 */
export async function applyBlockToConversations(admin: Admin, blockerId: string, blockedId: string) {
  const key = directConversationKey(blockerId, blockedId);
  await admin
    .from("conversations")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("direct_key", key)
    .eq("conversation_type", "direct");
}
