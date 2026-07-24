/**
 * Canonical achievement catalog.
 *
 * One source of truth for achievement presentation and notification copy. The
 * unlock criteria and codes mirror the seeded public.achievement_definitions
 * rows (the database stays the authority for granting); this catalog adds the
 * things the table doesn't carry — the local badge artwork and the unlock
 * notification copy. Icons are the owner-supplied local assets in
 * public/icons/features/navigation/badges/ and are never hotlinked.
 *
 * Pure data (no server-only imports) so both the server granter and the client
 * badges page can share it.
 */

export type AchievementCategory = "connection" | "community" | "privacy" | "balance" | "safety";

export type AchievementCriteria = {
  /** Matches achievement_definitions.criteria_type. */
  type: "first_time" | "count" | "distinct_count";
  /** Matches achievement_definitions.criteria_value. */
  threshold: number;
};

export type AchievementDefinition = {
  /** achievement_definitions.code — the join key for user_achievements. */
  id: string;
  name: string;
  description: string;
  /** Local badge asset. Filenames are kept exactly as supplied. */
  iconPath: string;
  category: AchievementCategory;
  criteria: AchievementCriteria;
  notification: { title: string; body: string };
};

const BADGE_DIR = "/icons/features/navigation/badges";

function unlocked(name: string): { title: string; body: string } {
  return { title: "Achievement unlocked", body: `You earned the ${name} badge.` };
}

