import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The authenticated user for the current request.
 *
 * `supabase.auth.getUser()` is a NETWORK round trip to Supabase's auth server
 * (it revalidates the JWT, it does not just decode it locally), and a single
 * authenticated page previously fired it 3-4 times — the middleware, this
 * layout, getSafetyAdminContext, and the page each called it independently.
 * Wrapping it in React `cache()` memoises the result for the lifetime of one
 * server render, so every caller within a request shares ONE round trip
 * instead of each paying for their own. Read-only, so caching is safe.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error) {
    return null;
  }

  return user;
});

export async function requireCurrentUser() {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Authentication required.");
  }

  return user;
}
