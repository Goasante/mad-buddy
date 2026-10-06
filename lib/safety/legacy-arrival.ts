/** Preserve existing journey lifecycle APIs, but no longer start new journeys. */
export function acceptsNewSafeArrivalJourneys(): boolean { return false; }
export const SAFE_ARRIVAL_REPLACED_MESSAGE = "New arrangements now use Meet Up. Open Meet Up to invite a Muddy or agree somewhere to meet. Your existing journeys are still supported.";
