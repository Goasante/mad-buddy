import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ONE OWNER FOR THE PROFILE BOOTSTRAP SHAPE.
 *
 * MB-GOD-054. `sendFriendRequest` reimplemented `ensureProfileForUser` inline
 * and disagreed with it: no `username_normalized` -- which onboarding's
 * uniqueness check reads through
 * `.or(username.eq.…,username_normalized.eq.…)` -- no `avatar_url`, and no
 * `visibility_status: "ghost"`. A person bootstrapped by the copy started
 * VISIBLE while the canonical path starts them hidden, which is a privacy
 * default decided in two places.
 *
 * The defensive bootstrap itself is legitimate and stays: /api/friends/request
 * reaches the friendship service without passing through Home, which is the
 * surface that otherwise guarantees a profile exists. What must not recur is a
 * second definition of what a new profile looks like.
 */

const ROOT = join(__dirname, "..", "..");
const friends = readFileSync(join(ROOT, "lib/friends/service.ts"), "utf8");
const helper = readFileSync(join(ROOT, "lib/profiles/ensure-profile.ts"), "utf8");

describe("profile bootstrap has one owner", () => {
  it("the friendship service delegates rather than bootstrapping", () => {
    expect(friends).toContain("ensureProfileForUserId");
  });

  it("the friendship service does not write profiles itself", () => {
    /* The duplicated implementation's fingerprint. `.select` on profiles is
       fine -- reading a Muddy's name is this file's job; WRITING the bootstrap
       shape is not. */
    expect(friends, "the friendship service inserts profiles again").not.toMatch(
      /from\("profiles"\)\s*\n?\s*\.(insert|upsert)/
    );
  });

  it("does not reinvent the identity fallbacks", () => {
    // The copy's own literals. Their return means the second shape is back.
    expect(friends).not.toContain('"Mad Buddy user"');
    expect(friends, "username derivation belongs to the canonical helper")
      .not.toContain("user_metadata");
  });

  it("the canonical helper still sets every field the copy omitted", () => {
    /* These three are the whole reason the duplication mattered. If the helper
       ever stops setting them, consolidating on it would have propagated the
       weaker shape rather than fixing it. */
    for (const field of ["username_normalized", "avatar_url", 'visibility_status: "ghost"']) {
      expect(helper, `the canonical bootstrap no longer sets ${field}`).toContain(field);
    }
  });

  it("the id-addressed variant fetches the auth user only on the miss path", () => {
    /* The hot path must not grow a round trip: a caller whose profile exists
       should pay exactly one existence check, as it did before. */
    const idVariant = helper.slice(helper.indexOf("export async function ensureProfileForUserId"));
    const existenceCheck = idVariant.indexOf("maybeSingle()");
    const authFetch = idVariant.indexOf("getUserById");
    expect(existenceCheck, "no existence check in the id-addressed variant").toBeGreaterThan(-1);
    expect(authFetch, "no auth lookup in the id-addressed variant").toBeGreaterThan(-1);
    expect(authFetch, "the auth user is fetched before the existence check")
      .toBeGreaterThan(existenceCheck);
    expect(idVariant).toContain("if (existing) return existing;");
  });
});
