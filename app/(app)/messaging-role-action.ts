"use server";

import { z } from "zod";
import { resolveConversationAccess } from "@/lib/messaging/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

export async function getConversationViewerRoleAction(conversationId: string) {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey || !z.string().uuid().safeParse(conversationId).success) return null;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const access = await resolveConversationAccess(createSupabaseAdminClient(), user.id, conversationId);
  return access.canView ? access.role : null;
}
