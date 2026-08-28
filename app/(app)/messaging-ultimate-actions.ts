"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_CONVERSATION_USER_PREFERENCES,
  type ChatCapabilityRule,
  type ChatPollView,
  type ConversationChatSettingsView,
  type ConversationPresencePerson,
  type ConversationUserPreferencesView,
  type UltimateConversationState
} from "@/lib/messaging/ultimate-types";
import {
  canSendMessage,
  loadCommunicationPreferences,
  normalizeCommunicationPreferences,
  resolveConversationAccess
} from "@/lib/messaging/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidSchema = z.string().uuid();
const capabilitySchema = z.enum(["all_members", "admins", "owner", "disabled"]);
const previewSchema = z.enum(["always", "when_unlocked", "never"]);
const mediaModeSchema = z.enum(["keep", "view_once", "24h"]);

function untypedAdmin() {
  // The generated Database type intentionally remains production-main truth
  // until this migration is applied and regenerated. New tables are accessed
  // through the same Supabase client but an untyped view on THIS feature
  // branch so we do not fabricate generated definitions by hand.
  return createSupabaseAdminClient() as unknown as SupabaseClient;
}

async function getAuthedUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

function configured() {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

function actionError(message: string) {
  return { ok: false as const, message };
}

function capabilityAllows(rule: ChatCapabilityRule, role: string | null) {
  if (rule === "disabled") return false;
  if (rule === "all_members") return true;
  if (rule === "owner") return role === "owner";
  return role === "owner" || role === "admin";
}

function mapSettings(row: Record<string, unknown> | null): ConversationChatSettingsView {
  if (!row) return DEFAULT_CHAT_SETTINGS;
  return {
    messageLifetimeSeconds:
      typeof row.message_lifetime_seconds === "number" ? row.message_lifetime_seconds : null,
    defaultMediaMode:
      row.default_media_mode === "view_once" || row.default_media_mode === "24h"
        ? row.default_media_mode
        : "keep",
    whoCanPin: capabilitySchema.safeParse(row.who_can_pin).success
      ? (row.who_can_pin as ChatCapabilityRule)
      : DEFAULT_CHAT_SETTINGS.whoCanPin,
    whoCanCreatePolls: capabilitySchema.safeParse(row.who_can_create_polls).success
      ? (row.who_can_create_polls as ChatCapabilityRule)
      : DEFAULT_CHAT_SETTINGS.whoCanCreatePolls,
    whoCanUseEveryone: capabilitySchema.safeParse(row.who_can_use_everyone).success
      ? (row.who_can_use_everyone as ChatCapabilityRule)
      : DEFAULT_CHAT_SETTINGS.whoCanUseEveryone,
    whoCanAddMembers: capabilitySchema.safeParse(row.who_can_add_members).success
      ? (row.who_can_add_members as ChatCapabilityRule)
      : DEFAULT_CHAT_SETTINGS.whoCanAddMembers,
    whoCanEditInfo:
      row.who_can_edit_info === "owner" ? "owner" : DEFAULT_CHAT_SETTINGS.whoCanEditInfo
  };
}

function mapPreferences(row: Record<string, unknown> | null): ConversationUserPreferencesView {
  if (!row) return DEFAULT_CONVERSATION_USER_PREFERENCES;
  return {
    archivedAt: typeof row.archived_at === "string" ? row.archived_at : null,
    markedUnreadAt: typeof row.marked_unread_at === "string" ? row.marked_unread_at : null,
    favoriteRank: typeof row.favorite_rank === "number" ? row.favorite_rank : null,
    themeKey: typeof row.theme_key === "string" ? row.theme_key : "default",
    notificationPreview:
      row.notification_preview === "always" || row.notification_preview === "never"
        ? row.notification_preview
        : "when_unlocked",
    notifyMentionsWhenMuted: row.notify_mentions_when_muted !== false,
    notifyRepliesWhenMuted: row.notify_replies_when_muted !== false,
    draftText: typeof row.draft_text === "string" ? row.draft_text : null,
    draftUpdatedAt: typeof row.draft_updated_at === "string" ? row.draft_updated_at : null,
    readingAnchorMessageId:
      typeof row.reading_anchor_message_id === "string" ? row.reading_anchor_message_id : null,
    readingAnchorOffset: typeof row.reading_anchor_offset === "number" ? row.reading_anchor_offset : 0,
    voicePlaybackMessageId:
      typeof row.voice_playback_message_id === "string" ? row.voice_playback_message_id : null,
    voicePlaybackSeconds:
      typeof row.voice_playback_seconds === "number" ? row.voice_playback_seconds : 0
  };
}

export async function getUltimateConversationStateAction(
  conversationId: string
): Promise<UltimateConversationState | null> {
  if (!configured() || !uuidSchema.safeParse(conversationId).success) return null;
  const userId = await getAuthedUserId();
  if (!userId) return null;

  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, userId, conversationId);
  if (!access.canView) return null;

  const db = admin as unknown as SupabaseClient;
  const now = new Date().toISOString();
  const [settingsResult, preferencesResult, presenceResult, pinsResult, savesResult, pollsResult] =
    await Promise.all([
      db.from("conversation_chat_settings").select("*").eq("conversation_id", conversationId).maybeSingle(),
      db
        .from("conversation_user_preferences")
        .select("*")
        .eq("conversation_id", conversationId)
        .eq("user_id", userId)
        .maybeSingle(),
      db
        .from("conversation_presence")
        .select("user_id, presence_state, present_until, typing_until, last_active_at")
        .eq("conversation_id", conversationId)
        .gt("present_until", new Date(Date.now() - 5 * 60_000).toISOString()),
      db
        .from("conversation_pins")
        .select("id, message_id, pinned_by, pinned_at")
        .eq("conversation_id", conversationId)
        .order("pinned_at", { ascending: false })
        .limit(20),
      db
        .from("saved_messages")
        .select("message_id, messages!inner(conversation_id)")
        .eq("user_id", userId)
        .eq("messages.conversation_id", conversationId),
      db
        .from("chat_polls")
        .select("message_id, question, allow_multiple, is_anonymous, closed_at, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(100)
    ]);

  const rawPresence = (presenceResult.data ?? []) as Array<Record<string, unknown>>;
  const presenceIds = rawPresence
    .map((row) => (typeof row.user_id === "string" ? row.user_id : null))
    .filter((id): id is string => Boolean(id) && id !== userId);

  const [profilesResult, presencePrefsResult] = presenceIds.length
    ? await Promise.all([
        admin.from("profiles").select("user_id, full_name, username, avatar_url").in("user_id", presenceIds),
        admin.from("user_preferences").select("user_id, communication_preferences").in("user_id", presenceIds)
      ])
    : [{ data: [] }, { data: [] }];

  const profileById = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.user_id, profile])
  );
  const presencePrefsById = new Map(
    (presencePrefsResult.data ?? []).map((row) => [
      row.user_id,
      normalizeCommunicationPreferences(row.communication_preferences)
    ])
  );

  const presence: ConversationPresencePerson[] = rawPresence.flatMap((row) => {
    const id = typeof row.user_id === "string" ? row.user_id : null;
    if (!id || id === userId) return [];
    const prefs = presencePrefsById.get(id);
    if (prefs && !prefs.presenceEnabled && !prefs.typingIndicatorEnabled) return [];
    const profile = profileById.get(id);
    const typingUntil = typeof row.typing_until === "string" ? row.typing_until : null;
    const presentUntil = typeof row.present_until === "string" ? row.present_until : null;
    const isTyping = Boolean(
      (!prefs || prefs.typingIndicatorEnabled) && typingUntil && typingUntil > now
    );
    const isInChat = Boolean(
      (!prefs || prefs.presenceEnabled) && presentUntil && presentUntil > now
    );
    if (!isTyping && !isInChat && prefs && !prefs.presenceEnabled) return [];
    return [
      {
        userId: id,
        displayName: profile?.full_name?.trim() || profile?.username?.trim() || "A Muddy",
        avatarUrl: profile?.avatar_url ?? null,
        isTyping,
        isInChat,
        lastActiveAt:
          typeof row.last_active_at === "string" ? row.last_active_at : new Date(0).toISOString()
      }
    ];
  });

  const pollRows = (pollsResult.data ?? []) as Array<Record<string, unknown>>;
  const pollIds = pollRows
    .map((row) => (typeof row.message_id === "string" ? row.message_id : null))
    .filter((id): id is string => Boolean(id));
  let polls: ChatPollView[] = [];
  if (pollIds.length > 0) {
    const [optionResult, voteResult] = await Promise.all([
      db
        .from("chat_poll_options")
        .select("id, poll_message_id, label, position")
        .in("poll_message_id", pollIds)
        .order("position", { ascending: true }),
      db
        .from("chat_poll_votes")
        .select("poll_message_id, option_id, user_id")
        .in("poll_message_id", pollIds)
    ]);
    const options = (optionResult.data ?? []) as Array<Record<string, unknown>>;
    const votes = (voteResult.data ?? []) as Array<Record<string, unknown>>;
    polls = pollRows.map((poll) => {
      const messageId = String(poll.message_id);
      const pollVotes = votes.filter((vote) => vote.poll_message_id === messageId);
      const voters = new Set(
        pollVotes.map((vote) => (typeof vote.user_id === "string" ? vote.user_id : "")).filter(Boolean)
      );
      return {
        messageId,
        question: String(poll.question ?? "Poll"),
        allowMultiple: poll.allow_multiple === true,
        isAnonymous: poll.is_anonymous === true,
        closedAt: typeof poll.closed_at === "string" ? poll.closed_at : null,
        totalVoters: voters.size,
        options: options
          .filter((option) => option.poll_message_id === messageId)
          .map((option) => {
            const optionId = String(option.id);
            const optionVotes = pollVotes.filter((vote) => vote.option_id === optionId);
            return {
              id: optionId,
              label: String(option.label ?? "Option"),
              position: Number(option.position ?? 0),
              voteCount: optionVotes.length,
              votedByMe: optionVotes.some((vote) => vote.user_id === userId)
            };
          })
      };
    });
  }

  return {
    settings: mapSettings((settingsResult.data as Record<string, unknown> | null) ?? null),
    preferences: mapPreferences((preferencesResult.data as Record<string, unknown> | null) ?? null),
    presence,
    pins: ((pinsResult.data ?? []) as Array<Record<string, unknown>>).map((pin) => ({
      id: String(pin.id),
      messageId: String(pin.message_id),
      pinnedAt: String(pin.pinned_at),
      pinnedBy: typeof pin.pinned_by === "string" ? pin.pinned_by : null
    })),
    savedMessageIds: ((savesResult.data ?? []) as Array<Record<string, unknown>>).map((row) =>
      String(row.message_id)
    ),
    polls
  };
}

