import { SMART_CARD_APPROVED_STATES } from "@/lib/smart-card/catalog";

/**
 * WHERE EVERY APPROVED CATALOG STATE ACTUALLY LIVES.
 *
 * The catalog is a product VOCABULARY, not a quota: "54 approved states" was
 * never a target for 54 Card B providers. But an unexplained state is how a
 * later tranche talks itself into building a duplicate, so every one of them is
 * classified here exactly once, with the reason.
 *
 * The distinction that matters most is between the two kinds of absence:
 *
 *   OTHER_SURFACE   Home ALREADY says this, somewhere that is not Card B. A
 *                   Smart Card for it would be the same screen saying the same
 *                   thing twice, which is what the two-card split exists to
 *                   prevent. This is a finished answer, not a gap.
 *   NO_AUTHORITY    Nothing in the product can answer the question truthfully
 *                   yet. This IS a gap, and it names what is missing.
 *
 * Collapsing those two into one "deferred" bucket is what made the first
 * closeout misleading: it described settled ownership as though it were
 * missing work.
 */
export type SmartCardOwnership =
  | "CARD_B_WIRED"
  | "CARD_A_OWNED"
  | "NEARBY_HERO_OWNED"
  | "OTHER_SURFACE"
  | "NO_AUTHORITY"
  | "PRODUCT_PAUSED"
  | "LOW_VALUE_DUPLICATE";

export type SmartCardClassification = {
  ownership: SmartCardOwnership;
  /** Where it lives, or what is missing. One sentence. */
  reason: string;
};

