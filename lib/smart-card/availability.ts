import { featureForHref, type FeatureAvailability } from "@/lib/features/availability";
import type { SmartCard } from "./smart-card";
/** Eligibility only: ranking, expiry and acknowledgements remain engine-owned. */
export function availableSmartCard(card: SmartCard | null, availability: FeatureAvailability): SmartCard | null {
  if (!card) return null;
  const family = card.id.startsWith("event_") ? "events" : card.id.startsWith("linkr_") || card.id === "profile_blocking" ? "linkr" : null;
  if (family && !availability[family]) return null;
  if (card.id === "event_linkr_ready" && !availability.linkr) return null;
  const feature = featureForHref(card.destination);
  // This card describes an existing obligation, never a suggestion to start.
  if (feature && !availability[feature]) return null;
  const secondary = card.secondaryAction ? featureForHref(card.secondaryAction.destination) : null;
  return secondary && !availability[secondary] ? { ...card, secondaryAction: undefined } : card;
}