export async function heartbeatConversationPresenceAction(input: unknown) {
  if (!configured()) return actionError("Chats are not configured.");
  const parsed = z
    .object({ conversationId: uuidSchema, typing: z.boolean().default(false) })
    .safeParse(input);
  if (!parsed.success) return actionError("Conversation not found.");

  const userId = await getAuthedUserId();
  if (!userId) return actionError("Log in first.");
  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, userId, parsed.data.conversationId);
  if (!access.canView) return actionError("Conversation not found.");

  const preferences = await loadCommunicationPreferences(admin, userId);
  if (!preferences.presenceEnabled && !preferences.typingIndicatorEnabled) {
    await untypedAdmin()
      .from("conversation_presence")
      .delete()
      .eq("conversation_id", parsed.data.conversationId)
      .eq("user_id", userId);
    return { ok: true as const, message: "Presence hidden." };
  }

  const now = Date.now();
  const typing = parsed.data.typing && preferences.typingIndicatorEnabled;
  const db = untypedAdmin();
  const { error } = await db.from("conversation_presence").upsert(
    {
      conversation_id: parsed.data.conversationId,
      user_id: userId,
      presence_state: "in_chat",
      present_until: new Date(now + 30_000).toISOString(),
      typing_until: typing ? new Date(now + 7_000).toISOString() : null,
      last_active_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString()
    },
    { onConflict: "conversation_id,user_id" }
  );
  return error ? actionError("Presence could not be updated.") : { ok: true as const, message: "Presence updated." };
}

