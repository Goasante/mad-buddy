/**
 * Canonical achievement catalog.
 *
 * Database achievement codes remain stable so already-earned rows keep working.
 * Product names and current visibility live here: Meetups replaces the retired
 * Plans / Safe Arrival presentation without rewriting historical data.
 */

export type AchievementCategory = "connection" | "community" | "privacy" | "balance" | "safety";

export type AchievementCriteria = {
  type: "first_time" | "count" | "distinct_count";
  threshold: number;
};

export type AchievementDefinition = {
  id: string;
  name: string;
  description: string;
  iconPath: string;
  category: AchievementCategory;
  criteria: AchievementCriteria;
  notification: { title: string; body: string };
  /** Historical-only definitions remain resolvable but are hidden from current earning UI. */
  active?: boolean;
};

const BADGE_DIR = "/icons/features/navigation/badges";

function unlocked(name: string): { title: string; body: string } {
  return { title: "Achievement unlocked", body: `You earned the ${name} badge.` };
}

export const ACHIEVEMENT_CATALOG: readonly AchievementDefinition[] = [
  { id: "first_muddy", name: "First Muddy", description: "You added your first Muddy.", iconPath: `${BADGE_DIR}/First Muddy.png`, category: "connection", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("First Muddy") },
  { id: "first_wave", name: "First Wave", description: "You sent your first Wave.", iconPath: `${BADGE_DIR}/First Wave.png`, category: "connection", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("First Wave") },
  { id: "first_ping", name: "First Ping", description: "You sent your first Ping.", iconPath: `${BADGE_DIR}/First Ping.png`, category: "connection", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("First Ping") },
  { id: "thoughtful_reply", name: "Thoughtful Reply", description: "You replied to your first connection prompt.", iconPath: `${BADGE_DIR}/Thoughtful Reply.png`, category: "connection", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("Thoughtful Reply") },
  { id: "close_friend", name: "Close Friend", description: "You added your first Close Friend.", iconPath: `${BADGE_DIR}/Close Friend.png`, category: "connection", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("Close Friend") },
  { id: "friendly_five", name: "Friendly Five", description: "You connected with 5 approved friends.", iconPath: `${BADGE_DIR}/Friendly Five.png`, category: "connection", criteria: { type: "count", threshold: 5 }, notification: unlocked("Friendly Five") },

  // Stable historical codes, current Meetups presentation.
  { id: "first_plan", name: "First Meetup", description: "You completed your first Meetup.", iconPath: `${BADGE_DIR}/First Plan.png`, category: "connection", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("First Meetup") },
  { id: "plan_maker", name: "Meetup Maker", description: "You completed 5 Meetups.", iconPath: `${BADGE_DIR}/Plan Maker.png`, category: "connection", criteria: { type: "count", threshold: 5 }, notification: unlocked("Meetup Maker") },
  { id: "plan_regular", name: "Meetup Regular", description: "You completed 10 Meetups.", iconPath: `${BADGE_DIR}/Plan Regular.png`, category: "connection", criteria: { type: "count", threshold: 10 }, notification: unlocked("Meetup Regular") },
  { id: "open_to_plans", name: "Open to Connect", description: "You opened nearby discovery for the first time.", iconPath: `${BADGE_DIR}/Open to Plans.png`, category: "connection", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("Open to Connect") },

  { id: "first_moment", name: "First Moment", description: "You shared your first Moment.", iconPath: `${BADGE_DIR}/First Moment.png`, category: "community", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("First Moment") },
  { id: "moment_maker", name: "Moment Maker", description: "You shared 10 Moments.", iconPath: `${BADGE_DIR}/Moment Maker.png`, category: "community", criteria: { type: "count", threshold: 10 }, notification: unlocked("Moment Maker") },
  { id: "event_explorer", name: "Event Explorer", description: "You checked in to your first event.", iconPath: `${BADGE_DIR}/Event Explorer.png`, category: "community", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("Event Explorer") },
  { id: "event_host", name: "Event Host", description: "You created your first event.", iconPath: `${BADGE_DIR}/Event Host.png`, category: "community", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("Event Host") },
  { id: "group_member", name: "Group Member", description: "You joined your first group.", iconPath: `${BADGE_DIR}/Group Member.png`, category: "community", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("Group Member") },
  { id: "group_founder", name: "Group Founder", description: "You created your first group.", iconPath: `${BADGE_DIR}/Group Founder.png`, category: "community", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("Group Founder") },

  { id: "first_glow", name: "First Glow", description: "You turned on your glow for the first time.", iconPath: `${BADGE_DIR}/First Glow.png`, category: "privacy", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("First Glow") },
  { id: "privacy_pro", name: "Privacy Pro", description: "You reviewed your privacy settings.", iconPath: `${BADGE_DIR}/Privacy Pro.png`, category: "privacy", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("Privacy Pro") },
  { id: "privacy_pause", name: "Privacy Pause", description: "You used Ghost Mode for the first time.", iconPath: `${BADGE_DIR}/Privacy Pause.png`, category: "privacy", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("Privacy Pause") },

  { id: "circle_builder", name: "Circle Builder", description: "You created 3 circles.", iconPath: `${BADGE_DIR}/Circle Builder.png`, category: "balance", criteria: { type: "count", threshold: 3 }, notification: unlocked("Circle Builder") },
  { id: "balanced_buddy", name: "Balanced Buddy", description: "You took part across 3 different circles in a month.", iconPath: `${BADGE_DIR}/Balanced Buddy.png`, category: "balance", criteria: { type: "distinct_count", threshold: 3 }, notification: unlocked("Balanced Buddy") },

  { id: "good_check_in", name: "Meetup Check-In", description: "You completed your first Meetup home check-in.", iconPath: `${BADGE_DIR}/Good Check-In.png`, category: "safety", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("Meetup Check-In") },
  { id: "safe_traveller", name: "Meetup Check-In Regular", description: "You completed 5 Meetup safety check-ins.", iconPath: `${BADGE_DIR}/Safe Traveller.png`, category: "safety", criteria: { type: "count", threshold: 5 }, notification: unlocked("Meetup Check-In Regular") },

  // These belong to the retired standalone Safe Arrival workflow. Keep their
  // codes and neutral copy for existing earned rows / late lifecycle delivery,
  // but do not advertise them as currently earnable achievements.
  { id: "trusted_contact", name: "Safety Contact", description: "You added someone you trust for safety updates.", iconPath: `${BADGE_DIR}/Trusted Contact.png`, category: "safety", criteria: { type: "first_time", threshold: 1 }, notification: unlocked("Safety Contact"), active: false },
  { id: "reliable_watcher", name: "Reliable Buddy", description: "You helped with 5 safety check-ins.", iconPath: `${BADGE_DIR}/Reliable Watcher.png`, category: "safety", criteria: { type: "count", threshold: 5 }, notification: unlocked("Reliable Buddy"), active: false }
];

export const ACTIVE_ACHIEVEMENT_CATALOG = ACHIEVEMENT_CATALOG.filter((achievement) => achievement.active !== false);

export const ACHIEVEMENT_BY_CODE: ReadonlyMap<string, AchievementDefinition> = new Map(
  ACHIEVEMENT_CATALOG.map((achievement) => [achievement.id, achievement])
);

export const ACTIVE_ACHIEVEMENT_BY_CODE: ReadonlyMap<string, AchievementDefinition> = new Map(
  ACTIVE_ACHIEVEMENT_CATALOG.map((achievement) => [achievement.id, achievement])
);

/** The local badge artwork for an achievement code, or null if uncatalogued. */
export function achievementIconPath(code: string): string | null {
  return ACHIEVEMENT_BY_CODE.get(code)?.iconPath ?? null;
}
