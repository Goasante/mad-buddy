"use server";

import { z } from "zod";
import { resolveConversationAccess } from "@/lib/messaging/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { getMessagingIdentityId } from "@/lib/messaging/action-auth";

export async function getConversationViewerRoleAction(conversationId: string) {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey || !z.string().uuid().safeParse(conversationId).success) return null;
  /* A pure read of the caller's OWN role, gated by resolveConversationAccess.
     Identity is sufficient: it returns nothing for a non-member. */
  const userId = await getMessagingIdentityId();
  if (!userId) return null;
  const access = await resolveConversationAccess(createSupabaseAdminClient(), userId, conversationId);
  return access.canView ? access.role : null;
}
