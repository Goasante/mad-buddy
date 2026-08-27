/**
 * Canonical tour authoring and feature-guide registry.
 *
 * UI components import TOUR_TARGET_IDS instead of inventing string literals.
 * Admin publish validation and registry-drift tests both understand these
 * symbols, so a renamed or removed target is caught before a tour is shipped.
 */

export type TourRouteOption = { path: string; label: string };

export const TOUR_ROUTES: TourRouteOption[] = [
  { path: "/dashboard", label: "Home" },
  { path: "/friends", label: "Muddies" },
  { path: "/notifications", label: "Pulse" },
  { path: "/messages", label: "Messages" },
  { path: "/plans", label: "Plans" },
  { path: "/hangout-mode", label: "Hangout Mode" },
  { path: "/discover", label: "Linkr" },
  { path: "/safe-arrival", label: "Safe Arrival" },
  { path: "/moments", label: "Moments and Air" },
  { path: "/events", label: "Events" },
  { path: "/groups", label: "Groups" },
  { path: "/profile", label: "Profile" },
  { path: "/badges", label: "Achievements" },
  { path: "/buddy-score", label: "Buddy Score" },
  { path: "/settings", label: "Settings" },
  { path: "/settings/privacy", label: "Privacy and safety" },
  { path: "/settings/glow-visibility", label: "Glow and visibility" },
  { path: "/settings/appearance/wallpaper", label: "Wallpaper" },
  { path: "/billing", label: "Plan and billing" },
  { path: "/upgrade", label: "Plans and pricing" }
];

