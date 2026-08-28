"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  ChatCollectionMessageView,
  ChatCollectionsView,
  MessageInfoView,
  SavedMessageFolderView
} from "@/lib/messaging/v4-insights-types";
import { resolveConversationAccess } from "@/lib/messaging/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();

function configured() {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

function db() {
  return createSupabaseAdminClient() as unknown as SupabaseClient;
}

async function authedUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

function messagePreview(row: Record<string, unknown>) {
  if (row.deleted_at) return "Message removed";
  const type = String(row.message_type ?? "text");
  if (type === "voice_note") return "Voice message";
  if (type === "image") return "Photo";
  if (type === "video") return "Video";
  if (type === "file") return "Document";
  if (type === "contact") return "Contact";
  if (type === "poll") return "Poll";
  if (type === "event") return "Event or Plan";
  if (type === "place") return "Place";
  if (type === "drawing") return "Drawing";
  const text = typeof row.text_content === "string" ? row.text_content.trim() : "";
  return text || "Message";
}

/**
 * Sender-only message information.
 *
 * Read-by is derived from each joined member's canonical last-read anchor.
 * The completion migration adds last_read_at via a DB trigger; before that
 * migration is applied this action falls back to the membership row's
 * updated_at so the Lab degrades safely instead of breaking the thread.
 */
export async function getMessageInfoAction(messageId: string): Promise<MessageInfoView | null> {
  if (!configured() || !uuid.safeParse(messageId).success) return null;
  const userId = await authedUserId();
  if (!userId) return null;

  const admin = createSupabaseAdminClient();
  const { data: message } = await admin
    .from("messages")
    .select("id, conversation_id, sender_id, created_at, edited_at, status")
    .eq("id", messageId)
    .maybeSingle();
  if (!message || message.sender_id !== userId) return null;

  const access = await resolveConversationAccess(admin, userId, message.conversation_id);
  if (!access.canView) return null;

  const untyped = admin as unknown as SupabaseClient;
  let memberRows: Array<Record<string, unknown>> = [];
  const withReadAt = await untyped
    .from("conversation_members")
    .select("user_id, last_read_message_id, read_receipts_enabled, last_read_at, updated_at")
    .eq("conversation_id", message.conversation_id)
    .eq("status", "joined")
    .neq("user_id", userId);

  if (!withReadAt.error) {
    memberRows = (withReadAt.data ?? []) as Array<Record<string, unknown>>;
  } else {
    const fallback = await untyped
      .from("conversation_members")
      .select("user_id, last_read_message_id, read_receipts_enabled, updated_at")
      .eq("conversation_id", message.conversation_id)
      .eq("status", "joined")
      .neq("user_id", userId);
    memberRows = (fallback.data ?? []) as Array<Record<string, unknown>>;
  }

  const anchorIds = [...new Set(memberRows
    .map((row) => typeof row.last_read_message_id === "string" ? row.last_read_message_id : null)
    .filter((value): value is string => Boolean(value)))];
  const { data: anchors } = anchorIds.length
    ? await admin.from("messages").select("id, created_at").in("id", anchorIds)
    : { data: [] as Array<{ id: string; created_at: string }> };
  const anchorTime = new Map((anchors ?? []).map((row) => [row.id, Date.parse(row.created_at)]));

  const readableRows = memberRows.filter((row) => row.read_receipts_enabled !== false);
  const memberIds = readableRows
    .map((row) => typeof row.user_id === "string" ? row.user_id : null)
    .filter((value): value is string => Boolean(value));
  const { data: profiles } = memberIds.length
    ? await admin.from("profiles").select("user_id, full_name, username, avatar_url").in("user_id", memberIds)
    : { data: [] as Array<{ user_id: string; full_name: string | null; username: string | null; avatar_url: string | null }> };
  const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));

  const messageTime = Date.parse(message.created_at);
  const readBy = readableRows.flatMap((row) => {
    const id = typeof row.user_id === "string" ? row.user_id : null;
    const anchorId = typeof row.last_read_message_id === "string" ? row.last_read_message_id : null;
    if (!id || !anchorId || (anchorTime.get(anchorId) ?? -Infinity) < messageTime) return [];
    const profile = profileById.get(id);
    return [{
      userId: id,
      displayName: profile?.full_name?.trim() || profile?.username?.trim() || "A Muddy",
      username: profile?.username ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      readAt:
        typeof row.last_read_at === "string"
          ? row.last_read_at
          : typeof row.updated_at === "string"
            ? row.updated_at
            : null
    }];
  }).sort((a, b) => (b.readAt ?? "").localeCompare(a.readAt ?? ""));

  return {
    messageId: message.id,
    createdAt: message.created_at,
    editedAt: message.edited_at,
    state: message.status as MessageInfoView["state"],
    readBy,
    unreadReceiptCount: Math.max(0, readableRows.length - readBy.length)
  };
}