export async function leaveConversationPresenceAction(conversationId: string) {
  if (!configured() || !uuidSchema.safeParse(conversationId).success) return actionError("Conversation not found.");
  const userId = await getAuthedUserId();
  if (!userId) return actionError("Log in first.");
  await untypedAdmin()
    .from("conversation_presence")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  return { ok: true as const, message: "Presence cleared." };
}

export async function setSavedMessageAction(input: unknown) {
  if (!configured()) return actionError("Chats are not configured.");
  const parsed = z
    .object({ messageId: uuidSchema, saved: z.boolean(), folderId: uuidSchema.nullish() })
    .safeParse(input);
  if (!parsed.success) return actionError("Message not found.");
  const userId = await getAuthedUserId();
  if (!userId) return actionError("Log in first.");

  const admin = createSupabaseAdminClient();
  const { data: message } = await admin
    .from("messages")
    .select("id, conversation_id")
    .eq("id", parsed.data.messageId)
    .maybeSingle();
  if (!message) return actionError("Message not found.");
  const access = await resolveConversationAccess(admin, userId, message.conversation_id);
  if (!access.canView) return actionError("Message not found.");

  const db = admin as unknown as SupabaseClient;
  if (!parsed.data.saved) {
    const { error } = await db
      .from("saved_messages")
      .delete()
      .eq("message_id", parsed.data.messageId)
      .eq("user_id", userId);
    return error ? actionError("Saved message could not be updated.") : { ok: true as const, message: "Removed from Saved." };
  }

  if (parsed.data.folderId) {
    const { data: folder } = await db
      .from("saved_message_folders")
      .select("id")
      .eq("id", parsed.data.folderId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!folder) return actionError("Saved folder not found.");
  }

  const { error } = await db.from("saved_messages").upsert(
    {
      message_id: parsed.data.messageId,
      user_id: userId,
      folder_id: parsed.data.folderId ?? null,
      saved_at: new Date().toISOString()
    },
    { onConflict: "message_id,user_id" }
  );
  return error ? actionError("Message could not be saved.") : { ok: true as const, message: "Saved." };
}

