import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard, type SmartCard } from "@/lib/smart-card/smart-card";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Cards the user has permanently retired by acknowledging them.
 *
 * Best-effort: if this read fails the user simply sees the card again, which
 * is a far better failure than Home losing its Smart Card entirely.
 */
export async function loadAcknowledgedSmartCardIds(
  admin: Admin,
  userId: string
): Promise<ReadonlySet<string>> {
  const { data, error } = await admin
    .from("smart_card_acknowledgements")
    .select("card_id")
    .eq("user_id", userId);

  if (error) return new Set<string>();
  return new Set((data ?? []).map((row) => row.card_id));
}

/**
 * Record that the user acknowledged a card. Idempotent: the unique constraint
 * makes a repeat acknowledgement a no-op rather than an error, so callers do
 * not need to check first.
 */
export async function acknowledgeSmartCard(userId: string, cardId: string): Promise<void> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return;

  const admin = createSupabaseAdminClient();
  await admin
    .from("smart_card_acknowledgements")
    .upsert({ user_id: userId, card_id: cardId }, { onConflict: "user_id,card_id" });
}

/**
 * Select the one Smart Card Home renders.
 *
 * Takes the already-loaded Home data rather than re-querying it: Home
 * resolves the Journey, Safe Arrival, plans and Buddy Score in a single
 * parallel batch, and this engine is a pure selection over that batch plus
 * one small acknowledgement read.
 */
export async function loadSmartCard(
  userId: string,
  input: Omit<SmartCardInput, "now"> & { now?: Date }
): Promise<SmartCard | null> {
  const now = input.now ?? new Date();
  const env = getSupabaseServerEnv();

  const acknowledgedIds =
    env.url && env.serviceRoleKey
      ? await loadAcknowledgedSmartCardIds(createSupabaseAdminClient(), userId)
      : new Set<string>();

  return resolveSmartCard(smartCardProviders({ ...input, now }), {
    now: now.getTime(),
    acknowledgedIds
  });
}
