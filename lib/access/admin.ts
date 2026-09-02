import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AccessSourceName } from "@/lib/supabase/database.types";

/**
 * ADMIN ACCESS ADMINISTRATION.
 *
 * Grants, extensions, revocations and global windows -- the write side of the
 * entitlement model. The read side is `lib/access/resolver`, and these two are
 * the only modules that touch the access tables.
 *
 * ── ADMINS DO NOT FAKE PAYMENTS ───────────────────────────────────────────
 *
 * There is a deliberate absence here: nothing writes to `subscriptions`. An
 * admin who wants to give somebody access creates an `admin_grant`, which is
 * an honest record of what actually happened -- a human decided to give this
 * person access, for this reason, at this time. Writing a fake subscription
 * row instead would corrupt revenue reporting, confuse provider
 * reconciliation, and lie about how somebody got access. The resolver treats
 * both as valid, so nothing is lost by being truthful.
 *
 * ── GRANT DURATIONS ───────────────────────────────────────────────────────
 *
 * 14 days is the DEFAULT AUTOMATIC allowance, not a ceiling. Admin grants may
 * exceed it, and `indefinite` exists for staff and long-term arrangements.
 */

export const GRANT_DURATIONS = {
  "7d": { label: "7 days", days: 7 },
  "14d": { label: "14 days", days: 14 },
  "30d": { label: "30 days", days: 30 },
  "3m": { label: "3 months", days: 90 },
  "1y": { label: "1 year", days: 365 },
  indefinite: { label: "Indefinite", days: null }
} as const;

export type GrantDuration = keyof typeof GRANT_DURATIONS;

/**
 * Which durations a role may hand out.
 *
 * The principle is that reversible, time-boxed help is a support function,
 * while open-ended access is an ownership decision. A support agent resolving
 * "my access ended mid-conversation" needs days, not a year.
 *
 * `admin.entitlements.manage` is an EXISTING permission -- no new permission
 * was invented for this, and the role matrix in lib/admin/governance.ts is
 * unchanged.
 */
export const SUPPORT_MAX_GRANT_DAYS = 30;

export function durationAllowedForSupport(duration: GrantDuration): boolean {
  const days = GRANT_DURATIONS[duration].days;
  return days !== null && days <= SUPPORT_MAX_GRANT_DAYS;
}

function expiryFor(duration: GrantDuration, customExpiry: string | null, now: Date): string | null {
  if (customExpiry) return customExpiry;
  const days = GRANT_DURATIONS[duration].days;
  return days === null ? null : new Date(now.getTime() + days * 86_400_000).toISOString();
}

export type GrantAccessInput = {
  userId: string;
  actorId: string;
  duration: GrantDuration;
  /** Overrides `duration` when present. Must be in the future. */
  customExpiry?: string | null;
  reason: string;
};

export type AccessAdminResult =
  | { ok: true; grantId: string }
  | { ok: false; message: string };

/**
 * Grant access to one person.
 *
 * Always INSERTS. An extension is a new row rather than an edit of an old one,
 * so the history reads as a sequence of decisions -- "support gave 7 days, then
 * ops gave 30" -- instead of a single row whose original terms have been
 * overwritten and lost.
 */
export async function grantAccess(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: GrantAccessInput,
  now: Date = new Date()
): Promise<AccessAdminResult> {
  const reason = input.reason.trim();
  /* A REASON IS MANDATORY. Every grant is somebody deciding to give away a
     paid product; an audit trail of unexplained grants is not an audit trail. */
  if (reason.length < 3) {
    return { ok: false, message: "Give a reason for this grant." };
  }

  const expiresAt = expiryFor(input.duration, input.customExpiry ?? null, now);
  if (expiresAt !== null && Date.parse(expiresAt) <= now.getTime()) {
    return { ok: false, message: "That expiry is in the past." };
  }

  const { data, error } = await admin
    .from("access_grants")
    .insert({
      user_id: input.userId,
      source: "admin_grant" satisfies AccessSourceName,
      starts_at: now.toISOString(),
      expires_at: expiresAt,
      granted_by: input.actorId,
      reason
    })
    .select("id")
    .maybeSingle();

  if (error || !data) return { ok: false, message: "Couldn't record that grant." };
  return { ok: true, grantId: data.id };
}

/**
 * Revoke every currently-active admin grant for a person.
 *
 * SCOPED TO `admin_grant` ON PURPOSE. Revoking "access" as a concept would
 * mean cancelling somebody's paid subscription from a support screen, which is
 * a different decision with a refund attached. This revokes only what an admin
 * gave, and the resolver's union means the person keeps any subscription or
 * welcome window they still hold -- which is the correct outcome and the one a
 * precedence ladder gets wrong.
 */
