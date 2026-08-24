import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * THE ONE ENTITLEMENT AUTHORITY FOR MAD BUDDY ACCESS.
 *
 * Every server-side Linkr and UpFor decision resolves through this module and
 * nothing else. That is the point of it: the model it replaces ranked three
 * tiers (`free < buddy_plus < buddy_pro`) and was consulted ad hoc from a
 * dozen call sites, which is how a product ends up with a scattered
 * `isPremium` architecture that has to be rebuilt every time a new payment
 * provider appears.
 *
 * WHAT IS NOT AUTHORITY, stated because each has been treated as authority in
 * some codebase: the UI, the client, Paystack, Apple, Google, the admin
 * console, a cached boolean on `profiles`. All of them are inputs or consumers.
 * The database rows below, read at server time, are the authority.
 *
 * ── INDEPENDENT SOURCES, NOT A PRECEDENCE LADDER ──────────────────────────
 *
 * A person may hold several access sources at once. Access is the UNION: true
 * if any source is currently valid. `primarySource` names the most durable one
 * for display, but it is a label, never the decision.
 *
 * This matters for a specific failure the brief calls out. Under a ladder,
 * revoking the top rung silently destroys access that a lower rung legitimately
 * granted -- revoke someone's admin grant and their paid subscription stops
 * working. Under a union, revoking one source leaves every other source intact,
 * which is the behaviour anybody would expect and the one that survives audit.
 *
 * ── TIME ──────────────────────────────────────────────────────────────────
 *
 * Expiry is evaluated against SERVER time, never the caller's clock. A device
 * clock, a timezone change, a reinstall and a logout are all incapable of
 * moving an expiry, because none of them can write to these tables.
 *
 * Expiry is also resolver-time rather than job-time: a grant whose `expires_at`
 * has passed is simply not counted. No background job has to flip thousands of
 * rows from active to expired for basic correctness -- jobs exist for reminders
 * and reconciliation, not to make expiry true.
 */

/** Kept in sync with the `public.access_source` enum. */
export type AccessSource =
  | "welcome_access"
  | "web_subscription"
  | "apple_subscription"
  | "google_subscription"
  | "admin_grant"
  | "staff"
  | "global_promo";

/** One currently-valid reason a person has access. */
export type ActiveAccessSource = {
  source: AccessSource;
  startsAt: string;
  /** ISO timestamp, or null for indefinite (staff, "until revoked"). */
  expiresAt: string | null;
};

export type AccessState = {
  hasAccess: boolean;
  /**
   * The most durable active source, for display. Indefinite beats dated;
   * among dated sources the one ending last wins. Null when there is no access.
   */
  primarySource: AccessSource | null;
  /** Every independently valid source. Empty when there is no access. */
  sources: ActiveAccessSource[];
  /**
   * When access ends, across all sources -- the LATEST expiry, because access
   * survives while any source is valid. Null means indefinite or no access;
   * `hasAccess` distinguishes those.
   */
  expiresAt: string | null;
  /** Whole days remaining, rounded up. Null for indefinite or no access. */
  daysRemaining: number | null;

  isWelcomeAccess: boolean;
  isPaid: boolean;
  isAdminGrant: boolean;
  isGlobalOverride: boolean;
  isStaff: boolean;
};

const PAID_SOURCES = new Set<AccessSource>([
  "web_subscription",
  "apple_subscription",
  "google_subscription"
]);

export const NO_ACCESS: AccessState = {
  hasAccess: false,
  primarySource: null,
  sources: [],
  expiresAt: null,
  daysRemaining: null,
  isWelcomeAccess: false,
  isPaid: false,
  isAdminGrant: false,
  isGlobalOverride: false,
  isStaff: false
};

/**
 * How durable a source is, for choosing what to DISPLAY. Not a precedence
 * ladder -- nothing here decides whether access exists, only which of several
 * true things to name first. Paid outranks welcome so a paying customer is
 * never told they are on a trial.
 */
const DISPLAY_RANK: Record<AccessSource, number> = {
  staff: 6,
  global_promo: 5,
  web_subscription: 4,
  apple_subscription: 4,
  google_subscription: 4,
  admin_grant: 3,
  welcome_access: 2
};

function buildState(sources: ActiveAccessSource[]): AccessState {
  if (sources.length === 0) return NO_ACCESS;

  const primary = [...sources].sort((a, b) => {
    const rank = DISPLAY_RANK[b.source] - DISPLAY_RANK[a.source];
    if (rank !== 0) return rank;
    // Indefinite is more durable than any date.
    if (a.expiresAt === null) return -1;
    if (b.expiresAt === null) return 1;
    return Date.parse(b.expiresAt) - Date.parse(a.expiresAt);
  })[0];

  /* The LATEST expiry across sources, because access persists while ANY source
     is valid. Reporting the earliest would tell a paying customer their access
     ends when their welcome window does. A single indefinite source means
     access has no end date at all. */
  const hasIndefinite = sources.some((s) => s.expiresAt === null);
  const expiresAt = hasIndefinite
    ? null
    : sources
        .map((s) => s.expiresAt as string)
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

  return {
    hasAccess: true,
    primarySource: primary.source,
    sources,
    expiresAt,
    daysRemaining: null, // filled by the caller that knows `now`
    isWelcomeAccess: sources.some((s) => s.source === "welcome_access"),
    isPaid: sources.some((s) => PAID_SOURCES.has(s.source)),
    isAdminGrant: sources.some((s) => s.source === "admin_grant"),
    isGlobalOverride: sources.some((s) => s.source === "global_promo"),
    isStaff: sources.some((s) => s.source === "staff")
  };
}

