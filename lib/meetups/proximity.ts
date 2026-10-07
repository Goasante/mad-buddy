import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const MEETUP_FIX_MAX_AGE_MS = 2 * 60_000;

/**
 * Recomputes only the signed-in participant's coarse Meet Up journey state.
 * The database keeps the server-only beacon coordinates; clients only receive
 * waiting/on-the-way/approaching/nearby/at-spot/here/left.
 */
export async function refreshMeetupProximity(admin: Admin, actorId: string): Promise<number> {
  const result = await admin.rpc("refresh_meetup_proximity_server", { p_actor_id: actorId });
  if (result.error) throw result.error;
  return typeof result.data === "number" ? result.data : 0;
}
