/**
 * Interests — the canonical vocabulary and the rules for changing a set.
 *
 * WHY THIS FILE EXISTS
 *
 * `user_interests` has been readable since batch 9: the profile projection
 * selects it, per-field privacy narrows it, and `remainingCompletionTasks`
 * asks people to "Choose a few interests". Nothing could ever write it, so
 * that task could never be completed and the field was permanently empty.
 * This adds the missing half.
 *
 * NOT the same list as Linkr. `linkr_interests` is a separate table with its
 * own free-text editor for dating intent; this is profile identity. Keeping
 * them separate is deliberate — merging them would leak a dating vocabulary
 * onto the Muddy-facing profile.
 *
 * The taxonomy is closed on the way IN and open on the way OUT: a save may
 * only choose canonical values, but a value already stored is preserved and
 * still displayed. That way this can ship without a data migration and
 * without silently deleting anything an earlier build wrote.
 */

/**
 * The canonical set.
 *
 * Deliberately compact. These are conversation starters for a campus social
 * app, not a directory taxonomy — a longer list makes the picker a chore and
 * splits people across near-duplicate tags ("Film" vs "Movies") who would
 * otherwise match.
 */
export const CANONICAL_INTERESTS = [
  "Music",
  "Coffee",
  "Food",
  "Gaming",
  "Sports",
  "Fitness",
  "Movies",
  "Books",
  "Travel",
  "Photography",
  "Outdoors",
  "Study",
  "Tech",
  "Art",
  "Fashion",
  "Nightlife"
] as const;

export type CanonicalInterest = (typeof CANONICAL_INTERESTS)[number];

/**
 * How many one profile may carry.
 *
 * Chosen so the chips stay one or two tidy rows at 360px rather than becoming
 * a wall of tags that says nothing about the person.
 */
export const MAX_INTERESTS = 8;

/** The column is `text not null check (char_length(interest) between 1 and 40)`. */
export const MAX_INTEREST_LENGTH = 40;

const CANONICAL_BY_KEY = new Map<string, CanonicalInterest>(
  CANONICAL_INTERESTS.map((interest) => [interest.toLowerCase(), interest])
);

export function isCanonicalInterest(value: string): value is CanonicalInterest {
  return CANONICAL_BY_KEY.has(value.trim().toLowerCase());
}

/**
 * Map a stored value onto its canonical spelling.
 *
 * Case-insensitive so a legacy "music" row lights up the "Music" chip instead
 * of appearing as a second, unselectable tag next to it. Returns null for a
 * value that is genuinely not in the taxonomy.
 */
export function canonicalizeInterest(value: string): CanonicalInterest | null {
  return CANONICAL_BY_KEY.get(value.trim().toLowerCase()) ?? null;
}

export type InterestSelectionError =
  | { code: "too_many"; message: string }
  | { code: "not_canonical"; message: string };

export type InterestSelectionResult =
  | { ok: true; interests: CanonicalInterest[] }
  | { ok: false; error: InterestSelectionError };

/**
 * Validate a submitted selection.
 *
 * Runs on the server against the request body, never on trust in the picker:
 * the editor limits what can be chosen, but the action is the authority.
 * Duplicates and casing differences are normalised here rather than rejected,
 * because they are a client bug, not a person doing something wrong.
 */
export function validateInterestSelection(values: readonly string[]): InterestSelectionResult {
  const interests: CanonicalInterest[] = [];

  for (const value of values) {
    const canonical = canonicalizeInterest(value);
    if (!canonical) {
      return {
        ok: false,
        error: { code: "not_canonical", message: "That isn't one of the available interests." }
      };
    }
    if (!interests.includes(canonical)) interests.push(canonical);
  }

  if (interests.length > MAX_INTERESTS) {
    return {
      ok: false,
      error: { code: "too_many", message: `Choose up to ${MAX_INTERESTS} interests.` }
    };
  }

  return { ok: true, interests };
}

export type DisplayInterest = { value: string; canonical: boolean };

/**
 * What the profile shows.
 *
 * Legacy values that predate the taxonomy are kept and flagged rather than
 * hidden: dropping them would silently erase something the person chose. The
 * picker shows them as selected-but-removable, so the set converges on the
 * taxonomy as people edit, without a migration deleting anything.
 */
export function toDisplayInterests(stored: readonly string[]): DisplayInterest[] {
  const seen = new Set<string>();
  const display: DisplayInterest[] = [];

  for (const raw of stored) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const canonical = canonicalizeInterest(trimmed);
    const value = canonical ?? trimmed;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    display.push({ value, canonical: canonical !== null });
  }

  return display;
}

/**
 * The diff a save has to apply.
 *
 * Returned as add/remove rather than "delete everything then insert the new
 * set", so a failure cannot leave a profile with no interests at all. Legacy
 * values the person did not touch are left alone.
 */
export function diffInterests(
  current: readonly string[],
  next: readonly string[]
): { add: string[]; remove: string[] } {
  const currentKeys = new Map(current.map((value) => [value.trim().toLowerCase(), value]));
  const nextKeys = new Map(next.map((value) => [value.trim().toLowerCase(), value]));

  const add: string[] = [];
  for (const [key, value] of nextKeys) {
    if (!currentKeys.has(key)) add.push(value);
  }

  const remove: string[] = [];
  for (const [key, value] of currentKeys) {
    if (!nextKeys.has(key)) remove.push(value);
  }

  return { add, remove };
}
