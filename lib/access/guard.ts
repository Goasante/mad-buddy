import "server-only";

import { resolveAccessForUser, type AccessState } from "@/lib/access/resolver";

/**
 * SERVER ENFORCEMENT FOR THE TWO PAID SURFACES.
 *
 * Hiding a nav item is not enforcement. Every Linkr and UpFor mutation that
 * expands somebody's social world calls `requireAccess` and refuses without it,
 * so a hand-rolled fetch to a Server Action gets the same answer the UI does.
 *
 * ── WHAT IS GATED, AND WHAT IS NOT ────────────────────────────────────────
 *
 * The rule is a sentence, not a list: EXPIRY STOPS THE NEXT EXPANSION, IT NEVER
 * DESTROYS AN EXISTING COMMITMENT. Nobody pays to keep talking to someone they
 * already matched with, to keep a Plan they already made, or to leave.
 *
 * Gated (expanding your social world):
 *   Linkr  candidate feed, discovery filters, starting a session, Connect
 *   UpFor  the discovery feed, creating an UpFor, joining someone else's
 *
 * NEVER gated (your existing social world):
 *   an existing mutual Linkr connection and its conversation
 *   every message in it, in both directions
 *   a Plan already created from an UpFor, its chat and its participants
 *   leaving, cancelling, reporting, blocking
 *   all of Home, Muddies, Glow, Profile, Messages, Plans, Events, Safe Arrival
 *
 * That last group is why `AccessRequiredError` is deliberately narrow: it is
 * thrown by a handful of named entry points, not by a middleware that wraps
 * everything Linkr-shaped and accidentally catches a reply.
 */

/** The two surfaces that require Mad Buddy Access. */
export type PaidSurface = "linkr" | "upfor";

export type AccessDenied = {
  ok: false;
  reason: "access_required";
  surface: PaidSurface;
  /** User-facing, honest, and never a countdown or a scarcity claim. */
  message: string;
  /** So the UI can explain what ended, rather than guessing. */
  hadWelcomeAccess: boolean;
};

export type AccessGranted = { ok: true; access: AccessState };

export type AccessResult = AccessGranted | AccessDenied;

const SURFACE_LABEL: Record<PaidSurface, string> = {
  linkr: "Linkr",
  upfor: "UpFor"
};

/**
 * Copy for the denial path.
 *
 * Two rules, both from the constitution. It must never imply that Mad Buddy
 * itself has expired -- the overwhelming majority of the product is still free,
 * and a message that reads "your access has ended" without saying what remains
 * is a dark pattern by omission. And it states plainly that nothing was
 * charged, because no payment method was ever taken.
 */
function deniedMessage(surface: PaidSurface): string {
  return (
    `${SURFACE_LABEL[surface]} needs Mad Buddy Access. ` +
    "Muddies, Messages, Plans, Events, Glow and Safe Arrival stay free, " +
    "and your existing connections and conversations are unaffected."
  );
}

/**
 * Resolve access and return a result rather than throwing.
 *
 * Preferred inside Server Actions, which already return
 * `{ ok: false, message }` shapes -- an entitlement failure is an ordinary
 * outcome there, not an exception.
 */
export async function checkAccess(userId: string, surface: PaidSurface): Promise<AccessResult> {
  /* NO CACHE, DELIBERATELY.
   *
   * This resolves against the database on every mutation. A cached entitlement
   * is the classic way an expired or revoked user keeps mutating: the cache
   * outlives the revocation. Since the read is a handful of indexed lookups on
   * `user_id` and runs only on paid-surface mutations -- not on every page --
   * the correct-by-construction version is also fast enough, and there is no
   * staleness window to reason about. */
  const access = await resolveAccessForUser(userId);

  if (access.hasAccess) return { ok: true, access };

  /* Whether they ONCE had welcome access changes the honest explanation:
     "your Welcome Access has ended" versus "this needs Mad Buddy Access". */
  const hadWelcome = await hasEverHadWelcomeAccess(userId);

  return {
    ok: false,
    reason: "access_required",
    surface,
    message: deniedMessage(surface),
    hadWelcomeAccess: hadWelcome
  };
}

/**
 * Throwing variant, for call sites that are not Server Actions (route handlers,
 * service functions whose contract is to throw).
 */
export class AccessRequiredError extends Error {
  readonly reason = "access_required" as const;
  readonly surface: PaidSurface;
  readonly hadWelcomeAccess: boolean;

  constructor(denial: AccessDenied) {
    super(denial.message);
    this.name = "AccessRequiredError";
    this.surface = denial.surface;
    this.hadWelcomeAccess = denial.hadWelcomeAccess;
  }
}

export async function requireAccess(userId: string, surface: PaidSurface): Promise<AccessState> {
  const result = await checkAccess(userId, surface);
  if (!result.ok) throw new AccessRequiredError(result);
  return result.access;
}

/**
 * Did this account ever hold welcome access, whatever its state now?
 *
 * Reads the grant row directly rather than the resolver, because the resolver
 * only reports CURRENTLY VALID sources and this question is about the past.
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
