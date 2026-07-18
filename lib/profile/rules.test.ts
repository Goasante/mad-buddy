import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIELD_PRIVACY,
  SEARCH_RESULT_FIELDS,
  canChangeUsername,
  isReservedUsername,
  normalizeUsername,
  profileCompletionPercent,
  remainingCompletionTasks,
  resolveFieldVisibility,
  usernameChangeAvailableInDays,
  validateBio,
  validateDisplayName,
  validateUsername,
  type ProfileCompletionInput
} from "@/lib/profile/rules";

const NOW = Date.parse("2026-07-17T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("username rules (spec §7)", () => {
  it("enforces length and character set", () => {
    expect(validateUsername("ab")).toMatch(/at least/);
    expect(validateUsername("x".repeat(25))).toMatch(/at most/);
    expect(validateUsername("has space")).toMatch(/letters, numbers/);
    expect(validateUsername("has-dash")).toMatch(/letters, numbers/);
    expect(validateUsername("ama_serwaa1")).toBeNull();
  });

  it("protects reserved names so an account can't impersonate Mad Buddy", () => {
    for (const name of ["admin", "support", "security", "official", "madbuddy", "verification", "system"]) {
      expect(isReservedUsername(name), name).toBe(true);
      expect(validateUsername(name), name).toMatch(/isn't available/);
    }
    // Case-insensitively.
    expect(validateUsername("AdMiN")).toMatch(/isn't available/);
  });

  it("normalizes for case-insensitive uniqueness", () => {
    expect(normalizeUsername("  AmaSerwaa ")).toBe("amaserwaa");
    expect(normalizeUsername("AMA")).toBe(normalizeUsername("ama"));
  });

  it("rate-limits changes to once every 30 days", () => {
    expect(canChangeUsername({ lastChangedAtMs: null, nowMs: NOW })).toBe(true);
    expect(canChangeUsername({ lastChangedAtMs: NOW - 10 * DAY, nowMs: NOW })).toBe(false);
    expect(canChangeUsername({ lastChangedAtMs: NOW - 31 * DAY, nowMs: NOW })).toBe(true);
    expect(usernameChangeAvailableInDays({ lastChangedAtMs: NOW - 10 * DAY, nowMs: NOW })).toBe(20);
  });
});

describe("display name rules (spec §8)", () => {
  it("accepts unicode and emoji but rejects markup and blank-only names", () => {
    expect(validateDisplayName("Ama Serwaa 🎓")).toBeNull();
    expect(validateDisplayName("")).toMatch(/display name/);
    expect(validateDisplayName("<script>")).toMatch(/</);
    // Zero-width characters only, renders blank, a known impersonation trick.
    expect(validateDisplayName("​​")).toMatch(/people can read/);
    expect(validateDisplayName("x".repeat(51))).toMatch(/at most/);
  });

  it("bounds the bio", () => {
    expect(validateBio("x".repeat(301))).toMatch(/at most/);
    expect(validateBio("Second year at UGBS")).toBeNull();
  });
});

describe("profile field privacy (spec §5, §6)", () => {
  it("defaults nothing optional wider than approved Muddies", () => {
    for (const visibility of Object.values(DEFAULT_FIELD_PRIVACY)) {
      expect(["only_me", "approved_muddies", "close_friends", "shared_communities"]).toContain(visibility);
    }
    expect(DEFAULT_FIELD_PRIVACY.bio).toBe("approved_muddies");
  });

  it("always shows the owner their own field", () => {
    expect(resolveFieldVisibility({ visibility: "only_me", relationship: "self" })).toBe(true);
  });

  it("hides only_me from everyone else", () => {
    for (const relationship of ["close_friend", "approved_muddy", "shared_community", "stranger"] as const) {
      expect(resolveFieldVisibility({ visibility: "only_me", relationship }), relationship).toBe(false);
    }
  });

  it("treats close friends as a subset of approved Muddies", () => {
    expect(resolveFieldVisibility({ visibility: "approved_muddies", relationship: "close_friend" })).toBe(true);
    expect(resolveFieldVisibility({ visibility: "close_friends", relationship: "approved_muddy" })).toBe(false);
  });

  it("never shows optional fields to strangers", () => {
    for (const visibility of ["approved_muddies", "close_friends", "shared_communities"] as const) {
      expect(resolveFieldVisibility({ visibility, relationship: "stranger" }), visibility).toBe(false);
    }
  });

  it("keeps search results to a tiny field set (spec §6)", () => {
    expect([...SEARCH_RESULT_FIELDS]).toEqual(["display_name", "username", "avatar_url"]);
    // Nothing location-shaped or contact-shaped may appear in search.
    for (const field of SEARCH_RESULT_FIELDS) {
      expect(field).not.toMatch(/location|distance|phone|email|address/);
    }
  });
});

describe("profile completion (spec §10)", () => {
  function completion(overrides: Partial<ProfileCompletionInput> = {}): ProfileCompletionInput {
    return {
      hasDisplayName: true,
      hasUsername: true,
      hasPhoto: false,
      hasBio: false,
      hasInstitution: false,
      hasInterests: false,
      hasFirstMuddy: false,
      ...overrides
    };
  }

  it("computes a private percentage", () => {
    expect(profileCompletionPercent(completion())).toBe(29);
    expect(
      profileCompletionPercent(
        completion({ hasPhoto: true, hasBio: true, hasInstitution: true, hasInterests: true, hasFirstMuddy: true })
      )
    ).toBe(100);
  });

  it("suggests the remaining tasks", () => {
    const tasks = remainingCompletionTasks(completion({ hasPhoto: true }));
    expect(tasks.map((task) => task.id)).toEqual(["bio", "institution", "interests", "first_muddy"]);
  });
});
