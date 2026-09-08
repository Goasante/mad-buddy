"use server";

import { z } from "zod";
import { resolveConversationAccess } from "@/lib/messaging/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { getCurrentIdentity } from "@/lib/supabase/auth";

export async function getConversationViewerRoleAction(conversationId: string) {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey || !z.string().uuid().safeParse(conversationId).success) return null;
  /* Local JWT verification via the shared helper rather than a network round
     trip to the auth server -- see lib/supabase/auth.ts. */
  const user = await getCurrentIdentity();
  const error = user ? null : new Error("unauthenticated");
  if (error || !user) return null;
  const access = await resolveConversationAccess(createSupabaseAdminClient(), user.id, conversationId);
  return access.canView ? access.role : null;
}
