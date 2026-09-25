/**
 * Event artwork resolution (Ranked Events Discovery).
 *
 * Covers are private media assets referenced by events.cover_media_id. A
 * signed URL may be temporarily absent even when the cover still exists;
 * EventArtwork renders this fallback while it renews that credential.
 * Legacy events without a cover use the same treatment permanently.
 *
 * DETERMINISTIC BY EVENT ID. The same event always draws the same treatment,
 * on every device, on every render, server and client alike. A palette picked
 * at random per render would make the Home accordion flicker between colours
 * on hydration and make two screens disagree about the same event.
 */

/**
 * Fallback treatments, built from existing brand tokens rather than new
 * colours. Each is a gradient pair already present in the design system's
 * vocabulary, so each Events surface reads as Mad Buddy rather than as a stock
 * placeholder set.
 */
export const EVENT_FALLBACK_TREATMENTS = [
  { id: "ember", from: "#c96f18", to: "#4e0401" },
  { id: "amber", from: "#f2a855", to: "#c96f18" },
  { id: "dusk", from: "#9d1268", to: "#4e0401" },
  { id: "clay", from: "#d9482c", to: "#9d1268" },
  { id: "rust", from: "#e88c2b", to: "#b81a5c" }
] as const;

export type EventFallbackTreatment = (typeof EVENT_FALLBACK_TREATMENTS)[number];

export type EventMedia =
  | { kind: "image"; url: string }
  | { kind: "fallback"; treatment: EventFallbackTreatment };

/**
 * Stable string hash (FNV-1a). Chosen over anything involving Math.random or
 * Date so the result is identical between the server render and the client
 * hydration -- a mismatch here is a visible colour flip, not just a warning.
 */
function hashId(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function eventFallbackTreatment(eventId: string): EventFallbackTreatment {
  return EVENT_FALLBACK_TREATMENTS[hashId(eventId) % EVENT_FALLBACK_TREATMENTS.length];
}

/**
 * Resolves what a ranked event should render as artwork.
 *
 * An empty or whitespace-only url is treated as absent rather than trusted:
 * a blank string in the column would otherwise become <img src="">, which is
 * exactly the broken image this module exists to prevent.
 */
export function resolveEventMedia(eventId: string, imageUrl?: string | null): EventMedia {
  if (typeof imageUrl === "string" && imageUrl.trim().length > 0) {
    return { kind: "image", url: imageUrl.trim() };
  }
  return { kind: "fallback", treatment: eventFallbackTreatment(eventId) };
}

/** CSS gradient for a fallback treatment. One definition, used everywhere. */
export function fallbackGradient(treatment: EventFallbackTreatment): string {
  return `linear-gradient(150deg, ${treatment.from} 0%, ${treatment.to} 100%)`;
}
