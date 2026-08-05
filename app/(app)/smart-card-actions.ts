"use server";

import { revalidatePath } from "next/cache";
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
export async function acknowledgeSmartCardAction(cardId: string): Promise<void> {
  if (!(SMART_CARD_IDS as readonly string[]).includes(cardId)) return;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return;

  await acknowledgeSmartCard(user.id, cardId);
  revalidatePath("/dashboard");
}
