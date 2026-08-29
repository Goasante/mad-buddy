"use server";

import { z } from "zod";

import { resolveConversationAccess } from "@/lib/messaging/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const inputSchema = z.object({ conversationId: uuid, messageId: uuid });

export type MessageRetentionView = {
  mode: "keep" | "24h";
  expiresAt: string | null;
  keptAt: string | null;
  keptByName: string | null;
  canKeep: boolean;
};

function configured() {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

async function userId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

export async function getMessageRetentionAction(input: unknown): Promise<MessageRetentionView | null> {
  if (!configured()) return null;
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return null;
  const viewerId = await userId();
  if (!viewerId) return null;
  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, viewerId, parsed.data.conversationId);
  if (!access.canView || access.status !== "active") return null;

  const db = admin;
  const { data: message } = await db
    .from("messages")
    .select("id, conversation_id, media_mode, expires_at, kept_at, kept_by, deleted_at, status, created_at")
    .eq("id", parsed.data.messageId)
    .eq("conversation_id", parsed.data.conversationId)
    .maybeSingle();
  if (!message || message.deleted_at || message.status === "deleted") return null;
  if (access.historyVisibleFrom && Date.parse(String(message.created_at)) < Date.parse(access.historyVisibleFrom)) return null;

  const keptBy = typeof message.kept_by === "string" ? message.kept_by : null;
  let keptByName: string | null = null;
  if (keptBy) {
    const { data: profile } = await admin.from("profiles").select("full_name, username").eq("user_id", keptBy).maybeSingle();
    keptByName = profile?.full_name?.trim() || profile?.username?.trim() || "A Muddy";
  }

  const expiresAt = typeof message.expires_at === "string" ? message.expires_at : null;
  const keptAt = typeof message.kept_at === "string" ? message.kept_at : null;
  const rawMode = message.media_mode === "24h" ? "24h" : "keep";
  return {
    mode: rawMode,
    expiresAt,
    keptAt,
    keptByName,
    canKeep: Boolean(expiresAt && !keptAt && Date.parse(expiresAt) > Date.now())
  };
}

export async function keepMessageInChatAction(input: unknown) {
  if (!configured()) return { ok: false as const, message: "Chats are not configured." };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Message not found." };
  const viewerId = await userId();
  if (!viewerId) return { ok: false as const, message: "Log in first." };
  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, viewerId, parsed.data.conversationId);
  if (!access.canView || access.status !== "active") return { ok: false as const, message: "Message not found." };

  const db = admin;
  const now = new Date().toISOString();
  const { data: kept, error } = await db
    .from("messages")
    .update({ kept_at: now, kept_by: viewerId })
    .eq("id", parsed.data.messageId)
    .eq("conversation_id", parsed.data.conversationId)
    .is("deleted_at", null)
    .is("kept_at", null)
    .gt("expires_at", now)
    .select("id")
    .maybeSingle();
  if (error || !kept) return { ok: false as const, message: "This message can no longer be kept." };
  return { ok: true as const, message: "Kept in chat." };
}
