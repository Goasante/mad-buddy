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
  }
];

export const ACHIEVEMENT_BY_CODE: ReadonlyMap<string, AchievementDefinition> = new Map(
  ACHIEVEMENT_CATALOG.map((achievement) => [achievement.id, achievement])
);

/** The local badge artwork for an achievement code, or null if uncatalogued. */
export function achievementIconPath(code: string): string | null {
  return ACHIEVEMENT_BY_CODE.get(code)?.iconPath ?? null;
}
