/**
 * The clock times a "Later today" UpFor may still start at.
 *
 * The server is authoritative -- `validateLaterToday` decides -- but the UI
 * should not cheerfully offer 18:00 at 22:40 and wait to be told no. This
 * generates only slots that are genuinely still available today, so the picker
 * is empty rather than misleading when the day has run out.
 *
 * Pure and clock-injected, so every boundary is testable without waiting for
 * an actual evening.
 */

/** How far ahead the first offered slot sits, so "later" is meaningfully later. */
export const UPFOR_MIN_LEAD_MINUTES = 15;

/** Slot granularity. Half-hours read as a decision; five-minute slots read as a form. */
export const UPFOR_SLOT_MINUTES = 30;

export type UpForTimeSlot = {
  /** Absolute instant, the only thing ever sent to the server. */
  iso: string;
  /** "6:30 PM" in the viewer's locale and zone. */
  label: string;
};

/**
 * Slots from the next half-hour boundary at least MIN_LEAD ahead, up to the end
 * of the local day.
 *
 * Uses the SAME zone the server will judge against, so what the picker offers
 * and what the server accepts cannot disagree. An empty array is a real answer:
 * late at night there is no valid "later today", and the UI says so rather than
 * offering something that will be rejected.
 */
export function upForTimeSlots(now: Date, timeZone: string, maxSlots = 48): UpForTimeSlot[] {
  const parts = localParts(now, timeZone);
  if (!parts) return [];

  const nowMinutes = parts.hour * 60 + parts.minute;
  const earliest = nowMinutes + UPFOR_MIN_LEAD_MINUTES;
  // Round UP to the next slot boundary, so the first option is never sooner
  // than the lead time.
  let slot = Math.ceil(earliest / UPFOR_SLOT_MINUTES) * UPFOR_SLOT_MINUTES;

  const slots: UpForTimeSlot[] = [];
  // 24*60 is the end of the local day. A slot exactly at midnight belongs to
  // tomorrow, so the range is exclusive.
  while (slot < 24 * 60 && slots.length < maxSlots) {
    const iso = instantForLocalMinute(now, timeZone, slot);
    if (iso) {
      slots.push({ iso, label: formatSlot(iso, timeZone) });
    }
    slot += UPFOR_SLOT_MINUTES;
  }
  return slots;
}

/** Local hour/minute/day for an instant, or null if the zone is unusable. */
function localParts(date: Date, timeZone: string): { hour: number; minute: number; day: string } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hourCycle: "h23"
    });
    const parts = fmt.formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const hour = Number(get("hour"));
    const minute = Number(get("minute"));
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return { hour, minute, day: `${get("year")}-${get("month")}-${get("day")}` };
  } catch {
    return null;
  }
}

/**
 * The absolute instant of a given local minute-of-day, today, in a zone.
 *
 * Derived by offsetting from `now` rather than by constructing a local date
 * string, because the offset is what the zone actually applies at that moment
 * -- which is how a DST day (23 or 25 hours long) stays correct without any
 * special-casing. The result is re-checked: if it lands on a different local
 * day, the slot does not exist today and is dropped.
 */
function instantForLocalMinute(now: Date, timeZone: string, minuteOfDay: number): string | null {
  const parts = localParts(now, timeZone);
  if (!parts) return null;
  const deltaMinutes = minuteOfDay - (parts.hour * 60 + parts.minute);
  const candidate = new Date(now.getTime() + deltaMinutes * 60_000);

  const candidateParts = localParts(candidate, timeZone);
  if (!candidateParts || candidateParts.day !== parts.day) return null;
  return candidate.toISOString();
}

function formatSlot(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(iso));
}

/** The viewer's own zone, for both the picker and the value sent to the server. */
export function resolveViewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
