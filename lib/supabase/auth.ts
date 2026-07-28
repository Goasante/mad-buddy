import { cache } from "react";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
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
 *
 * That round trip previously had no timeout, so a slow/unreachable auth
 * endpoint stalled the entire page render (every authenticated Server
 * Component depends on this). Bounded to 5s, same as proxy.ts's own
 * independent getUser() call — on timeout this behaves like the existing
 * `error` branch (treated as signed out), which every caller already
 * handles correctly; it never grants access, it only stops one slow
 * network call from hanging the whole render.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createSupabaseServerClient();

  try {
    const {
      data: { user },
      error
    } = await withTimeout(supabase.auth.getUser(), { operation: "getCurrentUser", timeoutMs: 5_000 });

    if (error) {
      return null;
    }

    return user;
  } catch (error) {
    if (isRequestTimeoutError(error)) return null;
    throw error;
  }
});

export async function requireCurrentUser() {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Authentication required.");
  }

  return user;
}