export async function setPinnedMessageAction(input: unknown) {
  if (!configured()) return actionError("Chats are not configured.");
  const parsed = z.object({ messageId: uuidSchema, pinned: z.boolean() }).safeParse(input);
  if (!parsed.success) return actionError("Message not found.");
  const userId = await getAuthedUserId();
  if (!userId) return actionError("Log in first.");

  const admin = createSupabaseAdminClient();
  const { data: message } = await admin
    .from("messages")
    .select("id, conversation_id")
    .eq("id", parsed.data.messageId)
    .maybeSingle();
  if (!message) return actionError("Message not found.");
  const access = await resolveConversationAccess(admin, userId, message.conversation_id);
  if (!access.canView) return actionError("Message not found.");

  const db = admin as unknown as SupabaseClient;
  const { data: settingsRow } = await db
    .from("conversation_chat_settings")
    .select("who_can_pin")
    .eq("conversation_id", message.conversation_id)
    .maybeSingle();
  const rule = capabilitySchema.safeParse(settingsRow?.who_can_pin).success
    ? (settingsRow?.who_can_pin as ChatCapabilityRule)
    : "all_members";
  if (!capabilityAllows(rule, access.role)) return actionError("You can't pin messages in this chat.");

  if (!parsed.data.pinned) {
    const { error } = await db
      .from("conversation_pins")
      .delete()
      .eq("conversation_id", message.conversation_id)
      .eq("message_id", message.id);
    return error ? actionError("Pin could not be removed.") : { ok: true as const, message: "Unpinned." };
  }

  const { error } = await db.from("conversation_pins").upsert(
    {
      conversation_id: message.conversation_id,
      message_id: message.id,
      pinned_by: userId,
      pinned_at: new Date().toISOString()
    },
    { onConflict: "conversation_id,message_id" }
  );
  return error ? actionError("Message could not be pinned.") : { ok: true as const, message: "Pinned." };
}