export async function revokeAdminGrants(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: { userId: string; actorId: string; reason: string },
  now: Date = new Date()
): Promise<{ ok: true; revoked: number } | { ok: false; message: string }> {
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, message: "Give a reason for this revocation." };

  const nowIso = now.toISOString();
  const { data, error } = await admin
    .from("access_grants")
    .update({ revoked_at: nowIso, revoked_by: input.actorId, revoked_reason: reason })
    .eq("user_id", input.userId)
    .eq("source", "admin_grant")
    .is("revoked_at", null)
    .select("id");

  if (error) return { ok: false, message: "Couldn't revoke that grant." };
  return { ok: true, revoked: (data ?? []).length };
}

export type GlobalWindowInput = {
  actorId: string;
  duration: GrantDuration;
  customExpiry?: string | null;
  reason: string;
};

/**
 * Open Mad Buddy Access to everyone for a period.
 *
 * ONE ROW. Never a mass update of user rows -- see the migration for why: a
 * promotion that wrote to every user could not be ended without a second mass
 * update, and ending it would have to guess what each person's access was
 * before it started. Because this table never touches user rows, revoking a
 * window restores everybody to their own sources automatically.
 */
export async function openGlobalWindow(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: GlobalWindowInput,
  now: Date = new Date()
): Promise<AccessAdminResult> {
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, message: "Give a reason for this promotion." };

  const expiresAt = expiryFor(input.duration, input.customExpiry ?? null, now);
  if (expiresAt !== null && Date.parse(expiresAt) <= now.getTime()) {
    return { ok: false, message: "That end date is in the past." };
  }

  const { data, error } = await admin
    .from("access_global_windows")
    .insert({
      starts_at: now.toISOString(),
      expires_at: expiresAt,
      created_by: input.actorId,
      reason
    })
    .select("id")
    .maybeSingle();

  if (error || !data) return { ok: false, message: "Couldn't open that promotion." };
  return { ok: true, grantId: data.id };
}

export async function revokeGlobalWindow(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: { windowId: string; actorId: string; reason: string },
  now: Date = new Date()
): Promise<{ ok: true } | { ok: false; message: string }> {
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, message: "Give a reason for ending this promotion." };

  const { error } = await admin
    .from("access_global_windows")
    .update({ revoked_at: now.toISOString(), revoked_by: input.actorId, revoked_reason: reason })
    .eq("id", input.windowId)
    .is("revoked_at", null);

  if (error) return { ok: false, message: "Couldn't end that promotion." };
  return { ok: true };
}

/** Every global window, newest first, for the admin screen. */
export async function listGlobalWindows(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  limit = 20
) {
  const { data } = await admin
    .from("access_global_windows")
    .select("id, starts_at, expires_at, reason, created_by, revoked_at, revoked_by, revoked_reason, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/**
 * One person's full grant history, newest first.
 *
 * Includes revoked and expired rows: the question this answers is "what has
 * happened to this account", and hiding the revocations would defeat it.
 */
export async function listGrantsForUser(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  limit = 50
) {
  const { data } = await admin
    .from("access_grants")
    .select("id, source, starts_at, expires_at, granted_by, reason, revoked_at, revoked_by, revoked_reason, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/**
 * Presentation state for the global-window table, resolved once.
 *
 * A helper rather than inline JSX for two reasons. The clock is read a single
 * time, so two rows in the same table can never disagree about whether a window
 * is open. And it keeps `Date.now()` out of a React component body, where
 * reading it is impure -- the page renders the strings this returns and makes
 * no time decisions of its own.
 */
export function summarizeGlobalWindows(
  windows: Awaited<ReturnType<typeof listGlobalWindows>>,
  now: Date = new Date()
) {
  const nowMs = now.getTime();
  const rows = windows.map((row) => {
    const closed = Boolean(row.revoked_at);
    const lapsed = !closed && row.expires_at ? Date.parse(row.expires_at) <= nowMs : false;
    return {
      id: row.id,
      reason: row.reason,
      startedLabel: new Date(row.starts_at).toLocaleDateString(),
      endsLabel: row.expires_at ? new Date(row.expires_at).toLocaleDateString() : "Until revoked",
      state: closed ? "Closed" : lapsed ? "Ended" : "Open",
      isOpen: !closed && !lapsed,
      expiresAt: row.expires_at
    };
  });

  const open = rows.find((row) => row.isOpen);
  return {
    rows,
    openWindow: open
      ? {
          id: open.id,
          reason: open.reason,
          expiresLabel: open.expiresAt
            ? `until ${new Date(open.expiresAt).toLocaleString()}`
            : "until this window is closed"
        }
      : null
  };
}
