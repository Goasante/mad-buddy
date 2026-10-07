import type { ApprovedSmartCardStateId } from "./catalog";
import type { SmartCard } from "./smart-card";

/** Stable catalog numbers for review; illustration families are mapped separately. */
export const SMART_CARD_SCENES = {
  core_fallback: 1,
  failed_action: 4,
  meetup_starting: 13,
  meetup_upcoming: 37,
  meetup_fallback: 58,
  event_invitation: 10,
  muddy_request: 11,
  notification_action_bundle: 12,
  nearby_muddy: 21,
  nearby_muddies: 22,
  event_live: 23,
  event_linkr_ready: 24,
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
  group_invitation: 39,
  message_context: 40,
  returning_user: 41,
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
} as const satisfies Record<ApprovedSmartCardStateId, number>;

/** Reviewed transparent scenes. Characters illustrate general social moments;
 * role-specific cards use activities and objects instead of invented people. */
export const SMART_CARD_ARTWORK_FILES = {
  core_fallback: "01-core-fallback.webp",
  failed_action: "04-failed-action.webp",
  meetup_starting: "13-plan-starting.webp",
  meetup_upcoming: "37-upcoming-plan.webp",
  meetup_fallback: "58-upfor-fallback.webp",
  event_invitation: "10-event-invitation.webp",
  muddy_request: "11-muddy-request.webp",
  notification_action_bundle: "12-needs-attention.webp",
  nearby_muddy: "21-muddy-nearby.webp",
  nearby_muddies: "22-muddies-nearby.webp",
  event_live: "23-event-live.webp",
  event_linkr_ready: "24-meet-at-event.webp",
  linkr_mutual_event: "26-event-connection.webp",
  linkr_mutual: "27-mutual-connection.webp",
  first_muddy: "28-first-muddy.webp",
  invited_friend_joined: "29-friend-joined.webp",
  muddy_birthday: "30-muddy-birthday.webp",
  birthday: "31-your-birthday.webp",
  event_friend_context: "32-go-with-muddies.webp",
  event_commitment_starting: "33-your-event-starting.webp",
  event_starting: "34-interested-event-starting.webp",
  event_saved: "35-saved-event.webp",
  linkr_opportunity: "36-shared-interest.webp",
  group_invitation: "39-group-invitation.webp",
  message_context: "40-message-context.webp",
  returning_user: "41-welcome-back.webp",
  profile_blocking: "43-complete-to-continue.webp",
  profile_completion: "44-your-profile.webp",
  notification_permission: "45-notification-permission.webp",
  location_permission: "46-turn-on-glow.webp",
  journey: "47-journey-next-step.webp",
  journey_complete: "48-journey-complete.webp",
  buddy_progress: "49-buddy-progress.webp",
  achievement: "50-achievement.webp",
  invite_prompt: "51-invite-a-friend.webp",
  contact_discovery: "52-find-your-circle.webp",
  walkthrough: "53-helpful-guide.webp",
  feature_announcement: "54-something-new.webp",
  offline_status: "55-waiting-for-connection.webp",
  access_status: "56-your-access.webp",
  suggestions: "57-people-to-connect.webp",
} as const satisfies Record<ApprovedSmartCardStateId, string>;

type ArtworkCard = { id: SmartCard["id"] | ApprovedSmartCardStateId; eyebrow?: string };

export function smartCardSceneNumber(card: ArtworkCard): number {
  return SMART_CARD_SCENES[card.id as ApprovedSmartCardStateId] ?? SMART_CARD_SCENES.core_fallback;
}

export function smartCardArtwork(card: ArtworkCard) {
  const scene = smartCardSceneNumber(card);
  const state = card.id as ApprovedSmartCardStateId;
  const file = SMART_CARD_ARTWORK_FILES[state] ?? SMART_CARD_ARTWORK_FILES.core_fallback;
  return { scene, src: `/illustrations/smart-card/scenes-v2/${file}` };
}