export const TOUR_TARGET_IDS = {
  HOME_NEARBY: "home-nearby",
  HOME_VISIBILITY: "home-visibility",
  HOME_STATUS: "home-status",
  HOME_QUICK_ACTIONS: "home-quick-actions",
  HOME_UPCOMING_PLAN: "home-upcoming-plan",

  MUDDIES_ADD: "muddies-add",
  MUDDIES_TABS: "muddies-tabs",
  MUDDIES_LIST: "muddies-list",
  MUDDIES_PROFILE: "muddies-profile",

  MOMENTS_SHARE: "moments-share",
  MOMENTS_TABS: "moments-tabs",
  MOMENTS_YOURS: "moments-yours",
  MOMENTS_FEED: "moments-feed",
  MOMENTS_REACTIONS: "moments-reactions",
  MOMENTS_AIR_TAB: "moments-air-tab",
  MOMENTS_TUNE_IN: "moments-tune-in",

  MESSAGES_INBOX: "messages-inbox",
  MESSAGES_SEARCH: "messages-search",
  MESSAGES_FILTERS: "messages-filters",
  MESSAGES_PINNED: "messages-pinned",
  MESSAGES_CONVERSATIONS: "messages-conversations",
  MESSAGES_CHAT_HEADER: "messages-chat-header",
  MESSAGES_QUICK_REPLIES: "messages-quick-replies",
  MESSAGES_COMPOSER: "messages-composer",

  HANGOUT_TOGGLE: "hangout-toggle",
  HANGOUT_ACTIVE: "hangout-active",
  HANGOUT_DISCOVERY: "hangout-discovery",

  SOCIALIZE_ACTIVATION: "socialize-activation",
  // Socialize 2.0 replaced the radar with a discovery feed; the tour still
  // points at the same place on the screen, so the id is renamed with it.
  SOCIALIZE_FEED: "socialize-feed",
  SOCIALIZE_REACH: "socialize-reach",

  SAFE_ARRIVAL_OVERVIEW: "safe-arrival-overview",
  SAFE_ARRIVAL_START: "safe-arrival-start",
  SAFE_ARRIVAL_ACTIVE: "safe-arrival-active",
  SAFE_ARRIVAL_WATCHER_REQUEST: "safe-arrival-watcher-request",
  SAFE_ARRIVAL_WATCHERS: "safe-arrival-watchers",

  PLANS_CREATE: "plans-create",
  PLANS_TABS: "plans-tabs",
  PLANS_LIST: "plans-list",
  PLANS_RSVP: "plans-rsvp",

  EVENTS_CREATE: "events-create",
  EVENTS_TABS: "events-tabs",
  EVENTS_LIST: "events-list",
  EVENTS_ACTIONS: "events-actions",

  PROFILE_OVERVIEW: "profile-overview",
  PROFILE_EDIT: "profile-edit",
  PROFILE_PHOTO: "profile-photo",
  PROFILE_ABOUT: "profile-about",
  PROFILE_PRIVACY: "profile-privacy",

  PULSE_OVERVIEW: "pulse-overview",
  PULSE_FILTERS: "pulse-filters",
  PULSE_LIST: "pulse-list",

  GLOW_VISIBILITY_OVERVIEW: "glow-visibility-overview",
  GLOW_VISIBILITY_TOGGLE: "glow-visibility-toggle",
  GLOW_VISIBILITY_AUDIENCE: "glow-visibility-audience",
  GLOW_VISIBILITY_DURATION: "glow-visibility-duration",

  PRIVACY_OVERVIEW: "privacy-overview",
  PRIVACY_GLOW: "privacy-glow",
  PRIVACY_MESSAGING: "privacy-messaging",
  PRIVACY_BLOCKED: "privacy-blocked",
  SETTINGS_GHOST_MODE: "settings-ghost-mode",
  SETTINGS_LOCATION_GLOW: "settings-location-glow",

  BADGES_OVERVIEW: "badges-overview",
  BADGES_TABS: "badges-tabs",
  BADGES_LIST: "badges-list",
  BUDDY_SCORE_OVERVIEW: "buddy-score-overview",
  BUDDY_SCORE_BREAKDOWN: "buddy-score-breakdown",

  SETTINGS_OVERVIEW: "settings-overview",
  SETTINGS_ACCOUNT: "settings-account",
  SETTINGS_PRIVACY: "settings-privacy",
  SETTINGS_NOTIFICATIONS: "settings-notifications",
  SETTINGS_SUPPORT: "settings-support",

  GROUPS_CREATE: "groups-create",
  GROUPS_TABS: "groups-tabs",
  GROUPS_LIST: "groups-list",
  GROUPS_INVITES: "groups-invites",

  BILLING_OVERVIEW: "billing-overview",
  BILLING_PLANS: "billing-plans",
  BILLING_ACTIVITY: "billing-activity"
} as const;

export type TourTargetId = (typeof TOUR_TARGET_IDS)[keyof typeof TOUR_TARGET_IDS];

/** Use this in UI components so tour ids remain type checked and central. */
export function tourTarget(id: TourTargetId) {
  return { "data-tour-id": id } as const;
}

export type TourTargetOption = {
  id: TourTargetId | `nav-${string}`;
  label: string;
  route: string;
  description: string;
};

const target = (id: TourTargetId, label: string, route: string, description: string): TourTargetOption => ({
  id,
  label,
  route,
  description
});

