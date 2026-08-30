/**
 * Canonical IANA timezone validation and same-day arithmetic.
 *
 * Built for UpFor's "Later today" rule, but deliberately generic and dependency
 * free so `plans.timezone` -- which today accepts any string under 60 characters
 * without checking it names a real zone -- can migrate onto the same authority
 * in its own controlled pass. That is tracked as separate hardening; nothing
 * here changes Plans.
 *
 * No date library. `Intl` is already in the runtime, already used for exactly
 * this in lib/notifications/preferences.ts, and handles DST transitions
 * correctly -- which matters for Europe/London or America/New_York even though
 * Ghana itself never shifts.
 */

/**
 * Whether `value` names a real IANA zone THIS runtime can resolve.
 *
 * Validated by construction rather than against a hardcoded list: a list would
 * drift as the tz database is updated, and would reject a zone the platform
 * actually supports. `Intl.DateTimeFormat` throws RangeError on an unknown or
 * malformed identifier, which is the check.
 *
 * Note what this can and cannot establish. It proves the submitted string is a
 * real timezone and that the timestamps are internally consistent with it. It
 * CANNOT prove the device or person is physically in that zone -- there is no
 * account-level timezone authority to compare against. That is acceptable here
 * because choosing a different zone cannot create an extra UpFor: the
 * concurrent ceiling is enforced by row count, never by the clock.
 */
export function isValidTimeZone(value: string): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 60) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The local calendar day, as "YYYY-MM-DD", for an instant in a zone.
 *
 * "en-CA" because it formats as ISO-ordered year-month-day, so the string sorts
 * and compares correctly without any parsing.
 */
export function localDayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

/**
 * Whether two instants fall on the same local calendar day in a zone.
 *
 * This is what "Later today" means, and why it cannot be
 * `DATE(ts AT TIME ZONE 'UTC')`: at 22:00 in Accra it is already tomorrow in
 * UTC+3 and still today in UTC, so a UTC comparison would accept and reject the
 * wrong requests depending on where the person is.
 */
export function isSameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  return localDayKey(a, timeZone) === localDayKey(b, timeZone);
}

export type LaterTodayRejection =
  | "invalid_timezone"
  | "invalid_timestamp"
  | "not_in_future"
  | "not_today";

/**
 * The server-side "Later today" rule, in one place.
 *
 * A start is acceptable only when it is strictly in the future AND lands on the
 * same local calendar day as the moment the server evaluated it. That rejects
 * a past time, a time earlier today, tomorrow, and yesterday -- without ever
 * needing a future-day picker to exist.
 *
 * The caller supplies intent; this decides. Client time is never trusted: `now`
 * is the server's clock, and a manipulated device clock changes nothing here.
 */
export function validateLaterToday(
  startsAt: Date,
  now: Date,
  timeZone: string
): { ok: true } | { ok: false; reason: LaterTodayRejection } {
  if (!isValidTimeZone(timeZone)) return { ok: false, reason: "invalid_timezone" };
  if (!Number.isFinite(startsAt.getTime())) return { ok: false, reason: "invalid_timestamp" };
  if (startsAt.getTime() <= now.getTime()) return { ok: false, reason: "not_in_future" };
  if (!isSameLocalDay(startsAt, now, timeZone)) return { ok: false, reason: "not_today" };
  return { ok: true };
}
