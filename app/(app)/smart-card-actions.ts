"use server";

import { revalidatePath } from "next/cache";
import { ACHIEVEMENT_BY_CODE } from "@/lib/achievements/achievement-catalog";
import { acknowledgeSmartCard } from "@/lib/smart-card/smart-card-service";
import { DISMISSIBLE_SMART_CARD_IDS } from "@/lib/smart-card/smart-card";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Permanently retire a dismissible Smart Card for the signed-in user.
 *
 * The card id is validated against the canonical list rather than trusted
 * from the client, so this cannot be used to write arbitrary rows. Home is
 * revalidated so the engine advances to the next applicable card immediately.
 */
export async function acknowledgeSmartCardAction(acknowledgementKey: string): Promise<void> {
  const isOrdinaryDismissible = (DISMISSIBLE_SMART_CARD_IDS as readonly string[]).includes(
    acknowledgementKey
  );
  const achievementCode = acknowledgementKey.startsWith("achievement:")
    ? acknowledgementKey.slice("achievement:".length)
    : null;
  const isKnownAchievement =
    achievementCode !== null && ACHIEVEMENT_BY_CODE.has(achievementCode);

  /*
   * Only genuinely dismissible presentation moments may write an
   * acknowledgement. In particular, a forged call with "safe_arrival",
   * "plan_rsvp" or another live-state id must never create a row that could
   * suppress a future safety/coordination card.
   */
  if (!isOrdinaryDismissible && !isKnownAchievement) return;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return;

  if (achievementCode) {
    /*
     * The catalog proves the code exists; the owner's row proves THIS user
     * actually earned it. Without this check somebody could pre-dismiss a
     * future badge by calling the server action directly before earning it.
     */
    const { data: earned } = await supabase
      .from("user_achievements")
      .select("achievement_code")
      .eq("user_id", user.id)
      .eq("achievement_code", achievementCode)
      .maybeSingle();
    if (!earned) return;
  }

  await acknowledgeSmartCard(user.id, acknowledgementKey);
  revalidatePath("/dashboard");
}
