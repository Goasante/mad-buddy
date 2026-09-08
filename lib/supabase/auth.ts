import { cache } from "react";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * TWO QUESTIONS, TWO ANSWERS.
 *
 * "Who does this request claim to be?" and "is that account still valid right
 * now?" are different questions with very different costs, and collapsing them
 * into one helper meant every caller silently paid for the expensive answer
 * whether or not it needed it.
 *
 *   getCurrentIdentity()   verifies the JWT locally against the project's
 *                          published JWKS. ~1ms. Proves the token is genuine
 *                          and unexpired. Says NOTHING about revocation.
 *
 *   getCurrentUserRecord() asks Supabase Auth for the current user record.
 *                          ~109ms locally, ~300ms against production. This is
 *                          the only one that notices a global sign-out or a
 *                          deleted account.
 *
 * MEASURED REVOCATION BEHAVIOUR (tested against a real auth server, not
 * assumed -- see PR #38):
 *
 *   event               getUser()        getClaims()
 *   ban_duration set    still accepted   still accepted
 *   global sign-out     REJECTED         accepted until exp
 *   user deleted        REJECTED         accepted until exp
 *
 * Access tokens live 3600s, so the identity path carries a revocation window
 * of up to 60 minutes for sign-out and deletion.
 *
 * AND RLS DOES NOT CLOSE THAT WINDOW. A globally signed-out token was still
 * accepted by PostgREST and still returned rows. "RLS protects it" is not a
 * valid reason to choose the identity path -- it was tested and it is false.
 *
 * So the rule is: anything privileged, destructive, or reached through
 * service-role authority must use `getCurrentUserRecord`. The identity path is
 * for rendering, routing, and reads where a ≤60-minute window is a decision
 * somebody made deliberately.
 */

/**
 * A verified caller, described only by what the token actually proves.
 *
 * Deliberately NOT a Supabase `User`. The previous version synthesised one --
 * including `created_at: ""` -- which invited callers to read fields the token
 * cannot vouch for. If a caller needs the real record, that is exactly the
 * signal it should be using `getCurrentUserRecord()` instead.
 */
export type CurrentIdentity = {
  userId: string;
  /**
   * The same value as `userId`.
   *
   * Kept so a caller that only ever read `user.id` can move to the identity
   * path by changing the function it calls, without a rename touching every
   * line -- churn that would make the security-relevant part of this change
   * hard to review. `userId` is the name to prefer in new code.
   */
  id: string;
  email?: string;
  phone?: string;
  role?: string;
  appMetadata: Record<string, unknown>;
  userMetadata: Record<string, unknown>;
};

/**
 * The verified identity for this request, from the JWT alone.
 *
 * THIS PROVES TOKEN VALIDITY, NOT CURRENT SERVER-SIDE SESSION OR USER
 * EXISTENCE. A globally signed-out or deleted account keeps a valid identity
 * here until its access token expires (up to 60 minutes). Use
 * `getCurrentUserRecord()` wherever that is unacceptable.
 *
 * `cache()` dedupes within a single render. Server actions are separate
 * requests and each gets its own cache, which is why the cost of the old
 * network check multiplied across the seven actions a conversation open fires.
 */
export const getCurrentIdentity = cache(async (): Promise<CurrentIdentity | null> => {
  const supabase = await createSupabaseServerClient();

  try {
    /* Guarded: `getClaims` is a newer method, and a test double or older SDK
       that lacks it must fall through rather than throw and take down every
       authenticated path. */
    const claimsResult =
      typeof supabase.auth.getClaims === "function"
        ? await withTimeout(supabase.auth.getClaims(), {
            operation: "getCurrentIdentity.claims",
            timeoutMs: 5_000
          })
        : null;

    if (claimsResult && !claimsResult.error && claimsResult.data?.claims?.sub) {
      const claims = claimsResult.data.claims as Record<string, unknown>;
      return {
        userId: claims.sub as string,
        id: claims.sub as string,
        email: typeof claims.email === "string" ? claims.email : undefined,
        phone: typeof claims.phone === "string" ? claims.phone : undefined,
        role: typeof claims.role === "string" ? claims.role : undefined,
        appMetadata: (claims.app_metadata as Record<string, unknown>) ?? {},
        userMetadata: (claims.user_metadata as Record<string, unknown>) ?? {}
      };
    }

    /* Anything getClaims could not settle -- a symmetric signing key, no
       WebCrypto, a shape it did not recognise -- falls through to the
       authoritative check rather than being read as signed out. */
    const user = await getCurrentUserRecord();
    if (!user) return null;

    return {
      userId: user.id,
      id: user.id,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      role: user.role ?? undefined,
      appMetadata: (user.app_metadata as Record<string, unknown>) ?? {},
      userMetadata: (user.user_metadata as Record<string, unknown>) ?? {}
    };
  } catch (error) {
    if (isRequestTimeoutError(error)) return null;
    throw error;
  }
});

/**
 * The authoritative Supabase user record, straight from Auth.
 *
 * A network round trip, and the point of it: this is what notices a global
 * sign-out or a deleted account. Required for privileged, destructive, or
 * service-role-backed work.
 *
 * Bounded to 5s, and a timeout is treated as signed out -- the same branch
 * every caller already handles. It never grants access; it only stops one slow
 * call from hanging a render.
 *
 * NOTE ON BANS: setting `ban_duration` did NOT cause this to reject an
 * already-issued token in testing. Mad Buddy's own restriction checks are what
 * enforce bans; do not read this helper as doing so.
 */
export const getCurrentUserRecord = cache(async () => {
  const supabase = await createSupabaseServerClient();

  try {
    const {
      data: { user },
      error
    } = await withTimeout(supabase.auth.getUser(), {
      operation: "getCurrentUserRecord",
      timeoutMs: 5_000
    });

    if (error) return null;
    return user;
  } catch (error) {
    if (isRequestTimeoutError(error)) return null;
    throw error;
  }
});

/** The verified identity, or a thrown error. Cheap; carries the ≤60min window. */
export async function requireCurrentIdentity(): Promise<CurrentIdentity> {
  const identity = await getCurrentIdentity();
  if (!identity) throw new Error("Authentication required.");
  return identity;
}

/** The authoritative user, or a thrown error. Costs a round trip; sees revocation. */
export async function requireCurrentUserRecord() {
  const user = await getCurrentUserRecord();
  if (!user) throw new Error("Authentication required.");
  return user;
}