export const TOUR_TARGETS: TourTargetOption[] = [
  target(TOUR_TARGET_IDS.HOME_NEARBY, "Nearby Muddies", "/dashboard", "Approved Muddies currently nearby."),
  // Both now live inside the Quick Controls sheet. HOME_VISIBILITY sits on
  // the sheet's trigger in the Home header (the control it names moved in
  // there); HOME_STATUS sits on the Current Status row within the sheet.
  target(TOUR_TARGET_IDS.HOME_VISIBILITY, "Quick controls", "/dashboard", "Visibility, status, nearby and appearance controls."),
  target(TOUR_TARGET_IDS.HOME_STATUS, "Status", "/dashboard", "Availability status shown to approved Muddies."),
  target(TOUR_TARGET_IDS.HOME_QUICK_ACTIONS, "Quick actions", "/dashboard", "The Home feature launcher."),
  target(TOUR_TARGET_IDS.HOME_UPCOMING_PLAN, "Upcoming plan", "/dashboard", "The next social plan, when present."),

  target(TOUR_TARGET_IDS.MUDDIES_ADD, "Add a Muddy", "/friends", "The approved-Muddy search entry."),
  target(TOUR_TARGET_IDS.MUDDIES_TABS, "Muddy filters", "/friends", "Muddies, circles, requests, and blocked views."),
  target(TOUR_TARGET_IDS.MUDDIES_LIST, "Muddies list", "/friends", "The current approved-Muddy list or empty state."),
  target(TOUR_TARGET_IDS.MUDDIES_PROFILE, "Muddy profile", "/friends", "A Muddy row that opens their profile."),

  target(TOUR_TARGET_IDS.MOMENTS_SHARE, "Share a Moment", "/moments", "The real Moment composer entry."),
  target(TOUR_TARGET_IDS.MOMENTS_TABS, "Moment feeds", "/moments", "Switches between Muddies and Air."),
  target(TOUR_TARGET_IDS.MOMENTS_YOURS, "Your Moment", "/moments", "Your own temporary Moment entry."),
  target(TOUR_TARGET_IDS.MOMENTS_FEED, "Moments feed", "/moments", "The current temporary Moment feed."),
  target(TOUR_TARGET_IDS.MOMENTS_REACTIONS, "Moment reactions", "/moments", "Quick reactions on a real Moment."),
  target(TOUR_TARGET_IDS.MOMENTS_AIR_TAB, "Air", "/moments", "The wider Mad Buddy discovery feed."),
  target(TOUR_TARGET_IDS.MOMENTS_TUNE_IN, "Tune In", "/moments", "Tune In to a creator from Air."),

  target(TOUR_TARGET_IDS.MESSAGES_INBOX, "Messages inbox", "/messages", "The private conversation inbox."),
  target(TOUR_TARGET_IDS.MESSAGES_SEARCH, "Search messages", "/messages", "Conversation search."),
  target(TOUR_TARGET_IDS.MESSAGES_FILTERS, "Message filters", "/messages", "All, unread, group, and plan filters."),
  target(TOUR_TARGET_IDS.MESSAGES_PINNED, "Pinned chats", "/messages", "Pinned conversations, when present."),
  target(TOUR_TARGET_IDS.MESSAGES_CONVERSATIONS, "Conversation list", "/messages", "Approved-Muddy conversations."),
  target(TOUR_TARGET_IDS.MESSAGES_CHAT_HEADER, "Conversation header", "/messages", "Conversation identity, mute, and information."),
  target(TOUR_TARGET_IDS.MESSAGES_QUICK_REPLIES, "Quick replies", "/messages", "Existing quick reply choices."),
  target(TOUR_TARGET_IDS.MESSAGES_COMPOSER, "Message composer", "/messages", "The real message input and Send control."),

  target(TOUR_TARGET_IDS.HANGOUT_TOGGLE, "Hangout control", "/hangout-mode", "Turns Hangout Mode on or opens its setup."),
  target(TOUR_TARGET_IDS.HANGOUT_ACTIVE, "Active Hangout", "/hangout-mode", "The current Hangout state and controls."),
  target(TOUR_TARGET_IDS.HANGOUT_DISCOVERY, "Active UpFors", "/hangout-mode", "UpFors available to the viewer."),

  target(TOUR_TARGET_IDS.SOCIALIZE_ACTIVATION, "Socialize activation", "/discover", "Turns Socialize on or opens its controls."),
  target(TOUR_TARGET_IDS.SOCIALIZE_FEED, "Socialize feed", "/discover", "Nearby opted-in people, with approximate distance only."),
  target(TOUR_TARGET_IDS.SOCIALIZE_REACH, "Linkr reach", "/discover", "How far you are discoverable while Linkr is on."),

  target(TOUR_TARGET_IDS.SAFE_ARRIVAL_OVERVIEW, "Safe Arrival", "/safe-arrival", "The Safe Arrival landing or current journey."),
  target(TOUR_TARGET_IDS.SAFE_ARRIVAL_START, "Start Safe Arrival", "/safe-arrival", "Starts the real Safe Arrival setup."),
  target(TOUR_TARGET_IDS.SAFE_ARRIVAL_ACTIVE, "Active journey", "/safe-arrival", "Traveller status and check-in actions."),
  target(TOUR_TARGET_IDS.SAFE_ARRIVAL_WATCHER_REQUEST, "Watcher request", "/safe-arrival", "Accept or decline a Safe Arrival request."),
  target(TOUR_TARGET_IDS.SAFE_ARRIVAL_WATCHERS, "Accepted watchers", "/safe-arrival", "Muddies who accepted and are watching."),

  target(TOUR_TARGET_IDS.PLANS_CREATE, "Create a plan", "/plans", "Starts a social plan, not a subscription."),
  target(TOUR_TARGET_IDS.PLANS_TABS, "Plan filters", "/plans", "Upcoming, past, and invitation views."),
  target(TOUR_TARGET_IDS.PLANS_LIST, "Plans list", "/plans", "Current plan cards or the genuine empty state."),
  target(TOUR_TARGET_IDS.PLANS_RSVP, "RSVP", "/plans", "Existing RSVP controls inside plan details."),

  target(TOUR_TARGET_IDS.EVENTS_CREATE, "Create an event", "/events", "Starts the current event form."),
  target(TOUR_TARGET_IDS.EVENTS_TABS, "Event filters", "/events", "Discover and hosted event views."),
  target(TOUR_TARGET_IDS.EVENTS_LIST, "Events list", "/events", "Current events or the genuine empty state."),
  target(TOUR_TARGET_IDS.EVENTS_ACTIONS, "Event actions", "/events", "View and participation controls."),

  target(TOUR_TARGET_IDS.PROFILE_OVERVIEW, "Profile", "/profile", "How approved Muddies see this profile."),
  target(TOUR_TARGET_IDS.PROFILE_EDIT, "Edit profile", "/profile", "Edit display name, username, bio, and mood."),
  target(TOUR_TARGET_IDS.PROFILE_PHOTO, "Profile photo", "/profile", "Add or replace a profile photo."),
  target(TOUR_TARGET_IDS.PROFILE_ABOUT, "About", "/profile", "Profile information visible to approved Muddies."),
  target(TOUR_TARGET_IDS.PROFILE_PRIVACY, "Profile privacy", "/profile", "Visibility state; links to the full privacy controls in Settings."),

  target(TOUR_TARGET_IDS.PULSE_OVERVIEW, "Pulse", "/notifications", "Friend requests, nearby alerts, and account updates."),
  target(TOUR_TARGET_IDS.PULSE_FILTERS, "Pulse filters", "/notifications", "Filter updates by category."),
  target(TOUR_TARGET_IDS.PULSE_LIST, "Pulse updates", "/notifications", "Real updates or the genuine empty state."),

  target(TOUR_TARGET_IDS.GLOW_VISIBILITY_OVERVIEW, "Glow and visibility", "/settings/glow-visibility", "Glow privacy controls."),
  target(TOUR_TARGET_IDS.GLOW_VISIBILITY_TOGGLE, "Visibility state", "/settings/glow-visibility", "Pause or resume Glow visibility."),
  target(TOUR_TARGET_IDS.GLOW_VISIBILITY_AUDIENCE, "Glow audience", "/settings/glow-visibility", "Who can see the viewer's Glow."),
  target(TOUR_TARGET_IDS.GLOW_VISIBILITY_DURATION, "Visibility duration", "/settings/glow-visibility", "How long visibility remains active."),

  target(TOUR_TARGET_IDS.PRIVACY_OVERVIEW, "Account privacy", "/settings/privacy", "Privacy and safety controls."),
  target(TOUR_TARGET_IDS.PRIVACY_GLOW, "Glow privacy", "/settings/privacy", "Link to Glow visibility choices."),
  target(TOUR_TARGET_IDS.PRIVACY_MESSAGING, "Messaging privacy", "/settings/privacy", "Who may contact and add the viewer."),
  target(TOUR_TARGET_IDS.PRIVACY_BLOCKED, "Blocked users", "/settings/privacy", "Review blocked accounts."),
  target(TOUR_TARGET_IDS.SETTINGS_GHOST_MODE, "Ghost Mode", "/settings", "Pause visibility immediately."),
  target(TOUR_TARGET_IDS.SETTINGS_LOCATION_GLOW, "Location for Glow", "/settings", "Device permission used only to calculate general Glow."),

  target(TOUR_TARGET_IDS.BADGES_OVERVIEW, "Achievements", "/badges", "Personal achievements and recaps."),
  target(TOUR_TARGET_IDS.BADGES_TABS, "Achievement views", "/badges", "Achievements, milestones, and recaps."),
  target(TOUR_TARGET_IDS.BADGES_LIST, "Earned badges", "/badges", "Real earned and available achievements."),
  target(TOUR_TARGET_IDS.BUDDY_SCORE_OVERVIEW, "Buddy Score", "/buddy-score", "The viewer's private activity score."),
  target(TOUR_TARGET_IDS.BUDDY_SCORE_BREAKDOWN, "Score breakdown", "/buddy-score", "The real categories contributing to Buddy Score."),

  target(TOUR_TARGET_IDS.SETTINGS_OVERVIEW, "Settings", "/settings", "Account and app preferences."),
  target(TOUR_TARGET_IDS.SETTINGS_ACCOUNT, "Account settings", "/settings", "Profile, privacy, sessions, and achievements."),
  target(TOUR_TARGET_IDS.SETTINGS_PRIVACY, "Privacy and safety settings", "/settings", "Visibility and safety controls."),
  target(TOUR_TARGET_IDS.SETTINGS_NOTIFICATIONS, "Notification settings", "/settings", "Alerts, focus, and communication preferences."),
  target(TOUR_TARGET_IDS.SETTINGS_SUPPORT, "Help and guides", "/settings", "Help, Feature Guides, feedback, and invites."),

  target(TOUR_TARGET_IDS.GROUPS_CREATE, "Create a group", "/groups", "Starts a private group."),
  target(TOUR_TARGET_IDS.GROUPS_TABS, "Group filters", "/groups", "Your groups, discovery, and invitations."),
  target(TOUR_TARGET_IDS.GROUPS_LIST, "Groups list", "/groups", "Real groups or the genuine empty state."),
  target(TOUR_TARGET_IDS.GROUPS_INVITES, "Group invitations", "/groups", "Pending group invitations, when present."),

  target(TOUR_TARGET_IDS.BILLING_OVERVIEW, "Plan and billing", "/billing", "Current subscription and payment status."),
  target(TOUR_TARGET_IDS.BILLING_PLANS, "Subscription plans", "/billing", "Free, Buddy Plus, and Buddy Pro from canonical billing data."),
  target(TOUR_TARGET_IDS.BILLING_ACTIVITY, "Billing activity", "/billing", "Real subscription activity."),

  // The mobile bottom bar's five slots: Messages, Muddies, the Orb, Plans,
  // Me. The Orb is the centre AND Home, so nav-dashboard now targets it; the
  // old nav-create ("+") no longer exists, and a tour step cannot spotlight a
  // control that is gone.
  { id: "nav-messages", label: "Messages tab", route: "/messages", description: "App navigation: Messages." },
  { id: "nav-dashboard", label: "Mad Buddy Orb (Home)", route: "/dashboard", description: "App navigation: the centre Orb, which is Home." },
  { id: "nav-friends", label: "Muddies tab", route: "/friends", description: "App navigation: Muddies." },
  { id: "nav-plans", label: "Plans tab", route: "/plans", description: "App navigation: Plans." },
  { id: "nav-profile", label: "Me tab", route: "/profile", description: "App navigation: Me." },
  { id: "nav-hangout-mode", label: "Hangout tab", route: "/hangout-mode", description: "App navigation: Hangout Mode." },
  { id: "nav-discover", label: "Socialize tab", route: "/discover", description: "App navigation: Socialize." },
  { id: "nav-moments", label: "Moments tab", route: "/moments", description: "App navigation: Moments." }
];

