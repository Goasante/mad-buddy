/**
 * Profile domain core (feature architecture batch 9, spec §4-§17). Pure and
 * deterministic: username/display-name validation, per-field privacy
 * resolution, and profile completion.
 *
 * Product stance encoded here: a profile is for *recognition*, not promotion.
 * There is no public completeness score and no field that carries a precise
 * address, timetable, or location (spec §4).
 */

// ---------------------------------------------------------------------------
// Username (spec §7)
// ---------------------------------------------------------------------------

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 24;
export const USERNAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Names that must never be claimable, because holding one lets an account
 * impersonate Mad Buddy itself (spec §7).
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "support",
  "security",
  "official",
  "madbuddy",
  "mad_buddy",
  "verification",
  "verified",
  "system",
  "help",
  "moderator",
  "staff",
  "team",
  "root",
  "api",
  "billing",
  "settings",
  "login",
  "signup"
]);

/** Canonical form used for case-insensitive uniqueness (spec §7). */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(normalizeUsername(username));
}

export function validateUsername(username: string): string | null {
  const trimmed = username.trim();
  if (trimmed.length < USERNAME_MIN_LENGTH) {
    return `Usernames are at least ${USERNAME_MIN_LENGTH} characters.`;
  }
  if (trimmed.length > USERNAME_MAX_LENGTH) {
    return `Usernames are at most ${USERNAME_MAX_LENGTH} characters.`;
  }
  if (!/^[A-Za-z0-9_]+$/.test(trimmed)) {
    return "Usernames can use letters, numbers, and underscores only.";
  }
  if (isReservedUsername(trimmed)) return "That username isn't available.";
  return null;
}

/** Usernames are rate-limited to once per 30 days (spec §7). */
export function canChangeUsername(input: { lastChangedAtMs: number | null; nowMs: number }): boolean {
  if (input.lastChangedAtMs === null) return true;
  return input.nowMs - input.lastChangedAtMs >= USERNAME_CHANGE_COOLDOWN_MS;
}

export function usernameChangeAvailableInDays(input: {
  lastChangedAtMs: number;
  nowMs: number;
}): number {
  const remaining = USERNAME_CHANGE_COOLDOWN_MS - (input.nowMs - input.lastChangedAtMs);
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}

// ---------------------------------------------------------------------------
// Display name (spec §8)
// ---------------------------------------------------------------------------

export const DISPLAY_NAME_MAX_LENGTH = 50;

export function validateDisplayName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 1) return "Add a display name.";
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    return `Display names are at most ${DISPLAY_NAME_MAX_LENGTH} characters.`;
  }
  if (/[<>]/.test(trimmed)) return "Display names can't contain < or >.";
  // Reject names made only of invisible characters, they render as blank and
  // are a known impersonation trick (spec §8).
  const visible = trimmed.replace(/[​-‍﻿⁠­\s]/g, "");
  if (visible.length < 1) return "Add a display name people can read.";
  return null;
}

export const BIO_MAX_LENGTH = 300;

export function validateBio(bio: string): string | null {
  if (bio.trim().length > BIO_MAX_LENGTH) return `Bios are at most ${BIO_MAX_LENGTH} characters.`;
  return null;
}

// ---------------------------------------------------------------------------
// Per-field privacy (spec §5)
// ---------------------------------------------------------------------------

export type ProfileField =
  | "bio"
  | "institution"
  | "programme"
  | "graduation_year"
  | "general_area"
  | "interests"
  | "pronouns";

export type FieldVisibility = "only_me" | "approved_muddies" | "close_friends" | "shared_communities";

/** Conservative defaults: nothing optional is broader than approved Muddies. */
export const DEFAULT_FIELD_PRIVACY: Record<ProfileField, FieldVisibility> = {
  bio: "approved_muddies",
  institution: "shared_communities",
  programme: "approved_muddies",
  graduation_year: "approved_muddies",
  general_area: "approved_muddies",
  interests: "approved_muddies",
  pronouns: "approved_muddies"
};

export type ViewerRelationship = "self" | "close_friend" | "approved_muddy" | "shared_community" | "stranger";

/**
 * Whether `viewer` may see one profile field. The owner always sees their own.
 * A blocked viewer is handled upstream, by the time we get here, blocks have
 * already removed the profile from view entirely.
 */
export function resolveFieldVisibility(input: {
  visibility: FieldVisibility;
  relationship: ViewerRelationship;
}): boolean {
  if (input.relationship === "self") return true;
  switch (input.visibility) {
    case "only_me":
      return false;
    case "close_friends":
      return input.relationship === "close_friend";
    case "approved_muddies":
      // Close friends are a subset of approved Muddies.
      return input.relationship === "close_friend" || input.relationship === "approved_muddy";
    case "shared_communities":
      return (
        input.relationship === "close_friend" ||
        input.relationship === "approved_muddy" ||
        input.relationship === "shared_community"
      );
    default:
      return false;
  }
}

/** Fields a search result may ever show, deliberately tiny (spec §6). */
export const SEARCH_RESULT_FIELDS = ["display_name", "username", "avatar_url"] as const;

// ---------------------------------------------------------------------------
// Profile completion (spec §10), private only, never a public score.
// ---------------------------------------------------------------------------

export type ProfileCompletionInput = {
  hasDisplayName: boolean;
  hasUsername: boolean;
  hasPhoto: boolean;
  hasBio: boolean;
  hasInstitution: boolean;
  hasInterests: boolean;
  hasFirstMuddy: boolean;
};

export type CompletionTask = { id: string; label: string };

export function profileCompletionPercent(input: ProfileCompletionInput): number {
  const checks = [
    input.hasDisplayName,
    input.hasUsername,
    input.hasPhoto,
    input.hasBio,
    input.hasInstitution,
    input.hasInterests,
    input.hasFirstMuddy
  ];
  const done = checks.filter(Boolean).length;
  return Math.round((done / checks.length) * 100);
}

export function remainingCompletionTasks(input: ProfileCompletionInput): CompletionTask[] {
  const tasks: CompletionTask[] = [];
  if (!input.hasPhoto) tasks.push({ id: "photo", label: "Add a profile photo" });
  if (!input.hasBio) tasks.push({ id: "bio", label: "Write a short bio" });
  if (!input.hasInstitution) tasks.push({ id: "institution", label: "Add your institution" });
  if (!input.hasInterests) tasks.push({ id: "interests", label: "Choose a few interests" });
  if (!input.hasFirstMuddy) tasks.push({ id: "first_muddy", label: "Add your first Muddy" });
  return tasks;
}
