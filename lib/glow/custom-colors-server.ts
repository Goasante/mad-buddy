import "server-only";

import { checkFeature, type Entitlements } from "@/lib/billing/entitlements";
import { resolveUserEntitlements } from "@/lib/billing/service";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * The owner's custom glow colours, as friendId → colorId. Cosmetic and
 * best-effort: a read failure yields an empty map so the glow simply falls
 * back to its default colour rather than failing the surrounding render.
 */
export async function loadFriendGlowColors(
  admin: Admin,
  ownerId: string,
  knownEntitlements?: Entitlements
): Promise<Record<string, string>> {
  // Read-time enforcement is required because downgrade intentionally keeps
  // saved preferences. Without this gate, an old paid colour would continue
  // rendering even though writes are correctly blocked.
  const entitlements = knownEntitlements ?? (await resolveUserEntitlements(admin, ownerId));
  if (!checkFeature(entitlements, "custom_glow_styles")) return {};

  const { data, error } = await admin
    .from("friend_glow_colors")
    .select("friend_id, color_id")
    .eq("owner_id", ownerId);

  if (error || !data) return {};

  const map: Record<string, string> = {};
  for (const row of data) map[row.friend_id] = row.color_id;
  return map;
}
