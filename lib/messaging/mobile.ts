import "server-only";

import { z } from "zod";
import { loadEffectivePlansForUsers } from "@/lib/billing/service";
import { senderVisibleState, validateMessageText, type UserFacingMessageState } from "@/lib/messaging/rules";
import type { AttachmentView } from "@/lib/messaging/attachments";
import type { PreparedVoiceAsset } from "@/lib/messaging/voice-playback";
import { messagePreviewText } from "@/lib/messaging/message-preview";
import {
  canSendMessage,
  getOrCreateDirectConversation,
  loadCommunicationPreferences,
  resolveConversationAccess
} from "@/lib/messaging/service";
import { guardAction } from "@/lib/admin/enforcement";
import { deliverNotification } from "@/lib/notifications/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import type { ConversationRole, QuickActionType, SubscriptionPlan } from "@/lib/supabase/database.types";
import { hasVerifiedAccountStatus, type VerificationRow } from "@/lib/trust/verified-account";
import { isConversationVisible } from "@/lib/messaging/conversation-visibility";
import { planPhase, type PlanPhase } from "@/lib/social/plans";
import type { PlanStatus } from "@/lib/supabase/database.types";

/**
 * Transport-agnostic messaging read/send logic. Takes an already-authenticated
 * `userId`; shared by the web Server Actions (thin wrappers in
 * app/(app)/messaging-actions.ts) and the mobile /api/messages/* routes. Only
 * the v1 subset (open, send, list conversations/messages, messageable friends,
 * mark read) lives here; edit/delete/react/mute stay web-only for now.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type MessagingResult = {
  ok: boolean;
  message: string;
  conversationId?: string;
  messageId?: string;
};

export type ChatMessageView = {
  id: string;
  /** Stable user id — internal only. Never rendered. */
  senderId: string | null;
  senderName: string;
  /**
   * Authorised identity fields, resolved once per page of messages.
   *
   * Deliberately narrow: name, avatar, username and membership tier are what a
   * co-member already sees anywhere else in the product. No email, no phone,
   * no location, no hidden profile fields — those are never selected.
   */
  senderAvatarUrl: string | null;
  senderUsername: string | null;
  senderPlan: SubscriptionPlan | null;
  /**
   * Trusted Member approval, or null.
   *
   * A THIRD signal, kept separate from senderPlan and senderRole: premium is
   * a plan, Owner/Admin is authority in this group, and this is standing
   * across the product. Merging any two would make one imply the others.
   */
  senderTrustedSince: string | null;
  /** Server-authoritative identity verification. Separate from plan and Trusted Member. */
  senderIsVerifiedAccount: boolean;
  /** Deleted, deactivated or otherwise unavailable — never says which. */
  senderUnavailable: boolean;
  /**
   * Who this message names, as ids the SERVER stored.
   *
   * The renderer highlights only these, so text that merely looks like
   * "@someone" stays plain and what is emphasised always matches what was
   * persisted. Display names travel with them purely to locate the token in
   * the text; identity is the id.
   */
  mentions: Array<{ userId: string; displayName: string }>;
  /** Group role, for the subtle Owner/Admin indicator. Null in direct chats. */
  senderRole: ConversationRole | null;
  /**
   * Image attachment with short-lived signed URLs. Never a storage path, and
   * never a permanent public URL.
   */
  attachment: AttachmentView | null;
  /** Trusted, URL-free voice metadata. Playback is authorized lazily by message. */
  voice: PreparedVoiceAsset | null;
  isMine: boolean;
  messageType: string;
  text: string | null;
  quickActionType: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  state: UserFacingMessageState;
  myReaction: string | null;
};

export type ConversationView = {
  id: string;
  title: string;
  avatarUrl: string | null;
  otherUsername: string | null;
  kind: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  muted: boolean;
  pinned: boolean;
  contextBadge: string | null;
  otherPlan: SubscriptionPlan | null;
  /**
   * The other person's Trusted Member approval, or null. Direct chats only —
   * a group has no single "other person", and its senders carry their own.
   */
  otherTrustedSince: string | null;
  /** Server-authoritative identity verification. Separate from plan and Trusted Member. */
  otherIsVerifiedAccount: boolean;
  /**
   * Where this conversation's Plan sits in its own lifecycle, or null when the
   * conversation is not a Plan Chat.
   *
   * The PHASE, not the timestamps. Sending start/end times would let the
   * client re-derive time with its own thresholds, which is how two answers to
   * one question start existing; sending the resolved phase means the server's
   * planPhase() is the only clock that matters. Null for direct chats, Circles
   * and Events, so nothing else can be mistaken for a Plan.
   */
  planPhase: PlanPhase | null;
};

export type MessageableFriend = {
  friendId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  plan: SubscriptionPlan;
};

const uuidSchema = z.string().uuid();

