import type {
  ConversationMemberStatus,
  ConversationRole,
  ConversationStatus,
  GroupPostingMode,
  SubscriptionPlan,
  SystemEventType
} from "@/lib/supabase/database.types";

/**
 * Messaging domain core (feature architecture batch 7). Pure, deterministic
 * rules for eligibility, validation, roles, delivery/read state, and voice
 * note limits. No I/O — the messaging service supplies facts, this decides.
 *
 * Honest crypto note (spec §62): nothing here encrypts anything. Messages are
 * protected in transit and access-controlled. That is NOT end-to-end
 * encryption and must never be described as such in UI copy.
 */

// ---------------------------------------------------------------------------
// Message validation (spec §8)
// ---------------------------------------------------------------------------

export const MESSAGE_MAX_LENGTH = 2000;

export function validateMessageText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 1) return "Write a message first.";
  if (text.length > MESSAGE_MAX_LENGTH) {
    return `Messages are at most ${MESSAGE_MAX_LENGTH} characters.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Direct conversation key (spec §4) — exactly one per approved pair.
// ---------------------------------------------------------------------------

/**
 * Canonical key for a direct pair: ids sorted, so (a,b) and (b,a) collide on
 * the unique index. This is what makes "only one active one-to-one
 * conversation per pair" true even under concurrent first-messages.
 */
export function directConversationKey(userA: string, userB: string): string {
  return [userA, userB].sort().join(":");
}

// ---------------------------------------------------------------------------
// Messaging permission (spec §3, §54)
// ---------------------------------------------------------------------------

export type MessagePermission = "all_muddies" | "close_friends" | "selected_circles" | "nobody";

export type DirectMessageEligibilityInput = {
  areApprovedMuddies: boolean;
  isBlockedEitherDirection: boolean;
  recipientPermission: MessagePermission;
  senderIsCloseFriendOfRecipient: boolean;
  senderSharesSelectedCircle: boolean;
  recipientSuspended: boolean;
  senderSuspended: boolean;
};

export type DirectMessageEligibility = {
  allowed: boolean;
  reason:
    | "blocked"
    | "not_muddies"
    | "suspended"
    | "recipient_accepts_nobody"
    | "not_close_friend"
    | "not_in_circle"
    | "allowed";
};

/**
 * Whether the sender may open/continue a direct conversation. Strangers can
 * never message by default (spec §3): approved-Muddy status is required before
 * any preference is even consulted.
 */
export function resolveDirectMessageEligibility(
  input: DirectMessageEligibilityInput
): DirectMessageEligibility {
  if (input.isBlockedEitherDirection) return { allowed: false, reason: "blocked" };
  if (!input.areApprovedMuddies) return { allowed: false, reason: "not_muddies" };
  if (input.recipientSuspended || input.senderSuspended) return { allowed: false, reason: "suspended" };

  switch (input.recipientPermission) {
    case "nobody":
      return { allowed: false, reason: "recipient_accepts_nobody" };
    case "close_friends":
      return input.senderIsCloseFriendOfRecipient
        ? { allowed: true, reason: "allowed" }
        : { allowed: false, reason: "not_close_friend" };
    case "selected_circles":
      return input.senderSharesSelectedCircle
        ? { allowed: true, reason: "allowed" }
        : { allowed: false, reason: "not_in_circle" };
    case "all_muddies":
    default:
      return { allowed: true, reason: "allowed" };
  }
}

// ---------------------------------------------------------------------------
// Send permission within a conversation (spec §20, §27)
// ---------------------------------------------------------------------------

export type SendMessageInput = {
  conversationStatus: ConversationStatus;
  memberStatus: ConversationMemberStatus | null;
  role: ConversationRole | null;
  postingMode: GroupPostingMode;
};

export type SendMessageResult = {
  allowed: boolean;
  reason: "not_a_member" | "conversation_closed" | "posting_restricted" | "allowed";
};

export function resolveCanSendMessage(input: SendMessageInput): SendMessageResult {
  if (input.memberStatus !== "joined") return { allowed: false, reason: "not_a_member" };
  if (input.conversationStatus !== "active") return { allowed: false, reason: "conversation_closed" };

  if (input.postingMode === "admins_only") {
    const isStaff = input.role === "owner" || input.role === "admin";
    return isStaff
      ? { allowed: true, reason: "allowed" }
      : { allowed: false, reason: "posting_restricted" };
  }
  return { allowed: true, reason: "allowed" };
}

// ---------------------------------------------------------------------------
// Group roles (spec §26, §27)
// ---------------------------------------------------------------------------

export function canManageGroup(role: ConversationRole): boolean {
  return role === "owner" || role === "admin";
}

export function canRemoveMembers(role: ConversationRole): boolean {
  return role === "owner" || role === "admin";
}

export function canModerateMessages(role: ConversationRole): boolean {
  return role === "owner" || role === "admin" || role === "moderator";
}

export function canAssignAdmins(role: ConversationRole): boolean {
  return role === "owner";
}

export function canDeleteGroup(role: ConversationRole): boolean {
  return role === "owner";
}

// ---------------------------------------------------------------------------
// Tier limits (spec §28, §45, §70)
// ---------------------------------------------------------------------------

export type MessagingTierLimits = {
  maxPrivateGroups: number;
  maxGroupMembers: number;
  maxVoiceNoteSeconds: number;
  allowVoiceNotes: boolean;
};

export const MESSAGING_TIER_LIMITS: Record<SubscriptionPlan, MessagingTierLimits> = {
  free: { maxPrivateGroups: 3, maxGroupMembers: 15, maxVoiceNoteSeconds: 60, allowVoiceNotes: true },
  buddy_plus: { maxPrivateGroups: 20, maxGroupMembers: 50, maxVoiceNoteSeconds: 300, allowVoiceNotes: true },
  buddy_pro: { maxPrivateGroups: 100, maxGroupMembers: 1000, maxVoiceNoteSeconds: 300, allowVoiceNotes: true }
};

export function messagingLimitsFor(plan: SubscriptionPlan): MessagingTierLimits {
  return MESSAGING_TIER_LIMITS[plan] ?? MESSAGING_TIER_LIMITS.free;
}

export function validateVoiceNoteDuration(seconds: number, plan: SubscriptionPlan): string | null {
  const limits = messagingLimitsFor(plan);
  if (!Number.isFinite(seconds) || seconds < 1) return "That recording is too short.";
  if (seconds > limits.maxVoiceNoteSeconds) {
    return plan === "free"
      ? `Voice notes are up to ${limits.maxVoiceNoteSeconds} seconds on the free plan.`
      : `Voice notes are up to ${limits.maxVoiceNoteSeconds} seconds.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Edit / delete windows (spec §13, §14)
// ---------------------------------------------------------------------------

export const EDIT_WINDOW_MS = 10 * 60 * 1000;
export const DELETE_FOR_EVERYONE_WINDOW_MS = 60 * 60 * 1000;

export function canEditMessage(input: {
  isSender: boolean;
  createdAtMs: number;
  nowMs: number;
  messageType: string;
  deleted: boolean;
}): boolean {
  if (!input.isSender || input.deleted) return false;
  // System messages are server-generated and never user-editable (spec §40).
  if (input.messageType === "system") return false;
  return input.nowMs - input.createdAtMs <= EDIT_WINDOW_MS;
}

export function canDeleteForEveryone(input: {
  isSender: boolean;
  createdAtMs: number;
  nowMs: number;
}): boolean {
  return input.isSender && input.nowMs - input.createdAtMs <= DELETE_FOR_EVERYONE_WINDOW_MS;
}

export const DELETED_MESSAGE_PLACEHOLDER = "This message was deleted.";

// ---------------------------------------------------------------------------
// Read receipts + delivery state (spec §9, §10)
// ---------------------------------------------------------------------------

export type UserFacingMessageState = "sending" | "sent" | "delivered" | "seen" | "failed";

/**
 * What the SENDER may see about a message. Read receipts are mutual by design
 * (spec §10): if either side has them off, the sender sees Delivered at most —
 * and no tier can buy its way past that.
 */
export function senderVisibleState(input: {
  status: "sent" | "delivered" | "read" | "failed";
  senderReceiptsEnabled: boolean;
  recipientReceiptsEnabled: boolean;
}): UserFacingMessageState {
  if (input.status === "failed") return "failed";
  if (input.status === "read") {
    const bothOn = input.senderReceiptsEnabled && input.recipientReceiptsEnabled;
    return bothOn ? "seen" : "delivered";
  }
  return input.status === "delivered" ? "delivered" : "sent";
}

/** Typing indicators expire quickly and never notify (spec §11). */
export const TYPING_INDICATOR_TTL_MS = 5000;

export function shouldShowTypingIndicator(input: {
  lastTypingAtMs: number;
  nowMs: number;
  viewerInConversation: boolean;
  senderTypingEnabled: boolean;
  isBlockedEitherDirection: boolean;
}): boolean {
  if (input.isBlockedEitherDirection) return false;
  if (!input.senderTypingEnabled) return false;
  if (!input.viewerInConversation) return false;
  return input.nowMs - input.lastTypingAtMs <= TYPING_INDICATOR_TTL_MS;
}

// ---------------------------------------------------------------------------
// Presence (spec §12) — coarse only, never an exact last-seen.
// ---------------------------------------------------------------------------

export type PresenceState = "active_now" | "recently_active" | "hidden";

export const PRESENCE_ACTIVE_MS = 2 * 60 * 1000;
export const PRESENCE_RECENT_MS = 30 * 60 * 1000;

export function resolvePresence(input: {
  lastActiveAtMs: number;
  nowMs: number;
  presenceEnabled: boolean;
}): PresenceState {
  if (!input.presenceEnabled) return "hidden";
  const age = input.nowMs - input.lastActiveAtMs;
  if (age <= PRESENCE_ACTIVE_MS) return "active_now";
  if (age <= PRESENCE_RECENT_MS) return "recently_active";
  return "hidden";
}

// ---------------------------------------------------------------------------
// Notification previews (spec §56)
// ---------------------------------------------------------------------------

export type NotificationPreviewMode = "sender_and_message" | "sender_only" | "generic" | "none";

/**
 * Builds the push/lock-screen preview. Defaults are privacy-first: message
 * text never appears unless the user explicitly opted into it (spec §16, §56).
 */
export function buildNotificationPreview(input: {
  mode: NotificationPreviewMode;
  senderName: string;
  messageText: string;
}): { title: string; body: string } | null {
  switch (input.mode) {
    case "none":
      return null;
    case "sender_and_message":
      return { title: input.senderName, body: input.messageText };
    case "sender_only":
      return { title: input.senderName, body: "Sent you a message" };
    case "generic":
    default:
      return { title: "Mad Buddy", body: "New message" };
  }
}

// ---------------------------------------------------------------------------
// Group-add permission (spec §55)
// ---------------------------------------------------------------------------

export type GroupAddPermission = "anyone" | "close_friends" | "ask_me" | "nobody";

export type GroupAddResult = {
  allowed: boolean;
  /** True when the target must accept before joining (spec §25, §55). */
  requiresConsent: boolean;
  reason: "blocked" | "not_muddies" | "target_declines" | "not_close_friend" | "allowed";
};

export function resolveGroupAdd(input: {
  areApprovedMuddies: boolean;
  isBlockedEitherDirection: boolean;
  targetPermission: GroupAddPermission;
  adderIsCloseFriendOfTarget: boolean;
}): GroupAddResult {
  if (input.isBlockedEitherDirection) return { allowed: false, requiresConsent: false, reason: "blocked" };
  if (!input.areApprovedMuddies) return { allowed: false, requiresConsent: false, reason: "not_muddies" };

  switch (input.targetPermission) {
    case "nobody":
      return { allowed: false, requiresConsent: false, reason: "target_declines" };
    case "close_friends":
      return input.adderIsCloseFriendOfTarget
        ? { allowed: true, requiresConsent: false, reason: "allowed" }
        : { allowed: false, requiresConsent: false, reason: "not_close_friend" };
    case "anyone":
      return { allowed: true, requiresConsent: false, reason: "allowed" };
    case "ask_me":
    default:
      // Default: invited, not added — consent required (spec §55).
      return { allowed: true, requiresConsent: true, reason: "allowed" };
  }
}

// ---------------------------------------------------------------------------
// Quick actions + system messages (spec §39, §40)
// ---------------------------------------------------------------------------

export const QUICK_ACTIONS: Array<{ id: string; label: string }> = [
  { id: "on_my_way", label: "I'm on my way" },
  { id: "im_here", label: "I'm here" },
  { id: "running_late", label: "Running late" },
  { id: "where_to_meet", label: "Where should we meet?" },
  { id: "cant_make_it", label: "I can't make it" },
  { id: "start_without_me", label: "Start without me" }
];

export function quickActionLabel(id: string): string {
  return QUICK_ACTIONS.find((action) => action.id === id)?.label ?? id;
}

export function systemMessageText(event: SystemEventType, detail?: string): string {
  switch (event) {
    case "plan_confirmed":
      return detail ? `Plan confirmed for ${detail}.` : "Plan confirmed.";
    case "plan_time_changed":
      return detail ? `Plan time changed to ${detail}.` : "Plan time changed.";
    case "plan_place_changed":
      return detail ? `Plan place changed to ${detail}.` : "Plan place changed.";
    case "plan_cancelled":
      return "This plan has been cancelled.";
    case "poll_confirmed":
      return detail ? `Poll result confirmed: ${detail}.` : "Poll result confirmed.";
    case "participant_joined":
      return detail ? `${detail} joined.` : "A new participant joined.";
    case "participant_left":
      return detail ? `${detail} left.` : "A participant left.";
    case "conversation_created":
    default:
      return "Conversation started.";
  }
}

// ---------------------------------------------------------------------------
// Plan chat archive (spec §41)
// ---------------------------------------------------------------------------

export const PLAN_CHAT_ARCHIVE_DAYS: Record<SubscriptionPlan, number> = {
  free: 7,
  buddy_plus: 30,
  buddy_pro: 90
};

export function planChatArchivesAtMs(completedAtMs: number, plan: SubscriptionPlan): number {
  const days = PLAN_CHAT_ARCHIVE_DAYS[plan] ?? PLAN_CHAT_ARCHIVE_DAYS.free;
  return completedAtMs + days * 24 * 60 * 60 * 1000;
}
