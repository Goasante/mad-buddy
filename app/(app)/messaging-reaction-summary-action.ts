"use server";

import { z } from "zod";

import type { MessageReactionSummaryMap } from "@/lib/messaging/reaction-summary-types";
import { resolveConversationAccess } from "@/lib/messaging/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

const uuid = z.string().uuid();
const ALLOWED = new Set(["heart", "laugh", "thumbs_up", "wave", "fire", "wow"] as const);

export async function getConversationReactionSummariesAction(
  conversationId: string
): Promise<MessageReactionSummaryMap> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey || !uuid.safeParse(conversationId).success) return {};
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return {};

  const admin = createSupabaseAdminClient();
  const access = await resolveConversationAccess(admin, user.id, conversationId);
  if (!access.canView) return {};

  const { data: messages } = await admin
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(300);
  const messageIds = (messages ?? []).map((message) => message.id);
  if (messageIds.length === 0) return {};

  const { data: reactions } = await admin
    .from("message_reactions")
    .select("message_id, user_id, reaction_type, created_at")
    .in("message_id", messageIds)
    .order("created_at", { ascending: true });
  const userIds = [...new Set((reactions ?? []).map((reaction) => reaction.user_id))];
  const { data: profiles } = userIds.length
    ? await admin.from("profiles").select("user_id, full_name, username, avatar_url").in("user_id", userIds)
    : { data: [] };
  const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));

  const result: MessageReactionSummaryMap = {};
  for (const reaction of reactions ?? []) {
    if (!ALLOWED.has(reaction.reaction_type as never)) continue;
    const list = result[reaction.message_id] ?? [];
    let aggregate = list.find((entry) => entry.reaction === reaction.reaction_type);
    if (!aggregate) {
      aggregate = { reaction: reaction.reaction_type as typeof list[number]["reaction"], count: 0, reactors: [] };
      list.push(aggregate);
      result[reaction.message_id] = list;
    }
    aggregate.count += 1;
    const profile = profileById.get(reaction.user_id);
    aggregate.reactors.push({
      userId: reaction.user_id,
      displayName: reaction.user_id === user.id ? "You" : profile?.full_name?.trim() || profile?.username?.trim() || "A Muddy",
      username: profile?.username ?? null,
      avatarUrl: profile?.avatar_url ?? null
    });
  }
  for (const aggregates of Object.values(result)) {
    aggregates.sort((a, b) => b.count - a.count || a.reaction.localeCompare(b.reaction));
  }
  return result;
}