export const SMART_CARD_STATE_OWNERSHIP: Record<string, SmartCardClassification> = {
  // ---- Tier 0: safety / truth -------------------------------------------
  safe_arrival_overdue: {
    ownership: "CARD_B_WIRED",
    reason: "The live-journey Smart Card covers overdue and action alike; one provider, one live state."
  },
  safe_arrival_action: {
    ownership: "CARD_B_WIRED",
    reason: "Same provider as safe_arrival_overdue -- the catalog splits what the product renders as one card."
  },
  failed_action: {
    ownership: "NO_AUTHORITY",
    reason: "No durable server-side failure queue exists; pending/failed sends live in the Messages page's own client state."
  },

  // ---- Tier 1: the viewer owes an answer ---------------------------------
  plan_rsvp: { ownership: "CARD_B_WIRED", reason: "Wired from the permission-filtered Home agenda." },
  plan_decision: { ownership: "CARD_B_WIRED", reason: "Open plan_polls with the viewer's vote missing, bounded by the agenda." },
  plan_changed: {
    ownership: "NO_AUTHORITY",
    reason: "No plan-edit action exists at all, and plan_participants.viewed_at is dead schema nothing writes -- both the change and the unseen-state halves are missing."
  },
  upfor_requests: { ownership: "CARD_B_WIRED", reason: "Wired from the batched Home UpFor context." },
  safe_arrival_watcher_request: {
    ownership: "OTHER_SURFACE",
    reason: "Home's own Safe Arrival section already lists watcher invitations with accept/decline; a Smart Card would duplicate it."
  },
  event_invitation: {
    ownership: "NO_AUTHORITY",
    reason: "No event_invitations table; RSVP is only interested/going/not_going. event_circle_invitations are Room invites, a different state."
  },
  muddy_request: { ownership: "CARD_B_WIRED", reason: "Wired from the incoming-request count Home already owns." },
  notification_action_bundle: {
    ownership: "NO_AUTHORITY",
    reason: "The only classification that exists is 'has a destination', which counts ordinary updates; a second actionability definition would give the product two answers."
  },

  // ---- Tier 2: something is happening now --------------------------------
  plan_starting: { ownership: "CARD_B_WIRED", reason: "Wired from the Home agenda." },
  upfor_active_muddy: { ownership: "CARD_B_WIRED", reason: "Wired from the Home UpFor context." },
  upfor_momentum: { ownership: "CARD_B_WIRED", reason: "Wired from the Home UpFor context." },
  upfor_accepted: { ownership: "CARD_B_WIRED", reason: "Wired from the Home UpFor context." },
  owned_upfor_starting: { ownership: "CARD_B_WIRED", reason: "Wired from the Home UpFor context." },
  nearby_muddy: { ownership: "NEARBY_HERO_OWNED", reason: "NearbyHero owns the proximity payoff, with avatars, Glow colour and its own actions." },
  nearby_muddies: { ownership: "NEARBY_HERO_OWNED", reason: "Excluded at engine selection so Card B returns the next best state instead." },
  event_live: { ownership: "CARD_B_WIRED", reason: "Wired from the Home agenda." },
  event_linkr_ready: { ownership: "CARD_B_WIRED", reason: "Offered only on the Events authority's no_consent answer against a live check-in." },
  plan_chat_decision: { ownership: "CARD_B_WIRED", reason: "Open chat_polls in Plan Chats the viewer has joined; structured decisions only, never message text." },
  event_commitment_starting: { ownership: "CARD_B_WIRED", reason: "Hosting or going, starting soon -- split from event_starting by commitment." },

  // ---- Tier 3: relationship momentum -------------------------------------
  linkr_mutual_event: { ownership: "CARD_B_WIRED", reason: "Uses the pair's stored linkr_connections.event_id, never inferred from attendance." },
  linkr_mutual: { ownership: "CARD_B_WIRED", reason: "Mutual connections only; one-sided interest is never fetched." },
  first_muddy: {
    ownership: "CARD_A_OWNED",
    reason: "FirstMuddyCard is the whole first-Muddy moment and REPLACES the activation card; Card B must not repeat it."
  },
  invited_friend_joined: {
    ownership: "NO_AUTHORITY",
    reason: "invite_signup is best-effort analytics via recordProductEvent, not a product reader -- and the joiner already reaches the viewer as a muddy_request."
  },
  muddy_birthday: { ownership: "CARD_B_WIRED", reason: "Reads the birthday delivery ledger; no other user's raw DOB is read." },
  birthday: { ownership: "CARD_B_WIRED", reason: "The viewer's own birthday, from their own date of birth." },

  // ---- Tier 4: useful opportunity ----------------------------------------
  event_friend_context: {
    ownership: "OTHER_SURFACE",
    reason: "Home's Trending Events rail (TopEventsHome) already ranks Events using Muddy attendance as a signal."
  },
  event_starting: { ownership: "CARD_B_WIRED", reason: "Interested-only, starting soon -- the non-commitment half of the Event split." },
  event_saved: {
    ownership: "OTHER_SURFACE",
    reason: "Home's Trending Events rail already carries saved/ranked Events; a card for one of them would duplicate the rail above it."
  },
  linkr_opportunity: {
    ownership: "NO_AUTHORITY",
    reason: "sharedInterests is internal to candidate ranking and never exposed on LinkrCandidate, so there is no grounded reason to show."
  },
  plan_upcoming: {
    ownership: "OTHER_SURFACE",
    reason: "Home's 'Coming Up' agenda section already lists upcoming Plans in full; Card B covers only the ones needing an ANSWER."
  },
  upfor_scheduled: { ownership: "CARD_B_WIRED", reason: "Wired from the Home UpFor context." },
  group_invitation: {
    ownership: "OTHER_SURFACE",
    reason: "Groups owns its invitations; no batched Home reader exists for them and adding one would duplicate that surface."
  },
  message_context: {
    ownership: "NO_AUTHORITY",
    reason: "Needs the ~6-query inbox reader per render, and the only cheap fact is a bare unread count -- the inbox duplication the ranking prevents."
  },
  returning_user: {
    ownership: "NO_AUTHORITY",
    reason: "No user-level last-visit record; push_subscriptions.last_seen_at is device-token freshness and conversation_presence is per-conversation."
  },
  weekend_plans: { ownership: "CARD_B_WIRED", reason: "Wired, windowed to Friday evening through Sunday." },

  // ---- Tier 5: growth / progression --------------------------------------
  profile_blocking: { ownership: "CARD_B_WIRED", reason: "Linkr explicitly enabled while Linkr's own rules refuse to show the viewer." },
  profile_completion: {
    ownership: "OTHER_SURFACE",
    reason: "Home already renders the profile completion reminder from its own missingProfileItems; profile_blocking is the narrower blocked-feature case."
  },
  notification_permission: {
    ownership: "CARD_A_OWNED",
    reason: "Permissions belong to activation; a second permission card on the same screen is the repetition the two-card split prevents."
  },
  location_permission: {
    ownership: "CARD_A_OWNED",
    reason: "Glow/location setup is Card A's, including the first-Muddy needs-location branch."
  },
  journey: { ownership: "CARD_B_WIRED", reason: "Wired, staged by completion percentage." },
  journey_complete: { ownership: "CARD_B_WIRED", reason: "Wired, acknowledgeable once." },
  buddy_progress: { ownership: "CARD_B_WIRED", reason: "Wired from the Buddy Score Home already loads." },
  achievement: { ownership: "CARD_B_WIRED", reason: "Wired; provider yields unless a recent achievement is supplied." },
  invite_prompt: {
    ownership: "CARD_A_OWNED",
    reason: "The activation card's own secondary action is 'Share your invite link' in the cold-start states."
  },
  contact_discovery: {
    ownership: "CARD_A_OWNED",
    reason: "Cold-start people discovery is the whole point of the no_muddies activation state; suggestions is excluded from Card B for the same reason."
  },
  walkthrough: {
    ownership: "OTHER_SURFACE",
    reason: "The Tours system owns one-time education and already targets Home elements directly (TOUR_TARGET_IDS)."
  },
  feature_announcement: {
    ownership: "NO_AUTHORITY",
    reason: "No canonical announcement source exists; a hard-coded promotional banner is explicitly not wanted."
  },
  offline_status: {
    ownership: "NO_AUTHORITY",
    reason: "Pending/failed sends live in the Messages page's client state, invisible to a server-rendered Home; navigator.onLine alone is not a pending action."
  },
  access_status: {
    ownership: "PRODUCT_PAUSED",
    reason: "Monetization gating is paused; no subscription pressure is to be activated on Home."
  },

  // ---- Tier 6: fallback ---------------------------------------------------
  suggestions: {
    ownership: "CARD_A_OWNED",
    reason: "Excluded at engine selection: ActivationCard owns cold-start people discovery."
  },
  upfor_fallback: { ownership: "CARD_B_WIRED", reason: "The default question when nothing truer is available." }
};

/** Counts by ownership, for the closeout report. */
export function classificationTotals(): Record<SmartCardOwnership, number> {
  const totals = {
    CARD_B_WIRED: 0,
    CARD_A_OWNED: 0,
    NEARBY_HERO_OWNED: 0,
    OTHER_SURFACE: 0,
    NO_AUTHORITY: 0,
    PRODUCT_PAUSED: 0,
    LOW_VALUE_DUPLICATE: 0
  } satisfies Record<SmartCardOwnership, number>;

  for (const state of SMART_CARD_APPROVED_STATES) {
    const entry = SMART_CARD_STATE_OWNERSHIP[state.id];
    if (entry) totals[entry.ownership] += 1;
  }
  return totals;
}
