import "server-only";

import { z } from "zod";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

/**
 * Native (FCM/APNs) device push tokens. Shared by the mobile `/api/push/register`
 * route. The web app has no native tokens, so there is no Server Action here.
 *
 * NOTE: `device_push_tokens` is newer than the generated Database types, so this
 * module talks to an untyped admin client. Once the migration is applied and
 * `lib/supabase/database.types.ts` is regenerated, swap `untypedAdmin()` for the
 * normal typed `createSupabaseAdminClient()`.
 */

export type ServiceResult = { ok: boolean; message: string };

export const registerTokenSchema = z.object({
  token: z.string().min(1).max(4096),
  platform: z.enum(["android", "ios"])
});

function serviceRoleEnvMessage(): string | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return "Push registration is not available right now.";
  }
  return null;
}

// The typed admin client doesn't know about device_push_tokens yet; borrow its
// URL/key to build an untyped client just for this table.
function untypedAdmin(): SupabaseClient {
  const env = getSupabaseServerEnv();
  return createClient(env.url as string, env.serviceRoleKey as string, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function registerDeviceToken(userId: string, input: unknown): Promise<ServiceResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };

  const parsed = registerTokenSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Invalid push token." };
  }

  // onConflict(token): the same device re-registering under a new account moves
  // the token to that account rather than duplicating it.
  const { error } = await untypedAdmin()
    .from("device_push_tokens")
    .upsert(
      {
        user_id: userId,
        token: parsed.data.token,
        platform: parsed.data.platform,
        last_seen_at: new Date().toISOString()
      },
      { onConflict: "token" }
    );

  if (error) {
    return { ok: false, message: "Could not register this device for notifications." };
  }

  return { ok: true, message: "Device registered for notifications." };
}

export async function removeDeviceToken(userId: string, token: string): Promise<ServiceResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };

  if (!token) return { ok: false, message: "No token provided." };

  // Scope to the owner so a token can only be removed by the account it's on.
  const { error } = await untypedAdmin()
    .from("device_push_tokens")
    .delete()
    .eq("token", token)
    .eq("user_id", userId);

  if (error) {
    return { ok: false, message: "Could not remove this device." };
  }

  return { ok: true, message: "Device removed." };
}