export async function getChatCollectionsAction(conversationId: string): Promise<ChatCollectionsView> {
  const empty: ChatCollectionsView = { folders: [], saved: [], pinned: [] };
  if (!configured() || !uuid.safeParse(conversationId).success) return empty;
  const userId = await authedUserId();
  if (!userId) return empty;

  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, userId, conversationId);
  if (!access.canView) return empty;
  const untyped = admin as unknown as SupabaseClient;

  const [folderResult, savedResult, pinResult] = await Promise.all([
    untyped
      .from("saved_message_folders")
      .select("id, name, sort_order, created_at")
      .eq("user_id", userId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    untyped
      .from("saved_messages")
      .select("message_id, folder_id, saved_at")
      .eq("user_id", userId),
    untyped
      .from("conversation_pins")
      .select("message_id, pinned_at")
      .eq("conversation_id", conversationId)
      .order("pinned_at", { ascending: false })
  ]);

  const folders: SavedMessageFolderView[] = ((folderResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at)
  }));

  const savedRows = (savedResult.data ?? []) as Array<Record<string, unknown>>;
  const pinRows = (pinResult.data ?? []) as Array<Record<string, unknown>>;
  const candidateIds = [...new Set([
    ...savedRows.map((row) => String(row.message_id)),
    ...pinRows.map((row) => String(row.message_id))
  ])];
  if (candidateIds.length === 0) return { folders, saved: [], pinned: [] };

  const { data: messages } = await untyped
    .from("messages")
    .select("id, conversation_id, sender_id, message_type, text_content, created_at, deleted_at")
    .eq("conversation_id", conversationId)
    .in("id", candidateIds);
  const messageRows = (messages ?? []) as Array<Record<string, unknown>>;
  const senderIds = [...new Set(messageRows
    .map((row) => typeof row.sender_id === "string" ? row.sender_id : null)
    .filter((value): value is string => Boolean(value)))];
  const { data: profiles } = senderIds.length
    ? await admin.from("profiles").select("user_id, full_name, username").in("user_id", senderIds)
    : { data: [] as Array<{ user_id: string; full_name: string | null; username: string | null }> };
  const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  const messageById = new Map(messageRows.map((row) => [String(row.id), row]));
  const savedById = new Map(savedRows.map((row) => [String(row.message_id), row]));
  const pinById = new Map(pinRows.map((row) => [String(row.message_id), row]));

  function project(messageId: string): ChatCollectionMessageView | null {
    const row = messageById.get(messageId);
    if (!row) return null;
    const senderId = typeof row.sender_id === "string" ? row.sender_id : null;
    const profile = senderId ? profileById.get(senderId) : null;
    const saved = savedById.get(messageId);
    const pin = pinById.get(messageId);
    return {
      messageId,
      senderName: senderId === userId ? "You" : profile?.full_name?.trim() || profile?.username?.trim() || "Mad Buddy",
      preview: messagePreview(row),
      messageType: String(row.message_type ?? "text"),
      createdAt: String(row.created_at),
      savedAt: typeof saved?.saved_at === "string" ? saved.saved_at : null,
      folderId: typeof saved?.folder_id === "string" ? saved.folder_id : null,
      pinnedAt: typeof pin?.pinned_at === "string" ? pin.pinned_at : null
    };
  }

  const saved = savedRows
    .map((row) => project(String(row.message_id)))
    .filter((value): value is ChatCollectionMessageView => Boolean(value))
    .sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));
  const pinned = pinRows
    .map((row) => project(String(row.message_id)))
    .filter((value): value is ChatCollectionMessageView => Boolean(value))
    .sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? ""));

  return { folders, saved, pinned };
}