export const ACHIEVEMENT_CATALOG: readonly AchievementDefinition[] = [
  {
    id: "first_muddy",
    name: "First Muddy",
    description: "You added your first Muddy.",
    iconPath: `${BADGE_DIR}/First Muddy.png`,
    category: "connection",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("First Muddy")
  },
  {
    id: "first_wave",
    name: "First Wave",
    description: "You sent your first Wave.",
    iconPath: `${BADGE_DIR}/First Wave.png`,
    category: "connection",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("First Wave")
  },
  {
    id: "first_ping",
    name: "First Ping",
    description: "You sent your first Ping.",
    iconPath: `${BADGE_DIR}/First Ping.png`,
    category: "connection",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("First Ping")
  },
  {
    id: "thoughtful_reply",
    name: "Thoughtful Reply",
    description: "You replied to your first connection prompt.",
    iconPath: `${BADGE_DIR}/Thoughtful Reply.png`,
    category: "connection",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("Thoughtful Reply")
  },
  {
    id: "close_friend",
    name: "Close Friend",
    description: "You added your first Close Friend.",
    iconPath: `${BADGE_DIR}/Close Friend.png`,
    category: "connection",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("Close Friend")
  },
  {
    id: "friendly_five",
    name: "Friendly Five",
    description: "You connected with 5 approved friends.",
    iconPath: `${BADGE_DIR}/Friendly Five.png`,
    category: "connection",
    criteria: { type: "count", threshold: 5 },
    notification: unlocked("Friendly Five")
  },
  {
    id: "first_plan",
    name: "First Plan",
    description: "You completed your first Plan.",
    iconPath: `${BADGE_DIR}/First Plan.png`,
    category: "connection",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("First Plan")
  },
  {
    id: "plan_maker",
    name: "Plan Maker",
    description: "You completed 5 Plans.",
    iconPath: `${BADGE_DIR}/Plan Maker.png`,
    category: "connection",
    criteria: { type: "count", threshold: 5 },
    notification: unlocked("Plan Maker")
  },
  {
    id: "plan_regular",
    name: "Plan Regular",
    description: "You completed 10 Plans.",
    iconPath: `${BADGE_DIR}/Plan Regular.png`,
    category: "connection",
    criteria: { type: "count", threshold: 10 },
    notification: unlocked("Plan Regular")
  },
  {
    id: "open_to_plans",
    name: "Open to Plans",
    description: "You turned on Socialize for the first time.",
    iconPath: `${BADGE_DIR}/Open to Plans.png`,
    category: "connection",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("Open to Plans")
  },
  {
    id: "first_moment",
    name: "First Moment",
    description: "You shared your first Moment.",
    iconPath: `${BADGE_DIR}/First Moment.png`,
    category: "community",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("First Moment")
  },
  {
    id: "moment_maker",
    name: "Moment Maker",
    description: "You shared 10 Moments.",
    iconPath: `${BADGE_DIR}/Moment Maker.png`,
    category: "community",
    criteria: { type: "count", threshold: 10 },
    notification: unlocked("Moment Maker")
  },
  {
    id: "event_explorer",
    name: "Event Explorer",
    description: "You checked in to your first event.",
    iconPath: `${BADGE_DIR}/Event Explorer.png`,
    category: "community",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("Event Explorer")
  },
  {
    id: "event_host",
    name: "Event Host",
    description: "You created your first event.",
    iconPath: `${BADGE_DIR}/Event Host.png`,
    category: "community",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("Event Host")
  },
  {
    id: "group_member",
    name: "Group Member",
    description: "You joined your first group.",
    iconPath: `${BADGE_DIR}/Group Member.png`,
    category: "community",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("Group Member")
  },
  {
    id: "group_founder",
    name: "Group Founder",
    description: "You created your first group.",
    iconPath: `${BADGE_DIR}/Group Founder.png`,
    category: "community",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("Group Founder")
  },
  {
    id: "first_glow",
    name: "First Glow",
    description: "You turned on your glow for the first time.",
    iconPath: `${BADGE_DIR}/First Glow.png`,
    category: "privacy",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("First Glow")
  },
  {
    id: "privacy_pro",
    name: "Privacy Pro",
    description: "You reviewed your privacy settings.",
    iconPath: `${BADGE_DIR}/Privacy Pro.png`,
    category: "privacy",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("Privacy Pro")
  },
  {
    id: "privacy_pause",
    name: "Privacy Pause",
    description: "You used Ghost Mode for the first time.",
    iconPath: `${BADGE_DIR}/Privacy Pause.png`,
    category: "privacy",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("Privacy Pause")
  },
  {
    id: "circle_builder",
    name: "Circle Builder",
    description: "You created 3 circles.",
    iconPath: `${BADGE_DIR}/Circle Builder.png`,
    category: "balance",
    criteria: { type: "count", threshold: 3 },
    notification: unlocked("Circle Builder")
  },
  {
    id: "balanced_buddy",
    name: "Balanced Buddy",
    description: "You took part across 3 different circles in a month.",
    iconPath: `${BADGE_DIR}/Balanced Buddy.png`,
    category: "balance",
    criteria: { type: "distinct_count", threshold: 3 },
    notification: unlocked("Balanced Buddy")
  },
  {
    id: "good_check_in",
    name: "Good Check-In",
    description: "You completed a Safe Arrival.",
    iconPath: `${BADGE_DIR}/Good Check-In.png`,
    category: "safety",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("Good Check-In")
  },
  {
    id: "trusted_contact",
    name: "Trusted Contact",
    description: "You added a trusted Safe Arrival contact.",
    iconPath: `${BADGE_DIR}/Trusted Contact.png`,
    category: "safety",
    criteria: { type: "first_time", threshold: 1 },
    notification: unlocked("Trusted Contact")
  },
  {
    id: "safe_traveller",
    name: "Safe Traveller",
    description: "You completed 5 Safe Arrivals.",
    iconPath: `${BADGE_DIR}/Safe Traveller.png`,
    category: "safety",
    criteria: { type: "count", threshold: 5 },
    notification: unlocked("Safe Traveller")
  },
  {
    id: "reliable_watcher",
    name: "Reliable Watcher",
    description: "You watched over 5 Safe Arrival journeys.",
    iconPath: `${BADGE_DIR}/Reliable Watcher.png`,
    category: "safety",
    criteria: { type: "count", threshold: 5 },
    notification: unlocked("Reliable Watcher")
  }
];

export const ACHIEVEMENT_BY_CODE: ReadonlyMap<string, AchievementDefinition> = new Map(
  ACHIEVEMENT_CATALOG.map((achievement) => [achievement.id, achievement])
);

/** The local badge artwork for an achievement code, or null if uncatalogued. */
export function achievementIconPath(code: string): string | null {
  return ACHIEVEMENT_BY_CODE.get(code)?.iconPath ?? null;
}
