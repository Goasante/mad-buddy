import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { MilestoneName } from "@/lib/supabase/database.types";

/**
 * Onboarding server helpers (spec §63). These take the admin client, so they
 * deliberately live here rather than in the "use server" actions file, an
 * export from that file becomes a client-callable server action, which these
 * must never be.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Records an activation milestone. Idempotent: a milestone is reached once,
 * and re-reporting it is a no-op, so "first wave" stays the *first* wave.
 *
 * TECHNICAL DEBT -- TWO PERSISTENCE PATHS, DELIBERATELY TEMPORARY.
 *
 * This awaits the upsert and DISCARDS its error, so it can neither throw nor
 * report failure. That silence hid a real defect: first_message_sent was being
 * rejected by an environment whose CHECK constraint predated the name, and
 * nothing anywhere said so. The first-message caller in lib/messaging/mobile.ts
 * therefore duplicates this upsert in order to observe the error.
 *
 * The fix is to centralise here -- return the error (or a typed result) so
 * every caller can decide whether to log it -- rather than keeping two
 * implementations of the same write. Not done in this checkpoint because it
 * touches all seven callers and belongs in its own change.
 */
export async function recordMilestone(admin: Admin, userId: string, milestone: MilestoneName) {
  await admin
    .from("activation_milestones")
    .upsert({ user_id: userId, milestone }, { onConflict: "user_id,milestone", ignoreDuplicates: true });
}
