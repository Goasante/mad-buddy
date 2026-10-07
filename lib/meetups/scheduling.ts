/** Compare instants, not calendar days: later today is a valid meetup time. */
export function isFutureMeetupTime(value: string, nowMs = Date.now()): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > nowMs + 60_000;
}
