"use server";

import { revalidatePath } from "next/cache";
import { ACHIEVEMENT_BY_CODE } from "@/lib/achievements/achievement-catalog";
import { acknowledgeSmartCard } from "@/lib/smart-card/smart-card-service";
import { SMART_CARD_IDS } from "@/lib/smart-card/smart-card";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Permanently retire a dismissible Smart Card for the signed-in user.
 *
 * The card id is validated against the canonical list rather than trusted
 * from the client, so this cannot be used to write arbitrary rows. Home is
 * revalidated so the engine advances to the next applicable card immediately.
 */
export async function acknowledgeSmartCardAction(acknowledgementKey: string): Promise<void> {
  const isOrdinaryCardId = (SMART_CARD_IDS as readonly string[]).includes(acknowledgementKey);
  const achievementCode = acknowledgementKey.startsWith("achievement:")
    ? acknowledgementKey.slice("achievement:".length)
    : null;
  const isKnownAchievement =
    achievementCode !== null && ACHIEVEMENT_BY_CODE.has(achievementCode);

  /*
   * The client may name only a canonical one-off card id or a real achievement
   * code from the canonical catalog. That keeps the acknowledgement table from
   * becoming an arbitrary user-controlled string store while allowing
   * repeatable achievement cards to retire independently.
   */
  if (!isOrdinaryCardId && !isKnownAchievement) return;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return;

  await acknowledgeSmartCard(user.id, acknowledgementKey);
  revalidatePath("/dashboard");
}
