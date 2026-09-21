import "server-only";

/**
 * Did this account ever hold Welcome Access, whatever its state now?
 *
 * Welcome Access remains meaningful under the ads-first model: while active it
 * gives the account the same ad-free state as any other valid Access source.
 */
export async function hasEverHadWelcomeAccess(userId: string): Promise<boolean> {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("access_grants")
    .select("id")
    .eq("user_id", userId)
    .eq("source", "welcome_access")
    .limit(1);
  return (data ?? []).length > 0;
}
