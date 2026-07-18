// Shared Socialize domain constants and types. Client-safe (no server-only):
// imported by both the server actions and the page UI so the enum, labels and
// tier→proximity mapping have a single source of truth.

import type { ProximityLevel } from "@/lib/proximity";

export type SocializeActivity = "anything" | "coffee" | "food" | "walk" | "study" | "event";
export type SocializeAreaTier = "close_by" | "nearby" | "wider_area";
export type SocializeDuration = "30m" | "1h" | "3h";

export type SocializePresentationState =
  | "inactive"
  | "configuring"
  | "activating"
  | "active"
  | "updating"
  | "expired"
  | "error";

export const SOCIALIZE_ACTIVITIES: Array<{ id: SocializeActivity; label: string }> = [
  { id: "anything", label: "Anything" },
  { id: "coffee", label: "Coffee" },
  { id: "food", label: "Food" },
  { id: "walk", label: "A walk" },
  { id: "study", label: "Study session" },
  { id: "event", label: "An event" }
];

export const SOCIALIZE_AREA_TIERS: Array<{ id: SocializeAreaTier; label: string }> = [
  { id: "close_by", label: "Close by" },
  { id: "nearby", label: "Nearby" },
  { id: "wider_area", label: "Wider area" }
];

export const SOCIALIZE_DURATIONS: Array<{ id: SocializeDuration; label: string; ms: number }> = [
  { id: "30m", label: "30 minutes", ms: 30 * 60 * 1000 },
  { id: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { id: "3h", label: "3 hours", ms: 3 * 60 * 60 * 1000 }
];

export const SOCIALIZE_ACTIVITY_LABELS: Record<SocializeActivity, string> = Object.fromEntries(
  SOCIALIZE_ACTIVITIES.map((option) => [option.id, option.label])
) as Record<SocializeActivity, string>;

export const SOCIALIZE_AREA_LABELS: Record<SocializeAreaTier, string> = Object.fromEntries(
  SOCIALIZE_AREA_TIERS.map((option) => [option.id, option.label])
) as Record<SocializeAreaTier, string>;

// Server-controlled coarse thresholds: an area tier maps to the set of broad
// proximity tiers it admits. Distance stays server-side; the client only ever
// sends the tier and only ever receives these labels.
export const AREA_TIER_PROXIMITY: Record<SocializeAreaTier, ReadonlyArray<ProximityLevel>> = {
  close_by: ["very_close"],
  nearby: ["very_close", "nearby"],
  wider_area: ["very_close", "nearby", "around"]
};

export function isSocializeActivity(value: unknown): value is SocializeActivity {
  return typeof value === "string" && value in SOCIALIZE_ACTIVITY_LABELS;
}

export function isSocializeAreaTier(value: unknown): value is SocializeAreaTier {
  return typeof value === "string" && value in SOCIALIZE_AREA_LABELS;
}
