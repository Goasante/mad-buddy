"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

async function currentUserId() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

export async function getInboxConversationPreferencesAction() {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return {};
  const userId = await currentUserId();
  if (!userId) return {};
  const db = createSupabaseAdminClient() as unknown as SupabaseClient;
  const { data } = await db
    .from("conversation_user_preferences")
    .select("conversation_id, archived_at, marked_unread_at, favorite_rank, draft_text, draft_updated_at")
    .eq("user_id", userId);

  const result: Record<string, {
    archivedAt: string | null;
    markedUnreadAt: string | null;
    favoriteRank: number | null;
    draftText: string | null;
    draftUpdatedAt: string | null;
  }> = {};
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    if (typeof row.conversation_id !== "string") continue;
    result[row.conversation_id] = {
      archivedAt: typeof row.archived_at === "string" ? row.archived_at : null,
      markedUnreadAt: typeof row.marked_unread_at === "string" ? row.marked_unread_at : null,
      favoriteRank: typeof row.favorite_rank === "number" ? row.favorite_rank : null,
      draftText: typeof row.draft_text === "string" ? row.draft_text : null,
      draftUpdatedAt: typeof row.draft_updated_at === "string" ? row.draft_updated_at : null
    };
  }
  return result;
}
