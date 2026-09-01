"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type DeliveryAckResult = {
  ok: boolean;
  message: string;
};

/**
 * Marks direct messages as delivered when the recipient has a live Messages
 * surface. This is intentionally separate from "read": opening the inbox proves
 * the message reached the recipient's authenticated session, while opening the
 * individual thread advances the existing read cursor and read-receipt state.
 *
 * Idempotent by construction: only rows still in `sent` are touched.
 */
export async function markInboxDeliveredAction(): Promise<DeliveryAckResult> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return { ok: false, message: "Messaging delivery acknowledgement is unavailable." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();
  if (authError || !user) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: memberships, error: membershipError } = await admin
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", user.id)
    .eq("status", "joined");

  if (membershipError) return { ok: false, message: "Delivery state could not be updated." };
  const conversationIds = [...new Set((memberships ?? []).map((row) => row.conversation_id))];
  if (conversationIds.length === 0) return { ok: true, message: "Up to date." };

  const { data: directConversations, error: conversationError } = await admin
    .from("conversations")
    .select("id")
    .in("id", conversationIds)
    .eq("conversation_type", "direct")
    .eq("status", "active");

  if (conversationError) return { ok: false, message: "Delivery state could not be updated." };
  const directIds = (directConversations ?? []).map((conversation) => conversation.id);
  if (directIds.length === 0) return { ok: true, message: "Up to date." };

  const { error } = await admin
    .from("messages")
    .update({ status: "delivered" })
    .in("conversation_id", directIds)
    .neq("sender_id", user.id)
    .eq("status", "sent");

  return error
    ? { ok: false, message: "Delivery state could not be updated." }
    : { ok: true, message: "Delivered." };
}