const preferencePatchSchema = z
  .object({
    conversationId: uuidSchema,
    archived: z.boolean().optional(),
    markedUnread: z.boolean().optional(),
    favoriteRank: z.number().int().min(0).max(9999).nullable().optional(),
    themeKey: z.string().trim().min(1).max(64).optional(),
    notificationPreview: previewSchema.optional(),
    notifyMentionsWhenMuted: z.boolean().optional(),
    notifyRepliesWhenMuted: z.boolean().optional(),
    draftText: z.string().max(10000).nullable().optional(),
    readingAnchorMessageId: uuidSchema.nullable().optional(),
    readingAnchorOffset: z.number().int().min(-10000).max(10000).optional(),
    voicePlaybackMessageId: uuidSchema.nullable().optional(),
    voicePlaybackSeconds: z.number().min(0).max(86400).optional()
  })
  .strict();

export async function updateConversationUserPreferencesAction(input: unknown) {
  if (!configured()) return actionError("Chats are not configured.");
  const parsed = preferencePatchSchema.safeParse(input);
  if (!parsed.success) return actionError("Those chat settings are not valid.");
  const userId = await getAuthedUserId();
  if (!userId) return actionError("Log in first.");

  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, userId, parsed.data.conversationId);
  if (!access.canView) return actionError("Conversation not found.");

  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    conversation_id: parsed.data.conversationId,
    user_id: userId,
    updated_at: now
  };
  if (parsed.data.archived !== undefined) row.archived_at = parsed.data.archived ? now : null;
  if (parsed.data.markedUnread !== undefined) row.marked_unread_at = parsed.data.markedUnread ? now : null;
  if (parsed.data.favoriteRank !== undefined) row.favorite_rank = parsed.data.favoriteRank;
  if (parsed.data.themeKey !== undefined) row.theme_key = parsed.data.themeKey;
  if (parsed.data.notificationPreview !== undefined) row.notification_preview = parsed.data.notificationPreview;
  if (parsed.data.notifyMentionsWhenMuted !== undefined) row.notify_mentions_when_muted = parsed.data.notifyMentionsWhenMuted;
  if (parsed.data.notifyRepliesWhenMuted !== undefined) row.notify_replies_when_muted = parsed.data.notifyRepliesWhenMuted;
  if (parsed.data.draftText !== undefined) {
    row.draft_text = parsed.data.draftText;
    row.draft_updated_at = now;
  }
  if (parsed.data.readingAnchorMessageId !== undefined) row.reading_anchor_message_id = parsed.data.readingAnchorMessageId;
  if (parsed.data.readingAnchorOffset !== undefined) row.reading_anchor_offset = parsed.data.readingAnchorOffset;
  if (parsed.data.voicePlaybackMessageId !== undefined) row.voice_playback_message_id = parsed.data.voicePlaybackMessageId;
  if (parsed.data.voicePlaybackSeconds !== undefined) row.voice_playback_seconds = parsed.data.voicePlaybackSeconds;

  const { error } = await untypedAdmin().from("conversation_user_preferences").upsert(row, {
    onConflict: "conversation_id,user_id"
  });
  return error ? actionError("Chat preferences could not be saved.") : { ok: true as const, message: "Chat preferences saved." };
}

const chatSettingsSchema = z
  .object({
    conversationId: uuidSchema,
    messageLifetimeSeconds: z.number().int().min(60).max(31536000).nullable().optional(),
    defaultMediaMode: mediaModeSchema.optional(),
    whoCanPin: capabilitySchema.optional(),
    whoCanCreatePolls: capabilitySchema.optional(),
    whoCanUseEveryone: capabilitySchema.optional(),
    whoCanAddMembers: capabilitySchema.optional(),
    whoCanEditInfo: z.enum(["admins", "owner"]).optional()
  })
  .strict();

