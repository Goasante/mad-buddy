"use server";

import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PushActionState = { ok: boolean; message: string };

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(300),
    auth: z.string().min(1).max(200)
  })
});

async function getAuthedUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

export async function savePushSubscriptionAction(input: unknown): Promise<PushActionState> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return { ok: false, message: "This action needs the server database configuration." };
  }

  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That subscription isn't valid." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      last_seen_at: new Date().toISOString()
    },
    { onConflict: "endpoint" }
  );
  if (error) return { ok: false, message: "Couldn't save the subscription." };
  return { ok: true, message: "Push notifications are on for this browser." };
}

export async function deletePushSubscriptionAction(endpoint: string): Promise<PushActionState> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return { ok: false, message: "This action needs the server database configuration." };
  }
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  await admin.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
  return { ok: true, message: "Push notifications are off for this browser." };
}
