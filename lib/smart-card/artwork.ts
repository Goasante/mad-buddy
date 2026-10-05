import type { ApprovedSmartCardStateId } from "./catalog";
import type { SmartCard } from "./smart-card";

/** Stable catalog numbers for review; illustration families are mapped separately. */
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

/** One neutral illustration family per scenario. No decorative character is
 * presented as the viewer or a named Muddy. Shared artwork never affects rank. */
export const SMART_CARD_ARTWORK_TILES = {
  core_fallback: 0, safe_arrival_overdue: 1, safe_arrival_action: 2,
  failed_action: 3, plan_rsvp: 4, plan_decision: 5, plan_changed: 6,
  upfor_requests: 4, safe_arrival_watcher_request: 1, event_invitation: 4,
  muddy_request: 4, notification_action_bundle: 7, plan_starting: 8,
  upfor_active_muddy: 9, upfor_opportunity: 0, upfor_momentum: 0,
  upfor_accepted: 4, upfor_plan_chat_ready: 7, owned_upfor_live: 9,
  owned_upfor_starting: 8, nearby_muddy: 9, nearby_muddies: 9,
  event_live: 10, event_linkr_ready: 11, plan_chat_decision: 5,
  linkr_mutual_event: 11, linkr_mutual: 11, first_muddy: 0,
  invited_friend_joined: 0, muddy_birthday: 12, birthday: 12,
  event_friend_context: 10, event_commitment_starting: 8,
  event_starting: 8, event_saved: 6, linkr_opportunity: 11,
  plan_upcoming: 8, upfor_scheduled: 8, group_invitation: 4,
  message_context: 7, returning_user: 0, weekend_plans: 6,
  profile_blocking: 13, profile_completion: 13,
  notification_permission: 7, location_permission: 9, journey: 14,
  journey_complete: 14, buddy_progress: 14, achievement: 14,
  invite_prompt: 4, contact_discovery: 0, walkthrough: 13,
  feature_announcement: 0, offline_status: 15, access_status: 2,
  suggestions: 0, upfor_fallback: 0,
} as const satisfies Record<ApprovedSmartCardStateId, number>;

type ArtworkCard = { id: SmartCard["id"] | ApprovedSmartCardStateId; eyebrow?: string };

export function smartCardSceneNumber(card: ArtworkCard): number {
  if (card.id === "safe_arrival") return card.eyebrow?.includes("CHECK IN") ? 2 : 3;
  return SMART_CARD_SCENES[card.id as ApprovedSmartCardStateId] ?? SMART_CARD_SCENES.core_fallback;
}

export function smartCardArtwork(card: ArtworkCard) {
  const scene = smartCardSceneNumber(card);
  const state = card.id === "safe_arrival"
    ? (scene === 2 ? "safe_arrival_overdue" : "safe_arrival_action")
    : card.id as ApprovedSmartCardStateId;
  const tile = SMART_CARD_ARTWORK_TILES[state] ?? SMART_CARD_ARTWORK_TILES.core_fallback;
  return {
    scene,
    tile,
    src: "/illustrations/smart-card/neutral-scenarios-v1.webp",
    viewBox: `${(tile % 4) * 256} ${Math.floor(tile / 4) * 256} 256 256`,
  };
}