export async function updateConversationChatSettingsAction(input: unknown) {
  if (!configured()) return actionError("Chats are not configured.");
  const parsed = chatSettingsSchema.safeParse(input);
  if (!parsed.success) return actionError("Those chat settings are not valid.");
  const userId = await getAuthedUserId();
  if (!userId) return actionError("Log in first.");

  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, userId, parsed.data.conversationId);
  if (!access.canView) return actionError("Conversation not found.");
  if (access.conversationType === "group" && access.role !== "owner" && access.role !== "admin") {
    return actionError("Only group admins can change these settings.");
  }

  const row: Record<string, unknown> = {
    conversation_id: parsed.data.conversationId,
    updated_by: userId,
    updated_at: new Date().toISOString()
  };
  if (parsed.data.messageLifetimeSeconds !== undefined) row.message_lifetime_seconds = parsed.data.messageLifetimeSeconds;
  if (parsed.data.defaultMediaMode !== undefined) row.default_media_mode = parsed.data.defaultMediaMode;
  if (parsed.data.whoCanPin !== undefined) row.who_can_pin = parsed.data.whoCanPin;
  if (parsed.data.whoCanCreatePolls !== undefined) row.who_can_create_polls = parsed.data.whoCanCreatePolls;
  if (parsed.data.whoCanUseEveryone !== undefined) row.who_can_use_everyone = parsed.data.whoCanUseEveryone;
  if (parsed.data.whoCanAddMembers !== undefined) row.who_can_add_members = parsed.data.whoCanAddMembers;
  if (parsed.data.whoCanEditInfo !== undefined) row.who_can_edit_info = parsed.data.whoCanEditInfo;

  const { error } = await untypedAdmin().from("conversation_chat_settings").upsert(row, {
    onConflict: "conversation_id"
  });
  return error ? actionError("Chat settings could not be saved.") : { ok: true as const, message: "Chat settings saved." };
}

const pollSchema = z.object({
  conversationId: uuidSchema,
  question: z.string().trim().min(1).max(240),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(12),
  allowMultiple: z.boolean().default(false),
  isAnonymous: z.boolean().default(false),
  clientMessageId: z.string().min(1).max(64)
});

