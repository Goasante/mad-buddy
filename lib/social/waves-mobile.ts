import "server-only";

import { z } from "zod";
import { deliverNotification } from "@/lib/notifications/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { wavePairCooldownRemaining } from "@/lib/social/rules";
import { areApprovedMuddies, isBlockedEitherDirection } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

/**
 * Mobile "Wave" (from the Muddies Active-now card). Mirrors sendWaveV2Action's
 * core: approved-Muddy + not-blocked gate, 30-min per-pair cooldown, insert,
 * and a critical notification unless the recipient muted the sender.
 */

export type WaveResult = { ok: boolean; message: string };

const uuidSchema = z.string().uuid();

export async function sendWave(userId: string, targetUserId: string): Promise<WaveResult> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return { ok: false, message: "This action needs the server database configuration." };
  if (!uuidSchema.safeParse(targetUserId).success) return { ok: false, message: "Choose a Muddy before waving." };
  if (userId === targetUserId) return { ok: false, message: "You cannot wave at yourself." };

  const admin = createSupabaseAdminClient();
  const [mutual, blocked] = await Promise.all([
    areApprovedMuddies(admin, userId, targetUserId),
    isBlockedEitherDirection(admin, userId, targetUserId)
  ]);
  if (!mutual || blocked) return { ok: false, message: "You can only wave at approved Muddies." };

  const { data: lastWave } = await admin
    .from("waves")
    .select("sent_at")
    .eq("sender_id", userId)
    .eq("recipient_id", targetUserId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (wavePairCooldownRemaining(lastWave ? Date.parse(lastWave.sent_at) : null, Date.now()) > 0) {
    return { ok: true, message: "You already waved recently. Give them a little time." };
  }

  for (const action of ["waves.send", "waves.send.daily"] as const) {
    const rate = await consumeRateLimit({ action, userId });
    if (!rate.allowed) return { ok: false, message: rateLimitMessage(rate.resetAt) };
  }

  const { error } = await admin
    .from("waves")
    .insert({ sender_id: userId, recipient_id: targetUserId, source: "proximity_card" });
  if (error) return { ok: false, message: "Your wave was not sent. Try again." };

  const { data: mute } = await admin
    .from("wave_mutes")
    .select("id")
    .eq("user_id", targetUserId)
    .eq("muted_user_id", userId)
    .maybeSingle();

  if (!mute) {
    const { data: sender } = await admin.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
    const name = sender?.full_name?.trim() || "A Muddy";
    await deliverNotification(admin, {
      userId: targetUserId,
      senderId: userId,
      category: "waves",
      type: `wave:${userId}`,
      title: `${name} waved at you`,
      message: `${name} waved at you 👋 Wave back or send a Meet Ping.`
    });
  }

  return { ok: true, message: "Wave sent 👋" };
}