export async function createSavedMessageFolderAction(name: string) {
  if (!configured()) return { ok: false as const, message: "Chats are not configured." };
  const parsed = z.string().trim().min(1).max(60).safeParse(name);
  if (!parsed.success) return { ok: false as const, message: "Folder names can be up to 60 characters." };
  const userId = await authedUserId();
  if (!userId) return { ok: false as const, message: "Log in first." };

  const untyped = db();
  const { data: last } = await untyped
    .from("saved_message_folders")
    .select("sort_order")
    .eq("user_id", userId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await untyped.from("saved_message_folders").insert({
    user_id: userId,
    name: parsed.data,
    sort_order: Number(last?.sort_order ?? -1) + 1,
    updated_at: new Date().toISOString()
  });
  return error
    ? { ok: false as const, message: "That Saved folder could not be created." }
    : { ok: true as const, message: "Saved folder created." };
}

export async function renameSavedMessageFolderAction(folderId: string, name: string) {
  if (!configured() || !uuid.safeParse(folderId).success) return { ok: false as const, message: "Folder not found." };
  const parsed = z.string().trim().min(1).max(60).safeParse(name);
  if (!parsed.success) return { ok: false as const, message: "Folder names can be up to 60 characters." };
  const userId = await authedUserId();
  if (!userId) return { ok: false as const, message: "Log in first." };
  const { error } = await db()
    .from("saved_message_folders")
    .update({ name: parsed.data, updated_at: new Date().toISOString() })
    .eq("id", folderId)
    .eq("user_id", userId);
  return error
    ? { ok: false as const, message: "Saved folder could not be renamed." }
    : { ok: true as const, message: "Saved folder renamed." };
}

export async function deleteSavedMessageFolderAction(folderId: string) {
  if (!configured() || !uuid.safeParse(folderId).success) return { ok: false as const, message: "Folder not found." };
  const userId = await authedUserId();
  if (!userId) return { ok: false as const, message: "Log in first." };
  const { error } = await db()
    .from("saved_message_folders")
    .delete()
    .eq("id", folderId)
    .eq("user_id", userId);
  return error
    ? { ok: false as const, message: "Saved folder could not be deleted." }
    : { ok: true as const, message: "Saved folder deleted. Messages stay Saved." };
}

export async function moveSavedMessageToFolderAction(messageId: string, folderId: string | null) {
  if (!configured() || !uuid.safeParse(messageId).success || (folderId && !uuid.safeParse(folderId).success)) {
    return { ok: false as const, message: "Saved message not found." };
  }
  const userId = await authedUserId();
  if (!userId) return { ok: false as const, message: "Log in first." };
  const untyped = db();

  if (folderId) {
    const { data: folder } = await untyped
      .from("saved_message_folders")
      .select("id")
      .eq("id", folderId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!folder) return { ok: false as const, message: "Saved folder not found." };
  }

  const { error } = await untyped
    .from("saved_messages")
    .update({ folder_id: folderId })
    .eq("message_id", messageId)
    .eq("user_id", userId);
  return error
    ? { ok: false as const, message: "Saved message could not be moved." }
    : { ok: true as const, message: folderId ? "Moved to folder." : "Moved out of folder." };
}
