"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkFeature } from "@/lib/billing/entitlements";
import { resolveUserEntitlements } from "@/lib/billing/service";
import { isGlowColorId } from "@/lib/glow/custom-colors";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { areApprovedMuddies } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type GlowColorActionState = { ok: boolean; message: string };

const friendSchema = z.object({ friendId: z.string().uuid() });
const setSchema = friendSchema.extend({ colorId: z.string().max(16) });

async function getAuthedUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Assigns a palette colour to a Muddy's glow. Gated on the `custom_glow_styles`
 * entitlement (Buddy Plus / Pro, or a per-user admin grant) and on a real
 * mutual friendship — both checked server-side, never trusted from the client.
 */
export async function setFriendGlowColorAction(input: unknown): Promise<GlowColorActionState> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return { ok: false, message: "This action needs the server database configuration." };
  }

  const parsed = setSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a Muddy and a colour." };
  // Palette validation is separate from the string check so an unknown id is a
  // clear message rather than a schema error.
  if (!isGlowColorId(parsed.data.colorId)) return { ok: false, message: "That glow colour isn't available." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  if (userId === parsed.data.friendId) return { ok: false, message: "You can't set a glow colour for yourself." };

  const limit = await consumeRateLimit({ action: "status.update", userId });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

  const admin = createSupabaseAdminClient();

  const entitlements = await resolveUserEntitlements(admin, userId);
  if (!checkFeature(entitlements, "custom_glow_styles")) {
    return { ok: false, message: "Custom glow colours are a Buddy Plus feature." };
  }

  const areFriends = await areApprovedMuddies(admin, userId, parsed.data.friendId);
  if (!areFriends) return { ok: false, message: "You can only set a glow colour for an approved Muddy." };

  const nowIso = new Date().toISOString();
  const { error } = await admin.from("friend_glow_colors").upsert(
    {
      owner_id: userId,
      friend_id: parsed.data.friendId,
      color_id: parsed.data.colorId,
      updated_at: nowIso
    },
    { onConflict: "owner_id,friend_id" }
  );
  if (error) return { ok: false, message: "Your glow colour couldn't be saved." };

  revalidatePath("/friends");
  revalidatePath("/dashboard");
  return { ok: true, message: "Glow colour updated." };
}

/** Clears a Muddy's custom glow colour, reverting them to the default glow. */
export async function clearFriendGlowColorAction(input: unknown): Promise<GlowColorActionState> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return { ok: false, message: "This action needs the server database configuration." };
  }

  const parsed = friendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a Muddy." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  // No entitlement gate on removal: a downgraded user must always be able to
  // clear a colour they can no longer edit.
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("friend_glow_colors")
    .delete()
    .eq("owner_id", userId)
    .eq("friend_id", parsed.data.friendId);
  if (error) return { ok: false, message: "Your glow colour couldn't be reset." };

  revalidatePath("/friends");
  revalidatePath("/dashboard");
  return { ok: true, message: "Reverted to the default glow." };
}