/** Whole days from `now` to `expiresAt`, rounded up; null when indefinite. */
function daysRemaining(expiresAt: string | null, now: Date): number | null {
  if (expiresAt === null) return null;
  const ms = Date.parse(expiresAt) - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/**
 * Resolve Mad Buddy Access for one user.
 *
 * `now` is injectable so expiry-boundary behaviour can be tested at the exact
 * second, but it defaults to server time and callers should let it. It is NOT a
 * way for a request to supply its own clock: this is a server-only module and
 * no route passes a caller-controlled value into it.
 */
export async function resolveAccessForUser(userId: string, now: Date = new Date()): Promise<AccessState> {
  const admin = createSupabaseAdminClient();
  const nowIso = now.toISOString();

  const [grantsResult, globalResult, staffResult, subscriptionResult] = await Promise.all([
    /* Active grants: started, not revoked, and either indefinite or not yet
       expired. Filtered in the query rather than in memory so a user with years
       of expired grants does not drag them all across the wire. */
    admin
      .from("access_grants")
      .select("source, starts_at, expires_at")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .lte("starts_at", nowIso)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`),

    admin
      .from("access_global_windows")
      .select("starts_at, expires_at")
      .is("revoked_at", null)
      .lte("starts_at", nowIso)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .limit(1),

    /* Staff access is derived from the admin directory rather than stored as a
       grant, so it cannot drift: revoking somebody's admin role revokes their
       access in the same action. `disabled_at` is honoured. */
    admin
      .from("admin_users")
      .select("role")
      .eq("auth_user_id", userId)
      .is("disabled_at", null)
      .maybeSingle(),

    loadPaidSubscription(admin, userId, nowIso)
  ]);

  const sources: ActiveAccessSource[] = [];

  for (const row of grantsResult.data ?? []) {
    sources.push({
      source: row.source as AccessSource,
      startsAt: row.starts_at,
      expiresAt: row.expires_at
    });
  }

  const globalWindow = (globalResult.data ?? [])[0];
  if (globalWindow) {
    sources.push({
      source: "global_promo",
      startsAt: globalWindow.starts_at,
      expiresAt: globalWindow.expires_at
    });
  }

  if (staffResult.data) {
    sources.push({ source: "staff", startsAt: nowIso, expiresAt: null });
  }

  if (subscriptionResult) sources.push(subscriptionResult);

  const state = buildState(sources);
  return { ...state, daysRemaining: daysRemaining(state.expiresAt, now) };
}

/**
 * The provider boundary.
 *
 * A subscription grants access when the provider's canonical state says it is
 * live -- `active` or `trialing`, or `past_due` inside its grace window. The
 * PROVIDER IS NOT THE AUTHORITY: this reads the local `subscriptions` row that
 * verified webhook processing wrote, never Paystack's API at request time. A
 * forged client callback cannot reach it, and a provider outage cannot revoke a
 * paid customer mid-request.
 *
 * `provider` is mapped to a source type so Apple and Google slot in without a
 * schema change or a second code path.
 */
async function loadPaidSubscription(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  nowIso: string
): Promise<ActiveAccessSource | null> {
  const { data } = await admin
    .from("subscriptions")
    .select("provider, status, current_period_start, current_period_end, grace_ends_at")
    .eq("user_id", userId)
    /* `non_renewing` IS live access.
     *
     * It means "cancelled, but paid through the end of the period" -- the
     * customer has already paid for time they have not used yet. Omitting it
     * revoked access the instant somebody cancelled, taking back a paid period
     * and punishing them for cancelling early rather than at the last minute.
     * Caught by scripts/hardening/access-payment-matrix.mjs.
     *
     * `current_period_end` still bounds it, so access ends when the paid period
     * genuinely runs out -- no job required. */
    .in("status", ["active", "trialing", "past_due", "non_renewing"])
    .order("current_period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  /* past_due keeps access only inside the grace window the billing service
     already maintains -- a failed renewal should not lock somebody out the
     instant a card is retried. */
  const periodEnd = data.current_period_end;
  const graceEnd = data.grace_ends_at;
  const effectiveEnd =
    data.status === "past_due"
      ? graceEnd
      : periodEnd ?? graceEnd;
  /* A cancelled-but-paid subscription is bounded by its period end, which the
     line above already selects. Nothing extra is needed for `non_renewing`. */

  if (effectiveEnd !== null && effectiveEnd !== undefined && Date.parse(effectiveEnd) <= Date.parse(nowIso)) {
    return null;
  }

  const source: AccessSource =
    data.provider === "apple"
      ? "apple_subscription"
      : data.provider === "google"
        ? "google_subscription"
        : "web_subscription";

  return {
    source,
    startsAt: data.current_period_start ?? nowIso,
    expiresAt: effectiveEnd ?? null
  };
}

/**
 * Batch variant, for surfaces that resolve many users at once (admin lists).
 * Same authority, same semantics -- it exists so a list view cannot be tempted
 * to invent a cheaper, subtly different rule.
 */
export async function resolveAccessForUsers(
  userIds: string[],
  now: Date = new Date()
): Promise<Map<string, AccessState>> {
  const unique = [...new Set(userIds)];
  const entries = await Promise.all(
    unique.map(async (id) => [id, await resolveAccessForUser(id, now)] as const)
  );
  return new Map(entries);
}
