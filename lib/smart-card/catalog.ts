export type SmartCardTier = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type SmartCardStateSpec = {
  id: string;
  tier: SmartCardTier;
  family:
    | "safety"
    | "plans"
    | "upfor"
    | "proximity"
    | "linkr"
    | "events"
    | "muddies"
    | "messaging"
    | "groups"
    | "notifications"
    | "profile"
    | "permissions"
    | "journey"
    | "growth"
    | "system"
    | "access";
  purpose: string;
};

/**
 * Product authority for every state approved to compete for Home's ONE Smart Card.
 *
 * This is intentionally broader than the providers currently wired into Home.
 * It is the convergence backlog: providers can be added without reopening the
 * product decision about whether a state belongs here at all.
 *
 * Tier meaning:
 *   0 safety / truth
 *   1 the viewer owes someone an answer
 *   2 something social is happening now
 *   3 relationship momentum
 *   4 useful opportunity
 *   5 growth / progression / contextual education
 *   6 fallback
 *
 * Moments is deliberately absent. The product has paused/discontinued Moments
 * for this phase, so it cannot win Home through the Smart Card engine.
 */
export const SMART_CARD_APPROVED_STATES = [
  { id: "safe_arrival_overdue", tier: 0, family: "safety", purpose: "A Safe Arrival check-in is overdue." },
  { id: "safe_arrival_action", tier: 0, family: "safety", purpose: "A live Safe Arrival needs the traveller's action." },
  { id: "failed_action", tier: 0, family: "system", purpose: "A consequential action failed and needs recovery." },

  { id: "plan_rsvp", tier: 1, family: "plans", purpose: "A Plan invitation needs a response." },
  { id: "plan_decision", tier: 1, family: "plans", purpose: "A Plan poll or unresolved decision needs the viewer." },
  { id: "plan_changed", tier: 1, family: "plans", purpose: "A meaningful Plan change needs review or reconfirmation." },
  { id: "upfor_requests", tier: 1, family: "upfor", purpose: "People are waiting on the owner of an UpFor." },
  { id: "safe_arrival_watcher_request", tier: 1, family: "safety", purpose: "Someone asked the viewer to be a watcher." },
  { id: "event_invitation", tier: 1, family: "events", purpose: "An Event invitation needs a response." },
  { id: "muddy_request", tier: 1, family: "muddies", purpose: "An incoming Muddy request needs review." },
  { id: "notification_action_bundle", tier: 1, family: "notifications", purpose: "Several related actionable items need attention." },

  { id: "plan_starting", tier: 2, family: "plans", purpose: "A confirmed Plan is starting soon." },
  { id: "upfor_active_muddy", tier: 2, family: "upfor", purpose: "A relevant Muddy is UpFor something now." },
  { id: "upfor_momentum", tier: 2, family: "upfor", purpose: "An UpFor is gathering meaningful interest." },
  { id: "upfor_accepted", tier: 2, family: "upfor", purpose: "The viewer's UpFor request was accepted." },
  { id: "owned_upfor_starting", tier: 2, family: "upfor", purpose: "The viewer's scheduled UpFor is starting soon." },
  { id: "nearby_muddy", tier: 2, family: "proximity", purpose: "A fresh, privacy-permitted Muddy is nearby." },
  { id: "nearby_muddies", tier: 2, family: "proximity", purpose: "Several fresh, privacy-permitted Muddies are nearby." },
  { id: "event_live", tier: 2, family: "events", purpose: "A relevant Event is happening now." },
  { id: "event_linkr_ready", tier: 2, family: "linkr", purpose: "A checked-in attendee can opt into Event Linkr." },
  { id: "plan_chat_decision", tier: 2, family: "messaging", purpose: "A Plan Chat contains a current coordination decision." },

  { id: "linkr_mutual_event", tier: 3, family: "linkr", purpose: "A Linkr mutual has a shared Event context." },
  { id: "linkr_mutual", tier: 3, family: "linkr", purpose: "A new Linkr mutual is ready for a first message." },
  { id: "first_muddy", tier: 3, family: "muddies", purpose: "A first Muddy connection deserves a next step." },
  { id: "invited_friend_joined", tier: 3, family: "growth", purpose: "Someone joined through the viewer's invitation." },
  { id: "muddy_birthday", tier: 3, family: "muddies", purpose: "A privacy-permitted Muddy birthday creates a human moment." },
  { id: "birthday", tier: 3, family: "profile", purpose: "The viewer's own birthday moment." },

  { id: "event_friend_context", tier: 4, family: "events", purpose: "Muddies are attending a relevant Event." },
  { id: "event_starting", tier: 4, family: "events", purpose: "A saved/going Event starts soon." },
  { id: "event_saved", tier: 4, family: "events", purpose: "A saved Event is approaching." },
  { id: "linkr_opportunity", tier: 4, family: "linkr", purpose: "A grounded Linkr opportunity has a clear reason." },
  { id: "plan_upcoming", tier: 4, family: "plans", purpose: "An upcoming commitment is worth keeping visible." },
  { id: "upfor_scheduled", tier: 4, family: "upfor", purpose: "A scheduled UpFor is approaching." },
  { id: "group_invitation", tier: 4, family: "groups", purpose: "A Group invitation or relevant Group activity." },
  { id: "message_context", tier: 4, family: "messaging", purpose: "A meaningful unread message is tied to active coordination." },
  { id: "returning_user", tier: 4, family: "system", purpose: "A returning user needs the most relevant change since last visit." },
  { id: "weekend_plans", tier: 4, family: "plans", purpose: "Weekend planning is timely when no stronger state wins." },

  { id: "profile_blocking", tier: 5, family: "profile", purpose: "Missing profile data directly blocks a desired feature." },
  { id: "profile_completion", tier: 5, family: "profile", purpose: "General profile completion, only when little else matters." },
  { id: "notification_permission", tier: 5, family: "permissions", purpose: "Ask for notifications only after a relevant action." },
  { id: "location_permission", tier: 5, family: "permissions", purpose: "Ask for Glow/location only in a nearby context." },
  { id: "journey", tier: 5, family: "journey", purpose: "A useful next Journey step." },
  { id: "journey_complete", tier: 5, family: "journey", purpose: "A completed Journey milestone." },
  { id: "buddy_progress", tier: 5, family: "journey", purpose: "Buddy Score progress, never above real social life." },
  { id: "achievement", tier: 5, family: "journey", purpose: "A meaningful achievement worth acknowledging once." },
  { id: "invite_prompt", tier: 5, family: "growth", purpose: "Cold-start invitation when the viewer has no Muddies." },
  { id: "contact_discovery", tier: 5, family: "growth", purpose: "Contextual find-people entry during activation." },
  { id: "walkthrough", tier: 5, family: "growth", purpose: "One-time education for a critical product concept." },
  { id: "feature_announcement", tier: 5, family: "growth", purpose: "Rare announcement of a genuinely useful capability." },
  { id: "offline_status", tier: 5, family: "system", purpose: "A relevant pending action is waiting for connectivity." },
  { id: "access_status", tier: 5, family: "access", purpose: "Access state only when monetization gating is active again." },

  { id: "suggestions", tier: 6, family: "growth", purpose: "Cold-start people suggestions when available." },
  { id: "upfor_fallback", tier: 6, family: "upfor", purpose: "Default: ask what the viewer is UpFor today." }
] as const satisfies readonly SmartCardStateSpec[];

export type ApprovedSmartCardStateId = (typeof SMART_CARD_APPROVED_STATES)[number]["id"];

export const SMART_CARD_TIER_LABELS: Record<SmartCardTier, string> = {
  0: "safety_truth",
  1: "needs_answer",
  2: "happening_now",
  3: "relationship_momentum",
  4: "useful_opportunity",
  5: "growth_progression",
  6: "fallback"
};
