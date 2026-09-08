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
    /* LOCAL VERIFICATION FIRST.
     *
     * `getClaims()` cryptographically verifies the JWT against the project's
     * published JWKS instead of asking the auth server who the token belongs
     * to. It is the same guarantee -- a forged or tampered token fails
     * signature verification, and an expired one fails the exp check -- but it
     * costs microseconds rather than a network round trip.
     *
     * `cache()` above only dedupes within ONE render. Server actions are
     * separate requests, so a screen that fires several of them paid a full
     * round trip per action: opening one conversation ran seven actions and
     * therefore seven auth round trips, which is what pushed messaging past
     * the client's 15s timeout and produced "took too long" for a single user
     * against 237 messages.
     *
     * It falls back to `getUser()` by itself when the project signs with a
     * symmetric key or WebCrypto is unavailable, so this is safe regardless of
     * how a given environment is configured. */
    /* Guarded because `getClaims` is a newer method: an older SDK, or a test
       double that only implements what it needs, would otherwise throw here
       and take down every authenticated path. Missing method simply means
       fall through to the authoritative check below. */
    const claimsResult =
      typeof supabase.auth.getClaims === "function"
        ? await withTimeout(supabase.auth.getClaims(), {
            operation: "getCurrentUser.claims",
            timeoutMs: 5_000
          })
        : null;

    if (claimsResult && !claimsResult.error && claimsResult.data?.claims?.sub) {
      const claims = claimsResult.data;
      /* Shaped like the `getUser()` result the callers already expect. `sub`
         is the user id; the rest of the claim set carries the same identity
         fields the session was issued with. */
      const payload = claims.claims as Record<string, unknown>;
      return {
        id: payload.sub as string,
        email: (payload.email as string | undefined) ?? undefined,
        phone: (payload.phone as string | undefined) ?? undefined,
        app_metadata: (payload.app_metadata as Record<string, unknown> | undefined) ?? {},
        user_metadata: (payload.user_metadata as Record<string, unknown> | undefined) ?? {},
        aud: (payload.aud as string | undefined) ?? "authenticated",
        created_at: ""
      } as Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"];
    }

    /* Anything getClaims could not settle falls through to the authoritative
       check rather than being treated as signed out. */
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
