import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { MilestoneName } from "@/lib/supabase/database.types";

/**
 * Onboarding server helpers (spec §63). These take the admin client, so they
 * deliberately live here rather than in the "use server" actions file — an
 * export from that file becomes a client-callable server action, which these
 * must never be.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Records an activation milestone. Idempotent: a milestone is reached once,
 * and re-reporting it is a no-op, so "first wave" stays the *first* wave.
 */
export async function recordMilestone(admin: Admin, userId: string, milestone: MilestoneName) {
  await admin
    .from("activation_milestones")
    .upsert({ user_id: userId, milestone }, { onConflict: "user_id,milestone", ignoreDuplicates: true });
}