export const FEATURE_GUIDE_GROUPS = [
  { id: "getting-started", label: "Getting started" },
  { id: "connect", label: "Connect" },
  { id: "share", label: "Share" },
  { id: "plan-safety", label: "Plan and safety" },
  { id: "your-account", label: "Your account" }
] as const;

export type FeatureGuideGroupId = (typeof FEATURE_GUIDE_GROUPS)[number]["id"];

export type FeatureGuideDefinition = {
  slug: string;
  label: string;
  group: FeatureGuideGroupId;
  entryRoute: string;
  /** Offer only when this real target is selected, used by Air on /moments. */
  activeTargetId?: TourTargetId;
};

export const FEATURE_GUIDES: FeatureGuideDefinition[] = [
  { slug: "home-guide", label: "Home", group: "getting-started", entryRoute: "/dashboard" },
  { slug: "muddies-guide", label: "Muddies", group: "getting-started", entryRoute: "/friends" },
  { slug: "glow-visibility-guide", label: "Glow and visibility", group: "getting-started", entryRoute: "/settings/glow-visibility" },
  { slug: "messages-guide", label: "Messages", group: "connect", entryRoute: "/messages" },
  { slug: "hangout-guide", label: "Hangout", group: "connect", entryRoute: "/hangout-mode" },
  { slug: "socialize-guide", label: "Linkr", group: "connect", entryRoute: "/discover" },
  { slug: "groups-guide", label: "Groups", group: "connect", entryRoute: "/groups" },
  { slug: "moments-guide", label: "Moments", group: "share", entryRoute: "/moments" },
  { slug: "air-guide", label: "Air", group: "share", entryRoute: "/moments", activeTargetId: TOUR_TARGET_IDS.MOMENTS_AIR_TAB },
  { slug: "plans-guide", label: "Plans", group: "plan-safety", entryRoute: "/plans" },
  { slug: "events-guide", label: "Events", group: "plan-safety", entryRoute: "/events" },
  { slug: "safe-arrival-guide", label: "Safe Arrival", group: "plan-safety", entryRoute: "/safe-arrival" },
  { slug: "profile-guide", label: "Profile", group: "your-account", entryRoute: "/profile" },
  { slug: "privacy-safety-guide", label: "Privacy and safety", group: "your-account", entryRoute: "/settings/privacy" },
  { slug: "pulse-guide", label: "Pulse", group: "your-account", entryRoute: "/notifications" },
  { slug: "badges-guide", label: "Achievements", group: "your-account", entryRoute: "/badges" },
  { slug: "buddy-score-guide", label: "Buddy Score", group: "your-account", entryRoute: "/buddy-score" },
  { slug: "settings-guide", label: "Settings", group: "your-account", entryRoute: "/settings" },
  { slug: "subscription-guide", label: "Plan and billing", group: "your-account", entryRoute: "/billing" }
];

export function findTarget(id: string): TourTargetOption | undefined {
  return TOUR_TARGETS.find((entry) => entry.id === id);
}

export function findRoute(path: string): TourRouteOption | undefined {
  return TOUR_ROUTES.find((route) => route.path === path);
}

export function findFeatureGuide(slug: string): FeatureGuideDefinition | undefined {
  return FEATURE_GUIDES.find((guide) => guide.slug === slug);
}

export function targetLabel(id: string | null): string | null {
  if (!id) return null;
  return findTarget(id)?.label ?? id;
}

export function isKnownRoute(path: string): boolean {
  return TOUR_ROUTES.some((route) => route.path === path);
}
