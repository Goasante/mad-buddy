import type { ApprovedSmartCardStateId } from "./catalog";
import type { SmartCard } from "./smart-card";

/** Reviewed scene artwork. Sheets are retained intact; the SVG viewport only
 * exposes the illustration, never the review-sheet title or other scenarios.
 * Decorative people depict a moment, never a named user's identity. */
export const SMART_CARD_SCENES = {
  core_fallback: 1,
  safe_arrival_overdue: 2,
  safe_arrival_action: 3,
  failed_action: 4,
  plan_rsvp: 5,
  plan_decision: 6,
  plan_changed: 7,
  upfor_requests: 8,
  safe_arrival_watcher_request: 9,
  event_invitation: 10,
  muddy_request: 11,
  notification_action_bundle: 12,
  plan_starting: 13,
  upfor_active_muddy: 14,
  upfor_opportunity: 15,
  upfor_momentum: 16,
  upfor_accepted: 17,
  upfor_plan_chat_ready: 18,
  owned_upfor_live: 19,
  owned_upfor_starting: 20,
  nearby_muddy: 21,
  nearby_muddies: 22,
  event_live: 23,
  event_linkr_ready: 24,
  plan_chat_decision: 25,
  linkr_mutual_event: 26,
  linkr_mutual: 27,
  first_muddy: 28,
  invited_friend_joined: 29,
  muddy_birthday: 30,
  birthday: 31,
  event_friend_context: 32,
  event_commitment_starting: 33,
  event_starting: 34,
  event_saved: 35,
  linkr_opportunity: 36,
  plan_upcoming: 37,
  upfor_scheduled: 38,
  group_invitation: 39,
  message_context: 40,
  returning_user: 41,
  weekend_plans: 42,
  profile_blocking: 43,
  profile_completion: 44,
  notification_permission: 45,
  location_permission: 46,
  journey: 47,
  journey_complete: 48,
  buddy_progress: 49,
  achievement: 50,
  invite_prompt: 51,
  contact_discovery: 52,
  walkthrough: 53,
  feature_announcement: 54,
  offline_status: 55,
  access_status: 56,
  suggestions: 57,
  upfor_fallback: 58,
} as const satisfies Record<ApprovedSmartCardStateId, number>;

const SHEET_CROPS = [
  { x: [26, 360, 694], y: [120, 449, 784, 1116], height: [240, 240, 238, 280], width: 304 },
  { x: [28, 366, 704], y: [130, 454, 784, 1112], height: [245, 240, 235, 270], width: 286 },
  { x: [30, 365, 700], y: [125, 458, 789, 1117], height: [250, 245, 245, 270], width: 289 },
  { x: [30, 366, 704], y: [123, 453, 786, 1116], height: [245, 245, 240, 232], width: 284 },
  { x: [55, 544], y: [114, 389, 690, 965, 1238], height: [194, 184, 189, 186, 206], width: 412 }
] as const;

export function smartCardSceneNumber(card: Pick<SmartCard, "id" | "eyebrow">): number {
  if (card.id === "safe_arrival") return card.eyebrow?.includes("CHECK IN") ? 2 : 3;
  return SMART_CARD_SCENES[card.id as ApprovedSmartCardStateId] ?? SMART_CARD_SCENES.core_fallback;
}

export function smartCardArtwork(card: Pick<SmartCard, "id" | "eyebrow">) {
  const scene = smartCardSceneNumber(card);
  const sheet = Math.floor((scene - 1) / 12);
  const index = (scene - 1) % 12;
  const crop = SHEET_CROPS[sheet];
  const columns = crop.x.length;
  const row = Math.floor(index / columns);
  return {
    scene,
    src: `/illustrations/smart-card/scenarios-${sheet + 1}.webp`,
    viewBox: `${crop.x[index % columns]} ${crop.y[row]} ${crop.width} ${crop.height[row]}`
  };
}