export const sendMessageSchema = z.object({
  conversationId: uuidSchema,
  text: z.string().optional(),
  quickActionType: z
    .enum(["on_my_way", "im_here", "running_late", "where_to_meet", "cant_make_it", "start_without_me"])
    .optional(),
  replyToMessageId: uuidSchema.optional(),
  /**
   * Canonical image attachment. Optional, so every existing caller is
   * unchanged; present, so every conversation type gains attachments at once
   * rather than each surface growing its own send path.
   */
  mediaId: uuidSchema.optional(),
  /**
   * Users the sender chose to mention, as ids.
   *
   * The client's picker is a convenience, NEVER an authorization: every id
   * here is re-checked server-side against current joined membership of this
   * exact conversation before a single row is written. A forged id, a removed
   * member or somebody from another Circle is silently dropped rather than
   * failing the send -- the message is what the person wanted to say, and one
   * bad id should not swallow it.
   */
  mentionUserIds: z.array(uuidSchema).max(20).optional(),
  clientMessageId: z.string().min(1).max(64)
});

function serviceRoleEnvMessage(): string | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return "This action needs the server database configuration.";
  }
  return null;
}

function hasServiceRoleEnv(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

function eligibilityMessage(reason: string): string {
  switch (reason) {
    case "blocked":
    case "not_muddies":
      // Deliberately identical: never disclose that you were blocked.
      return "You can't message this person.";
    case "recipient_accepts_nobody":
    case "not_close_friend":
    case "not_in_circle":
      return "They're not accepting messages right now.";
    case "suspended":
      return "This account isn't available.";
    default:
      return "You can't message this person.";
  }
}

export async function openDirectConversation(userId: string, recipientId: string): Promise<MessagingResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };
  if (!uuidSchema.safeParse(recipientId).success) return { ok: false, message: "Muddy not found." };

  const rateLimit = await consumeRateLimit({ action: "conversations.create", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const result = await getOrCreateDirectConversation(admin, userId, recipientId);
  if (!result.conversationId) {
    return { ok: false, message: eligibilityMessage(result.error ?? "") };
  }

  /* Deliberately opening a conversation you hid un-hides it.
   *
   * Choosing that person from New Message is an unambiguous statement that you
   * want this chat back, so waiting for the reappearance rule (a newer user
   * message) would leave you typing into a conversation still missing from
   * your own inbox.
   *
   * Idempotency is untouched: getOrCreateDirectConversation resolves the
   * canonical row by direct_key, so this clears the flag on the EXISTING
   * conversation and can never produce a second one. Scoped to this member's
   * row, so the other participant's hidden state is their own business. */
  await admin
    .from("conversation_members")
    .update({ hidden_at: null, updated_at: new Date().toISOString() })
    .eq("conversation_id", result.conversationId)
    .eq("user_id", userId)
    .not("hidden_at", "is", null);

  return { ok: true, message: "Conversation ready.", conversationId: result.conversationId };
}

export async function sendMessage(userId: string, input: unknown): Promise<MessagingResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };

  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check your message and try again." };

  const isQuickAction = Boolean(parsed.data.quickActionType);
  const hasAttachment = Boolean(parsed.data.mediaId);
  if (isQuickAction && hasAttachment) return { ok: false, message: "Choose one message type." };
  // A photo with no caption is a complete message, so the text requirement is
  // relaxed when an attachment carries the content. A caption that IS present
  // is still validated.
  if (!isQuickAction && !hasAttachment) {
    const textError = validateMessageText(parsed.data.text ?? "");
    if (textError) return { ok: false, message: textError };
  } else if (!isQuickAction && (parsed.data.text ?? "").trim().length > 0) {
    const textError = validateMessageText(parsed.data.text ?? "");
    if (textError) return { ok: false, message: textError };
  }

  const rateLimit = await consumeRateLimit({ action: "messages.send", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();

  const guard = await guardAction(admin, { userId, surface: "messaging", control: "messaging" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  const permission = await canSendMessage(admin, userId, parsed.data.conversationId);
  if (!permission.allowed) {
    return {
      ok: false,
      message:
        permission.reason === "posting_restricted"
          ? "Only admins can post here."
          : permission.reason === "conversation_closed"
            ? "This conversation is closed."
            : eligibilityMessage(permission.reason)
    };
  }

  // Resolve a lost-response retry before attachment reuse validation. The
  // canonical sender/client id pair is immutable, so the same retry returns
  // the original message and never uploads or inserts again.
  const { data: existing } = await admin
    .from("messages")
    .select("id, conversation_id, media_id")
    .eq("sender_id", userId)
    .eq("client_message_id", parsed.data.clientMessageId)
    .maybeSingle();
  if (existing) {
    return existing.conversation_id === parsed.data.conversationId && existing.media_id === (parsed.data.mediaId ?? null)
      ? { ok: true, message: "Sent.", messageId: existing.id }
      : { ok: false, message: "That message retry is no longer valid." };
  }

  // The asset must belong to the sender and be canonical READY chat media. Checked
  // AFTER conversation permission, so an unauthorised sender never learns
  // whether a media id exists.
  const media = parsed.data.mediaId
    ? await (await import("@/lib/messaging/voice-message-service")).resolveSendableMessageMedia(
        admin, userId, parsed.data.conversationId, parsed.data.mediaId
      )
    : null;
  if (parsed.data.mediaId && !media) return { ok: false, message: "That attachment isn't available to send." };
  if (media?.kind === "voice_note" && (parsed.data.text ?? "").trim()) {
    return { ok: false, message: "Send the voice message and text separately." };
  }
  const messageType = isQuickAction ? "quick_action" : media?.kind ?? "text";

  const { data: message, error } = await admin
    .from("messages")
    .insert({
      conversation_id: parsed.data.conversationId,
      sender_id: userId,
      message_type: messageType,
      media_id: parsed.data.mediaId ?? null,
      text_content: media?.kind === "voice_note" ? null : parsed.data.text?.trim() || null,
      quick_action_type: (parsed.data.quickActionType ?? null) as QuickActionType | null,
      reply_to_message_id: parsed.data.replyToMessageId ?? null,
      client_message_id: parsed.data.clientMessageId,
      duration_seconds: media?.kind === "voice_note" ? media.durationSeconds : null,
      waveform_data: media?.kind === "voice_note" ? media.waveform : null,
      status: "sent"
    })
    .select("id")
    .single();

  // A duplicate send collides on (sender_id, client_message_id), return the
  // existing message rather than erroring or double-posting.
  if (error || !message) {
    const { data: duplicate } = await admin
      .from("messages")
      .select("id")
      .eq("sender_id", userId)
      .eq("client_message_id", parsed.data.clientMessageId)
      .maybeSingle();
    if (duplicate) return { ok: true, message: "Sent.", messageId: duplicate.id };
    return { ok: false, message: "Couldn't send that message." };
  }

  await admin
    .from("conversations")
    .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", parsed.data.conversationId);

  /* Speaking in a chat you hid brings it back for you.
   *
   * The reappearance rule (last_user_message_at > hidden_at) already covers
   * the RECIPIENTS of this message. It does not cover the sender, whose
   * hidden_at is newer than every message that existed when they hid it --
   * without this, you could message someone and still not see the
   * conversation in your own inbox. Scoped to the sender's row only. */
  await admin
    .from("conversation_members")
    .update({ hidden_at: null, updated_at: new Date().toISOString() })
    .eq("conversation_id", parsed.data.conversationId)
    .eq("user_id", userId)
    .not("hidden_at", "is", null);

  /* Mentions are stored only now, against a message that definitely exists,
   * so a failed send can never leave orphan rows. persistMentions re-checks
   * every id against current joined membership and returns the ones it kept,
   * which is exactly the set the notification step marks -- one source of
   * truth for "who was mentioned". */
  const mentionedUserIds = await persistMentions(
    admin,
    parsed.data.conversationId,
    message.id,
    userId,
    parsed.data.mentionUserIds ?? []
  );

  await notifyOtherMembers(
    admin,
    parsed.data.conversationId,
    userId,
    messagePreviewText(messageType, parsed.data.text) ?? "",
    mentionedUserIds
  );
  return { ok: true, message: "Sent.", messageId: message.id };
}

/**
 * Persist mentions for a message that already exists, keeping only real ones.
 *
 * AUTHORIZATION LIVES HERE, not in the composer. Each id must belong to a
 * CURRENTLY JOINED member of this conversation, which in one check covers a
 * forged id, someone removed since the picker rendered, an invited-but-not-
 * joined member, and anyone from a different Circle entirely.
 *
 * Returns the ids actually stored so the notification step can address exactly
 * those people -- there is no second source deciding who was mentioned.
 *
 * Called only AFTER the message row is confirmed, so a failed send cannot
 * leave orphan mentions; the cascade on message_id removes them if the message
 * is later deleted.
 */
export async function persistMentions(
  admin: Admin,
  conversationId: string,
  messageId: string,
  senderId: string,
  requestedUserIds: readonly string[]
): Promise<string[]> {
  // Never the sender: mentioning yourself is fine in a sentence and must not
  // notify you, so the row is not worth storing.
  const unique = [...new Set(requestedUserIds)].filter((id) => id !== senderId);
  if (unique.length === 0) return [];

  const { data: eligible } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .eq("status", "joined")
    .in("user_id", unique);

  const allowed = (eligible ?? []).map((row) => row.user_id);
  if (allowed.length === 0) return [];

  const { error } = await admin
    .from("message_mentions")
    .upsert(
      allowed.map((userId) => ({ message_id: messageId, mentioned_user_id: userId })),
      { onConflict: "message_id,mentioned_user_id", ignoreDuplicates: true }
    );
  // A mention that fails to store must not fail the message: the thing the
  // person said is worth more than the highlight on a name.
  if (error) return [];
  return allowed;
}

/** Notifies members, honoring each recipient's preview privacy. */
async function notifyOtherMembers(
  admin: Admin,
  conversationId: string,
  senderId: string,
  text: string,
  /**
   * Who this message mentions, already validated and stored.
   *
   * ONE NOTIFICATION, NOT TWO. Every joined member already receives exactly
   * one notification for a message, so a separate "you were mentioned" push
   * would mean two buzzes for one sentence. A mention therefore changes the
   * TITLE of the notification that was going out anyway -- more prominent,
   * still singular. Dedupe is inherent: this is a set, and each recipient is
   * visited once.
   */
  mentionedUserIds: readonly string[] = []
) {
  const nowIso = new Date().toISOString();
  const [{ data: members }, { data: conversation }] = await Promise.all([
    admin
      .from("conversation_members")
      .select("user_id, muted_until")
      .eq("conversation_id", conversationId)
      .eq("status", "joined")
      .neq("user_id", senderId),
    // The conversation type decides where the notification LANDS. A group
    // message routed as `message:` opened the direct-message inbox instead of
    // the group thread — the notification arrived, and the tap went to the
    // wrong screen.
    admin
      .from("conversations")
      .select("conversation_type")
      .eq("id", conversationId)
      .maybeSingle()
  ]);
  const isGroup = conversation?.conversation_type === "group";
  // Group name, so the notification reads "Ama · Weekend Crew" rather than
  // leaving the recipient to guess which group it came from.
  const { data: groupSettings } = isGroup
    ? await admin.from("group_settings").select("name").eq("conversation_id", conversationId).maybeSingle()
    : { data: null };

  const recipients = (members ?? []).filter((member) => !member.muted_until || member.muted_until < nowIso);
  if (recipients.length === 0) return;

  const { data: senderProfile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("user_id", senderId)
    .maybeSingle();
  const senderName = senderProfile?.full_name?.trim() || "A Muddy";

  await Promise.all(
    recipients.map(async (member) => {
      const prefs = await loadCommunicationPreferences(admin, member.user_id);
      const { buildNotificationPreview } = await import("@/lib/messaging/rules");
      const preview = buildNotificationPreview({
        mode: prefs.notificationPreview,
        senderName,
        messageText: text
      });
      if (!preview) return;
      await deliverNotification(admin, {
        userId: member.user_id,
        senderId,
        priority: "high",
        // `group:<id>` resolves to /groups/<id> — the exact thread. The
        // resolver already supported this; nothing was emitting it.
        type: isGroup ? `group:${conversationId}` : `message:${conversationId}`,
        // The group name is context, never content: it is appended to the
        // TITLE, so a recipient whose preview preference hides message text
        // still sees who and where, and never what.
        //
        // A mention marks that same title rather than sending a second
        // notification. It says only that they were named -- no extra content
        // leaks past their preview preference, because the body is still
        // whatever buildNotificationPreview allowed.
        title: mentionedUserIds.includes(member.user_id)
          ? isGroup && groupSettings?.name
            ? `${preview.title} mentioned you · ${groupSettings.name}`
            : `${preview.title} mentioned you`
          : isGroup && groupSettings?.name
            ? `${preview.title} · ${groupSettings.name}`
            : preview.title,
        message: preview.body
      });
    })
  );
}

export async function listMessageableFriends(userId: string): Promise<MessageableFriend[]> {
  if (!hasServiceRoleEnv()) return [];

  const admin = createSupabaseAdminClient();
  const [{ data: friendships }, { data: blocks }] = await Promise.all([
    admin
      .from("friendships")
      .select("user_one_id, user_two_id")
      // Active friendships only: ended_at IS NULL is the canonical definition of "currently Muddies".
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`).is("ended_at", null),
    admin
      .from("blocked_users")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)
  ]);

  const blockedIds = new Set(
    (blocks ?? []).flatMap((row) => [row.blocker_id, row.blocked_id]).filter((id) => id !== userId)
  );
  const friendIds = (friendships ?? [])
    .map((row) => (row.user_one_id === userId ? row.user_two_id : row.user_one_id))
    .filter((id) => !blockedIds.has(id));
  if (friendIds.length === 0) return [];

  const [{ data: profiles }, plans] = await Promise.all([
    admin
      .from("profiles")
      .select("user_id, full_name, username, avatar_url")
      .in("user_id", friendIds),
    loadEffectivePlansForUsers(admin, friendIds)
  ]);

  return (profiles ?? [])
    .map((profile) => ({
      friendId: profile.user_id,
      displayName: profile.full_name,
      username: profile.username,
      avatarUrl: profile.avatar_url,
      plan: plans.get(profile.user_id) ?? "free"
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Total unread messages across every conversation, for the app badge.
 *
 * Reads the SAME conversation_previews RPC that listConversations uses, so the
 * badge and the inbox can never disagree about what is unread. It deliberately
 * does not build the full conversation views -- the badge needs one number,
 * not every title, avatar, plan and verification state.
 */
export async function getUnreadMessageCount(userId: string): Promise<number> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return 0;

  const admin = createSupabaseAdminClient();

  const { data: memberships } = await admin
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId)
    // JOINED, not merely "has not left".
    //
    // `left_at IS NULL` and `status = 'joined'` are not the same question.
    // status has five values and left_at is stamped on only some of them, so an
    // 'invited' member -- someone asked into a Circle who has not accepted --
    // has a null left_at and was counted here, while listConversations (which
    // filters on status) correctly refused to show them that Circle.
    //
    // The result was a badge no action could clear: production held one Circle
    // with six messages and four accounts invited to it, each showing "6" over
    // an empty inbox. Measured across every account, this predicate corrects
    // four of them and changes no one else's count.
    //
    // This RESTORES the original predicate. bc50e6f ("Restore build and type
    // safety") rewrote this function while repairing an unrelated broken merge
    // and swapped status='joined' for left_at IS NULL in the process; every
    // other read of this table still filters on status, and notifyOtherMembers
    // only notifies status='joined', so an invitee already receives no
    // notification for the very messages this was counting.
    .eq("status", "joined");

  const conversationIds = (memberships ?? []).map((row) => row.conversation_id);
  if (conversationIds.length === 0) return 0;

  const { data: previews } = await admin.rpc("conversation_previews", {
    p_user_id: userId,
    p_conversation_ids: conversationIds
  });

  return (previews ?? []).reduce((total, row) => total + (row.unread_count ?? 0), 0);
}

export async function listConversations(userId: string): Promise<ConversationView[]> {
  if (!hasServiceRoleEnv()) return [];

  const admin = createSupabaseAdminClient();
  const { data: memberships } = await admin
    .from("conversation_members")
    .select("conversation_id, muted_until, last_read_message_id, hidden_at")
    .eq("user_id", userId)
    .eq("status", "joined");

  const conversationIds = (memberships ?? []).map((row) => row.conversation_id);
  if (conversationIds.length === 0) return [];

  const { data: conversations } = await admin
    .from("conversations")
    .select("id, conversation_type, context_type, context_id, direct_key, last_message_at, status")
    .in("id", conversationIds)
    .neq("status", "deleted")
    .order("last_message_at", { ascending: false, nullsFirst: false });

  const membershipById = new Map((memberships ?? []).map((row) => [row.conversation_id, row]));

  // Batched, not per-conversation: one .in() for direct-chat other-user
  // profiles, one .in() for group/plan/event conversation names, one RPC for
  // every conversation's last message + unread count in a single round trip
  // (see conversation_previews in supabase/migrations). Previously this loop
  // issued up to 4 sequential queries PER conversation.
  const directConversations = (conversations ?? []).filter(
    (conversation) => conversation.conversation_type === "direct" && conversation.direct_key
  );
  const otherIdByConversation = new Map<string, string>();
  for (const conversation of directConversations) {
    const otherId = conversation.direct_key!.split(":").find((id) => id !== userId);
    if (otherId) otherIdByConversation.set(conversation.id, otherId);
  }
  const otherIds = [...new Set(otherIdByConversation.values())];
  const groupConversationIds = (conversations ?? [])
    .filter((conversation) => conversation.conversation_type !== "direct")
    .map((conversation) => conversation.id);

  /* Plan Chats, and only Plan Chats.
   *
   * Keyed on context_type === "plan", which is the STORED authority for what a
   * conversation is about -- not a guess from whether some date happens to be
   * nearby. An Event, a Circle or a direct chat can never be mistaken for a
   * Plan here, however many timestamps they carry.
   *
   * One batched .in() for the whole page, matching how profiles, group names
   * and previews are already fetched. No per-row query, and nothing at all
   * when the inbox contains no Plan Chats. */
  const planContextIds = [
    ...new Set(
      (conversations ?? [])
        .filter((conversation) => conversation.context_type === "plan" && conversation.context_id)
        .map((conversation) => conversation.context_id as string)
    )
  ];

  const [
    { data: pins },
    { data: otherProfiles },
    { data: verifications },
    { data: groupSettings },
    { data: previews },
    plans,
    { data: planTimings }
  ] = await Promise.all([
    admin.from("conversation_pins").select("conversation_id").eq("user_id", userId).in("conversation_id", conversationIds),
    otherIds.length > 0
      ? admin.from("profiles").select("user_id, full_name, username, avatar_url, trusted_member_since").in("user_id", otherIds)
      : Promise.resolve({ data: [] }),
    // Verification state for the DM partners, in the SAME batch as their
    // profiles. One query for the page, never one per conversation row.
    otherIds.length > 0
      ? admin.from("account_verifications").select("user_id, status").in("user_id", otherIds)
      : Promise.resolve({ data: [] }),
    groupConversationIds.length > 0
      ? admin.from("group_settings").select("conversation_id, name").in("conversation_id", groupConversationIds)
      : Promise.resolve({ data: [] }),
    admin.rpc("conversation_previews", { p_user_id: userId, p_conversation_ids: conversationIds }),
    loadEffectivePlansForUsers(admin, otherIds),
    // Timing for Plan Chats only. Enough to answer "is this plan on right
    // now" and nothing more -- no title, no place, no participants.
    planContextIds.length > 0
      ? admin.from("plans").select("id, status, start_at, end_at").in("id", planContextIds)
      : Promise.resolve({ data: [] })
  ]);

  const pinnedIds = new Set((pins ?? []).map((row) => row.conversation_id));
  const profileByUserId = new Map((otherProfiles ?? []).map((profile) => [profile.user_id, profile]));
  // Grouped per user: a person may hold more than one verification row, and
  // hasVerifiedAccountStatus decides which states count as verified.
  const verificationByUserId = new Map<string, VerificationRow[]>();
  for (const row of verifications ?? []) {
    const existing = verificationByUserId.get(row.user_id) ?? [];
    existing.push(row as VerificationRow);
    verificationByUserId.set(row.user_id, existing);
  }
  const groupNameByConversation = new Map((groupSettings ?? []).map((row) => [row.conversation_id, row.name]));
  const previewByConversation = new Map((previews ?? []).map((row) => [row.conversation_id, row]));
  // Resolved ONCE per page against one clock, so every Plan Chat in this
  // response is judged at the same instant.
  const planNowMs = Date.now();
  const planPhaseByPlanId = new Map(
    (planTimings ?? []).map((plan) => [
      plan.id,
      planPhase(
        { status: plan.status as PlanStatus, startAt: plan.start_at, endAt: plan.end_at },
        planNowMs
      )
    ])
  );
  const nowIso = new Date().toISOString();
  const views: ConversationView[] = [];

  for (const conversation of conversations ?? []) {
    let title = "Conversation";
    let otherUsername: string | null = null;
    let avatarUrl: string | null = null;
    if (conversation.conversation_type === "direct" && conversation.direct_key) {
      const otherId = otherIdByConversation.get(conversation.id);
      const profile = otherId ? profileByUserId.get(otherId) : undefined;
      title = profile?.full_name?.trim() || "A Muddy";
      otherUsername = profile?.username ?? null;
      avatarUrl = profile?.avatar_url ?? null;
    } else {
      title =
        groupNameByConversation.get(conversation.id) ??
        (conversation.conversation_type === "plan" ? "Plan chat" : "Group");
    }

    const membership = membershipById.get(conversation.id);
    const preview = previewByConversation.get(conversation.id);

    /* Hidden by this member, and nobody has spoken since.
     *
     * Decided per member and per request, never stored on the conversation, so
     * the other participant's inbox is unaffected. A system event cannot lift
     * this: last_user_message_at counts non-system messages only. */
    if (
      !isConversationVisible({
        hiddenAt: membership?.hidden_at ?? null,
        lastUserMessageAt: preview?.last_user_message_at ?? null
      })
    ) {
      continue;
    }

    views.push({
      id: conversation.id,
      title,
      avatarUrl,
      otherUsername,
      kind: conversation.conversation_type,
      lastMessagePreview: preview ? messagePreviewText(preview.last_message_type, preview.last_text) : null,
      lastMessageAt: conversation.last_message_at,
      unreadCount: preview?.unread_count ?? 0,
      muted: Boolean(membership?.muted_until && membership.muted_until > nowIso),
      pinned: pinnedIds.has(conversation.id),
      contextBadge:
        conversation.context_type === "plan"
          ? "Plan"
          : conversation.context_type === "event" || conversation.context_type === "event_circle"
            ? "Event"
            : conversation.context_type === "safe_arrival"
              ? "Safe Arrival"
              : null,
      otherPlan:
        conversation.conversation_type === "direct"
          ? plans.get(otherIdByConversation.get(conversation.id) ?? "") ?? "free"
          : null,
      otherTrustedSince:
        conversation.conversation_type === "direct"
          ? profileByUserId.get(otherIdByConversation.get(conversation.id) ?? "")?.trusted_member_since ?? null
          : null,
      otherIsVerifiedAccount:
        conversation.conversation_type === "direct"
          ? hasVerifiedAccountStatus(verificationByUserId.get(otherIdByConversation.get(conversation.id) ?? "") ?? [])
          : false,
      // Null unless this conversation is genuinely a Plan Chat, so no other
      // conversation type can inherit a Plan's coordination affordances.
      planPhase:
        conversation.context_type === "plan" && conversation.context_id
          ? planPhaseByPlanId.get(conversation.context_id) ?? null
          : null
    });
  }

  return views;
}

export async function listMessages(userId: string, conversationId: string): Promise<ChatMessageView[]> {
  if (!hasServiceRoleEnv()) return [];
  if (!uuidSchema.safeParse(conversationId).success) return [];

  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, userId, conversationId);
  if (!access.canView) return []; // Never serve a guessed conversation id.

  // Descending + limit, then reverse: this window must be the most RECENT
  // 200 messages. Ascending + limit was returning the oldest 200 after the
  // visibility cutoff instead — once an active conversation passed 200
  // total messages, every message sent after that point silently stopped
  // appearing here, forever, because the same oldest slice kept winning.
  const { data: messages } = await admin
    .from("messages")
    .select("id, sender_id, message_type, text_content, quick_action_type, media_id, status, created_at, edited_at, deleted_at")
    .eq("conversation_id", conversationId)
    .gte("created_at", access.historyVisibleFrom ?? new Date(0).toISOString())
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (messages ?? []).reverse();
  if (rows.length === 0) return [];

  const [{ data: hides }, { data: reactions }, { data: mentionRows }] = await Promise.all([
    admin.from("message_hides").select("message_id").eq("user_id", userId),
    admin.from("message_reactions").select("message_id, reaction_type").eq("user_id", userId),
    // One query for every mention on the page, matching how hides and
    // reactions are already fetched. Never one per message.
    admin
      .from("message_mentions")
      .select("message_id, mentioned_user_id")
      .in("message_id", rows.map((row) => row.id))
  ]);
  const hiddenIds = new Set((hides ?? []).map((row) => row.message_id));
  const myReactions = new Map((reactions ?? []).map((row) => [row.message_id, row.reaction_type]));

  /**
   * The authorised sender projection.
   *
   * ONE query for every distinct sender in the page, plus one batched plan
   * lookup — never per message, and never per render. A group thread of 200
   * messages from 8 people costs two queries, not 200.
   *
   * Only fields a co-member is already entitled to see are selected:
   * display name, avatar, username. Email, phone, location and every other
   * profile column are not read here at all, so they cannot leak into a
   * message list by accident.
   */
  const senderIds = [...new Set(rows.map((row) => row.sender_id).filter((id): id is string => Boolean(id)))];
  const senderById = new Map<
    string,
    { name: string; avatarUrl: string | null; username: string | null; trustedSince: string | null; isVerifiedAccount: boolean }
  >();
  let plansBySender = new Map<string, SubscriptionPlan>();
  // Group role per sender, for the subtle Owner/Admin indicator. Batched with
  // the profile read, so it costs one more query per PAGE, never per message.
  const roleBySender = new Map<string, ConversationRole>();
  if (senderIds.length > 0) {
    const [{ data: profiles }, plans, { data: roleRows }, { data: verificationRows }] = await Promise.all([
      admin
        .from("profiles")
        .select("user_id, full_name, avatar_url, username, trusted_member_since")
        .in("user_id", senderIds),
      loadEffectivePlansForUsers(admin, senderIds),
      admin
        .from("conversation_members")
        .select("user_id, role")
        .eq("conversation_id", conversationId)
        .in("user_id", senderIds),
      admin
        .from("account_verifications")
        .select("user_id, status")
        .in("user_id", senderIds)
    ]);
    for (const row of roleRows ?? []) roleBySender.set(row.user_id, row.role);
    const verificationBySenderId = new Map<string, boolean>();
    for (const row of verificationRows ?? []) {
      const current = verificationBySenderId.get(row.user_id) ?? false;
      verificationBySenderId.set(row.user_id, current || row.status === "verified");
    }
    for (const profile of profiles ?? []) {
      senderById.set(profile.user_id, {
        name: profile.full_name?.trim() || "A Muddy",
        avatarUrl: profile.avatar_url ?? null,
        username: profile.username ?? null,
        trustedSince: profile.trusted_member_since ?? null,
        isVerifiedAccount: verificationBySenderId.get(profile.user_id) ?? false
      });
    }
    plansBySender = plans;
  }

  /* Names for everyone mentioned on this page.
   *
   * A mentioned person is not necessarily a SENDER here -- being named in
   * somebody else's message is the common case -- so their display names come
   * from their own batched lookup rather than the sender projection. Only
   * full_name is read: enough to locate "@Ama" in the text and nothing more.
   *
   * The name is presentation. If it has changed since the message was sent the
   * token may no longer match, and that mention simply renders as ordinary
   * text -- the stored id, and therefore who was notified, is unaffected. */
  const mentionedIds = [...new Set((mentionRows ?? []).map((row) => row.mentioned_user_id))];
  const mentionNameById = new Map<string, string>();
  if (mentionedIds.length > 0) {
    const { data: mentionProfiles } = await admin
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", mentionedIds);
    for (const profile of mentionProfiles ?? []) {
      const name = profile.full_name?.trim();
      if (name) mentionNameById.set(profile.user_id, name);
    }
  }
  const mentionsByMessage = new Map<string, Array<{ userId: string; displayName: string }>>();
  for (const row of mentionRows ?? []) {
    const displayName = mentionNameById.get(row.mentioned_user_id);
    if (!displayName) continue;
    const list = mentionsByMessage.get(row.message_id) ?? [];
    list.push({ userId: row.mentioned_user_id, displayName });
    mentionsByMessage.set(row.message_id, list);
  }

  // Attachments, signed ONCE for the whole page and deduped by media id.
  // Signing per message (or worse, per render) would mint dozens of storage
  // URLs for one thread and change their identity on every pass, defeating
  // browser caching entirely.
  const { signAttachmentsForMessages } = await import("@/lib/messaging/attachments");
  const attachmentsById = await signAttachmentsForMessages(
    admin,
    userId,
    conversationId,
    rows.map((row) => row.id)
  );
  const { projectVoiceMessages } = await import("@/lib/messaging/voice-message-service");
  const voicesByMessageId = await projectVoiceMessages(admin, userId, conversationId, rows.map((row) => row.id));

  const myPrefs = await loadCommunicationPreferences(admin, userId);

  return rows
    .filter((row) => !hiddenIds.has(row.id))
    .map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      senderName: row.sender_id === userId ? "You" : senderById.get(row.sender_id ?? "")?.name ?? "Mad Buddy",
      senderAvatarUrl: row.sender_id ? senderById.get(row.sender_id)?.avatarUrl ?? null : null,
      senderUsername: row.sender_id ? senderById.get(row.sender_id)?.username ?? null : null,
      senderPlan: row.sender_id ? plansBySender.get(row.sender_id) ?? null : null,
      senderTrustedSince: row.sender_id ? senderById.get(row.sender_id)?.trustedSince ?? null : null,
      senderIsVerifiedAccount: row.sender_id ? senderById.get(row.sender_id)?.isVerifiedAccount ?? false : false,
      /* A tombstoned message mentions nobody.
       *
       * Deleting sets deleted_at and nulls text_content but KEEPS the row, so
       * the mention rows survive by design (the cascade only fires on a real
       * delete, which never happens here). Serving them anyway would leave a
       * message that says nothing still naming someone -- and any surface that
       * later counts "messages mentioning me" would count a deleted one.
       * Dropped at the projection so no consumer has to remember this. */
      mentions: row.deleted_at ? [] : mentionsByMessage.get(row.id) ?? [],
      /**
       * ONE fallback for every "we cannot show this person" case.
       *
       * A sender id with no profile row means deleted, deactivated,
       * moderated, or otherwise unavailable — and this deliberately does not
       * distinguish between them. Telling the viewer which one it was would
       * leak exactly what the privacy rules exist to withhold: whether they
       * were blocked, whether the account was actioned, whether membership
       * was revoked. Absence is the whole message.
       */
      senderUnavailable: Boolean(row.sender_id) && !senderById.has(row.sender_id!),
      /**
       * Owner/Admin only. "Member" is deliberately absent: labelling the
       * ordinary case on every message is noise, and the indicator only earns
       * its place when it says something the reader would not assume.
       */
      senderRole: row.sender_id ? roleBySender.get(row.sender_id) ?? null : null,
      // Null for a deleted message, so a tombstone never renders its photo.
      attachment: row.deleted_at ? null : attachmentsById.get(row.media_id ?? "") ?? null,
      voice: row.deleted_at ? null : voicesByMessageId.get(row.id) ?? null,
      isMine: row.sender_id === userId,
      messageType: row.message_type,
      text: row.deleted_at ? null : row.text_content,
      quickActionType: row.quick_action_type,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      deleted: Boolean(row.deleted_at),
      state: senderVisibleState({
        status: row.status === "read" ? "read" : row.status === "delivered" ? "delivered" : "sent",
        senderReceiptsEnabled: myPrefs.readReceiptsEnabled,
        recipientReceiptsEnabled: true
      }),
      myReaction: myReactions.get(row.id) ?? null
    }));
}

export async function markConversationRead(userId: string, conversationId: string): Promise<MessagingResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };
  if (!uuidSchema.safeParse(conversationId).success) return { ok: false, message: "Not found." };

  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, userId, conversationId);
  if (!access.canView) return { ok: false, message: "Not found." };

  const { data: latest } = await admin
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return { ok: true, message: "Up to date." };

  await admin
    .from("conversation_members")
    .update({ last_read_message_id: latest.id, updated_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);

  const prefs = await loadCommunicationPreferences(admin, userId);
  if (prefs.readReceiptsEnabled) {
    await admin
      .from("messages")
      .update({ status: "read" })
      .eq("conversation_id", conversationId)
      .neq("sender_id", userId)
      .in("status", ["sent", "delivered"]);
  }

  return { ok: true, message: "Marked read." };
}

/**
 * Pins or unpins a conversation for a user. A pin is a private cosmetic
 * preference; the user must be a joined member of the conversation (checked
 * here under the service role) before any row is written.
 */
export async function setConversationPinned(
  userId: string,
  conversationId: string,
  pinned: boolean
): Promise<MessagingResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };
  if (!uuidSchema.safeParse(conversationId).success) return { ok: false, message: "Not found." };

  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, userId, conversationId);
  if (!access.canView) return { ok: false, message: "Not found." };

  if (pinned) {
    const { error } = await admin
      .from("conversation_pins")
      .upsert({ user_id: userId, conversation_id: conversationId }, { onConflict: "user_id,conversation_id" });
    if (error) return { ok: false, message: "Could not pin this chat. Try again." };
    return { ok: true, message: "Pinned." };
  }

  const { error } = await admin
    .from("conversation_pins")
    .delete()
    .eq("user_id", userId)
    .eq("conversation_id", conversationId);
  if (error) return { ok: false, message: "Could not unpin this chat. Try again." };
  return { ok: true, message: "Unpinned." };
}

/**
 * Hide a conversation from THIS member's inbox, or restore it.
 *
 * Scoped to one membership row by construction: the update is keyed on both
 * the conversation and this user, so it cannot reach the other participant's
 * row. Nothing is deleted -- not the conversation, not a single message, not
 * the membership -- and `status` is untouched, so hiding is not leaving and a
 * Circle's roster is unaffected.
 *
 * The conversation returns on its own when somebody sends a real message
 * (see isConversationVisible); this action exists for hiding, and for undoing
 * a hide immediately if it was a mistake.
 */
export async function setConversationHidden(
  userId: string,
  conversationId: string,
  hidden: boolean
): Promise<MessagingResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };
  if (!uuidSchema.safeParse(conversationId).success) return { ok: false, message: "Not found." };

  const admin = createSupabaseAdminClient();
  // Same guard every other per-member action uses: someone who cannot view the
  // conversation cannot change their membership of it either.
  const access = await resolveConversationAccess(admin, userId, conversationId);
  if (!access.canView) return { ok: false, message: "Not found." };

  const { error } = await admin
    .from("conversation_members")
    .update({ hidden_at: hidden ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);

  if (error) {
    return {
      ok: false,
      message: hidden ? "Could not hide this chat. Try again." : "Could not restore this chat. Try again."
    };
  }
  // "Hidden", not "Deleted": the copy has to match what actually happened, or
  // someone will expect the other person to have lost the conversation too.
  return { ok: true, message: hidden ? "Chat hidden." : "Chat restored." };
}