export async function createChatPollAction(input: unknown) {
  if (!configured()) return actionError("Chats are not configured.");
  const parsed = pollSchema.safeParse(input);
  if (!parsed.success) return actionError("Add a question and at least two poll options.");
  const uniqueOptions = [...new Set(parsed.data.options.map((option) => option.trim()))];
  if (uniqueOptions.length < 2) return actionError("Poll options must be different.");

  const userId = await getAuthedUserId();
  if (!userId) return actionError("Log in first.");
  const admin = createSupabaseAdminClient();
  const send = await canSendMessage(admin, userId, parsed.data.conversationId);
  if (!send.allowed) return actionError("You can't send to this chat right now.");
  const access = await resolveConversationAccess(admin, userId, parsed.data.conversationId);

  const db = admin as unknown as SupabaseClient;
  const { data: settings } = await db
    .from("conversation_chat_settings")
    .select("who_can_create_polls, message_lifetime_seconds")
    .eq("conversation_id", parsed.data.conversationId)
    .maybeSingle();
  const rule = capabilitySchema.safeParse(settings?.who_can_create_polls).success
    ? (settings?.who_can_create_polls as ChatCapabilityRule)
    : "all_members";
  if (!capabilityAllows(rule, access.role)) return actionError("You can't create polls in this chat.");

  const messageId = crypto.randomUUID();
  const now = new Date();
  const lifetime = typeof settings?.message_lifetime_seconds === "number" ? settings.message_lifetime_seconds : null;
  const expiresAt = lifetime ? new Date(now.getTime() + lifetime * 1000).toISOString() : null;
  const { error: messageError } = await db.from("messages").insert({
    id: messageId,
    conversation_id: parsed.data.conversationId,
    sender_id: userId,
    message_type: "poll",
    text_content: null,
    client_message_id: parsed.data.clientMessageId,
    status: "sent",
    expires_at: expiresAt,
    created_at: now.toISOString()
  });
  if (messageError) return actionError("Poll could not be created.");

  const { error: pollError } = await db.from("chat_polls").insert({
    message_id: messageId,
    conversation_id: parsed.data.conversationId,
    created_by: userId,
    question: parsed.data.question,
    allow_multiple: parsed.data.allowMultiple,
    is_anonymous: parsed.data.isAnonymous,
    created_at: now.toISOString()
  });
  if (pollError) {
    await db.from("messages").delete().eq("id", messageId);
    return actionError("Poll could not be created.");
  }

  const { error: optionsError } = await db.from("chat_poll_options").insert(
    uniqueOptions.map((label, position) => ({
      poll_message_id: messageId,
      label,
      position
    }))
  );
  if (optionsError) {
    await db.from("messages").delete().eq("id", messageId);
    return actionError("Poll could not be created.");
  }

  await admin
    .from("conversations")
    .update({ last_message_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", parsed.data.conversationId);
  return { ok: true as const, message: "Poll sent.", messageId };
}

export async function voteChatPollAction(input: unknown) {
  if (!configured()) return actionError("Chats are not configured.");
  const parsed = z
    .object({ pollMessageId: uuidSchema, optionIds: z.array(uuidSchema).max(12) })
    .safeParse(input);
  if (!parsed.success) return actionError("Poll not found.");
  const userId = await getAuthedUserId();
  if (!userId) return actionError("Log in first.");

  const db = untypedAdmin();
  const { data: poll } = await db
    .from("chat_polls")
    .select("message_id, conversation_id, allow_multiple, closed_at")
    .eq("message_id", parsed.data.pollMessageId)
    .maybeSingle();
  if (!poll || poll.closed_at) return actionError("This poll is closed.");

  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, userId, String(poll.conversation_id));
  if (!access.canView) return actionError("Poll not found.");
  if (!poll.allow_multiple && parsed.data.optionIds.length > 1) return actionError("Choose one option.");

  if (parsed.data.optionIds.length > 0) {
    const { data: validOptions } = await db
      .from("chat_poll_options")
      .select("id")
      .eq("poll_message_id", parsed.data.pollMessageId)
      .in("id", parsed.data.optionIds);
    if ((validOptions ?? []).length !== parsed.data.optionIds.length) return actionError("That poll option is not available.");
  }

  await db
    .from("chat_poll_votes")
    .delete()
    .eq("poll_message_id", parsed.data.pollMessageId)
    .eq("user_id", userId);
  if (parsed.data.optionIds.length === 0) return { ok: true as const, message: "Vote cleared." };

  const { error } = await db.from("chat_poll_votes").insert(
    parsed.data.optionIds.map((optionId) => ({
      poll_message_id: parsed.data.pollMessageId,
      option_id: optionId,
      user_id: userId
    }))
  );
  return error ? actionError("Vote could not be saved.") : { ok: true as const, message: "Vote saved." };
}

export async function closeChatPollAction(pollMessageId: string) {
  if (!configured() || !uuidSchema.safeParse(pollMessageId).success) return actionError("Poll not found.");
  const userId = await getAuthedUserId();
  if (!userId) return actionError("Log in first.");
  const db = untypedAdmin();
  const { data: poll } = await db
    .from("chat_polls")
    .select("message_id, conversation_id, created_by, closed_at")
    .eq("message_id", pollMessageId)
    .maybeSingle();
  if (!poll) return actionError("Poll not found.");
  if (poll.closed_at) return { ok: true as const, message: "Poll is already closed." };

  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, userId, String(poll.conversation_id));
  if (!access.canView) return actionError("Poll not found.");
  const mayClose = poll.created_by === userId || access.role === "owner" || access.role === "admin";
  if (!mayClose) return actionError("You can't close this poll.");

  const { error } = await db
    .from("chat_polls")
    .update({ closed_at: new Date().toISOString() })
    .eq("message_id", pollMessageId);
  return error ? actionError("Poll could not be closed.") : { ok: true as const, message: "Poll closed." };
}

export async function keepMessageInChatAction(messageId: string, kept: boolean) {
  if (!configured() || !uuidSchema.safeParse(messageId).success) return actionError("Message not found.");
  const userId = await getAuthedUserId();
  if (!userId) return actionError("Log in first.");
  const admin = createSupabaseAdminClient();
  const { data: message } = await admin
    .from("messages")
    .select("id, conversation_id")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return actionError("Message not found.");
  const access = await resolveConversationAccess(admin, userId, message.conversation_id);
  if (!access.canView) return actionError("Message not found.");

  const { error } = await untypedAdmin()
    .from("messages")
    .update({ kept_at: kept ? new Date().toISOString() : null, kept_by: kept ? userId : null })
    .eq("id", messageId);
  return error ? actionError("Message could not be updated.") : { ok: true as const, message: kept ? "Kept in chat." : "Keep removed." };
}
