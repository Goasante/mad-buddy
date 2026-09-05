import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Editing a profile is not creating one.
 *
 * updateProfile() saved through `.upsert(..., { onConflict: "user_id" })`.
 * PostgreSQL requires table-level INSERT for ON CONFLICT DO UPDATE even when
 * every written column is granted individually, so a browser-role save failed
 * 42501 and the bio silently never changed -- the button was enabled, two
 * POSTs fired, and nothing happened.
 *
 * The tempting fix was a table-wide INSERT grant. That would have handed every
 * signed-in person authority over columns the owner policy does not scope:
 * trusted_member_since is granted by staff review, and is_onboarded and
 * deleted_at are written only through the admin client. The column grants exist
 * precisely to prevent that.
 *
 * So the responsibilities stay split, and these tests hold the line:
 *
 *   bootstrap creates   ensureProfileForUser(), admin client
 *   edit updates        updateProfile(), RLS client, existing row only
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Strip comments so prose about an operation is never read as the operation. */
const codeOf = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((l) => (l.indexOf("//") === -1 ? l : l.slice(0, l.indexOf("//"))))
    .join("\n");

const service = codeOf(read("lib/profile/service.ts"));
const bootstrap = codeOf(read("lib/profiles/ensure-profile.ts"));
const migration = codeOf(read("supabase/migrations/20260904180000_browser_role_write_grant_reproducibility.sql"));

/** The profiles persistence call inside updateProfile(). */
const updateBlock =
  /const \{ data: savedProfile, error \} = await rlsClient[\s\S]*?maybeSingle\(\);/.exec(service)?.[0] ?? "";

describe("profile editing updates an existing row", () => {
  it("has a profiles persistence call to inspect", () => {
    expect(updateBlock).not.toBe("");
  });

  it("uses UPDATE, never UPSERT or INSERT", () => {
    expect(updateBlock).toMatch(/\.update\(\{/);
    expect(updateBlock).not.toMatch(/\.upsert\(/);
    expect(updateBlock).not.toMatch(/\.insert\(/);
    expect(updateBlock).not.toMatch(/onConflict/);
  });

  it("scopes the write to the caller's own row", () => {
    expect(updateBlock).toMatch(/\.eq\("user_id", userId\)/);
  });

  it("never sends user_id as an editable field", () => {
    // Row identity and the owner filter, not a profile field.
    const payload = /\.update\(\{([\s\S]*?)\}\)/.exec(updateBlock)?.[1] ?? "";
    expect(payload).not.toBe("");
    expect(payload).not.toMatch(/\buser_id\b/);
  });

  it("writes only the owner-editable columns", () => {
    const payload = /\.update\(\{([\s\S]*?)\}\)/.exec(updateBlock)?.[1] ?? "";
    for (const col of ["full_name", "username", "username_normalized", "bio", "mood_status"]) {
      expect(payload, `${col} should still be saved`).toContain(col);
    }
    for (const col of ["trusted_member_since", "is_onboarded", "deleted_at", "created_at", "visibility_status"]) {
      expect(payload, `${col} must never be written from the edit path`).not.toContain(col);
    }
  });

  it("keeps the username uniqueness message", () => {
    expect(service).toMatch(/error\.code === "23505"[\s\S]{0,120}already in use/);
  });

  it("fails rather than creating a row when none is visible", () => {
    // .maybeSingle() returns null when the filter matches nothing; that must be
    // a failure, not a silent success and never an INSERT fallback.
    expect(service).toMatch(/if \(!savedProfile\) \{[\s\S]{0,140}return \{ ok: false/);
  });
});

describe("creating a profile stays a server responsibility", () => {
  it("bootstrap writes profiles through the admin client", () => {
    expect(bootstrap).toMatch(/\.from\("profiles"\)[\s\S]{0,80}\.upsert\(/);
  });

  it("bootstrap never uses a browser or cookie-session client", () => {
    expect(bootstrap).not.toMatch(/createSupabaseBrowserClient|createSupabaseServerClient/);
  });

  it("the edit service does not fall back to bootstrap", () => {
    // Merging create into edit is what the 42501 tempted; keep them apart.
    expect(service).not.toMatch(/ensureProfileForUser/);
  });
});

describe("the D4 least-privilege posture survives", () => {
  it("grants no table-wide INSERT on profiles to a browser role", () => {
    expect(migration).not.toMatch(/grant\s+(?:[a-z, ]*\b)?insert\s+on\s+public\.profiles\s+to\s+(authenticated|anon)/i);
  });

  it("grants no table-wide UPDATE on profiles to a browser role", () => {
    expect(migration).not.toMatch(/grant\s+(?:[a-z, ]*\b)?update\s+on\s+public\.profiles\s+to\s+(authenticated|anon)/i);
  });

  it("still grants the owner-editable columns", () => {
    const update = /grant\s+update\s*\(([^)]*)\)\s*\n?\s*on\s+public\.profiles/i.exec(migration)?.[1] ?? "";
    for (const col of ["full_name", "username", "username_normalized", "bio", "mood_status", "visibility_status"]) {
      expect(update).toContain(col);
    }
  });
});

describe("both callers share the same service", () => {
  it("the web action passes an RLS-scoped client", () => {
    const actions = codeOf(read("app/(app)/actions.ts"));
    expect(actions).toMatch(/createSupabaseServerClient\(\)[\s\S]{0,200}updateProfile\(supabase, userId, input\)/);
  });

  it("the mobile API route passes its authenticated client", () => {
    const route = codeOf(read("app/api/profile/route.ts"));
    expect(route).toMatch(/updateProfile\(auth\.supabase, auth\.user\.id, input\)/);
  });
});
