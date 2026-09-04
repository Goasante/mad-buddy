import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Browser-role WRITE authority.
 *
 * RLS narrows a base privilege; it can never supply one. So a table can carry a
 * correct owner policy and still reject the write, and the failure only appears
 * on a database built from scratch -- which is how it reached a release
 * candidate: `profiles` had "profiles owner full access" (FOR ALL) but
 * `authenticated` held only SELECT, so updateVisibilityStatus() returned 42501
 * and a new account could never leave `ghost`.
 *
 * The previous audit missed it for a specific, repeatable reason: it decided
 * whether a mutation was browser-transported by looking for a client
 * CONSTRUCTOR in the same file. `lib/settings/service.ts` constructs nothing --
 * it takes `rlsClient: SupabaseClient` as a parameter and its caller supplies
 * the user-scoped client. Every mutation in that file was invisible.
 *
 * These tests pin both halves: the grants that were missing, and the
 * transport-agnostic services that hid them.
 */

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

/** Strip `--` comments so prose about a grant is never read as a grant. */
const sqlOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");

const allSql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => sqlOf(readFileSync(path.join(MIGRATIONS, f), "utf8")))
  .join("\n");

const d4 = sqlOf(
  readFileSync(path.join(MIGRATIONS, "20260904180000_browser_role_write_grant_reproducibility.sql"), "utf8")
);

/** Columns of `profiles` that browser-role code legitimately writes. */
const BROWSER_WRITABLE = ["full_name", "username", "username_normalized", "bio", "mood_status", "visibility_status"];

/**
 * Columns a signed-in person must NEVER be able to set on their own row.
 * trusted_member_since is granted by staff review; the other two are written
 * only through the admin client.
 */
const PROTECTED = ["trusted_member_since", "is_onboarded", "deleted_at", "created_at", "user_id"];

describe("the visibility blocker is repaired", () => {
  it("grants UPDATE on visibility_status to authenticated", () => {
    expect(d4).toMatch(/grant\s+update\s*\([^)]*\bvisibility_status\b[^)]*\)\s*\n?\s*on\s+public\.profiles\s+to\s+authenticated/i);
  });

  it("grants the columns updateProfile() writes", () => {
    const update = /grant\s+update\s*\(([^)]*)\)\s*\n?\s*on\s+public\.profiles/i.exec(d4)?.[1] ?? "";
    for (const col of ["full_name", "username", "username_normalized", "bio", "mood_status"]) {
      expect(update, `profiles UPDATE must cover ${col}`).toContain(col);
    }
  });

  it("grants profile_field_privacy the SELECT its upsert needs", () => {
    // INSERT+UPDATE alone leaves .upsert({ onConflict }) failing 42501: PostgREST
    // has to read the conflict target.
    expect(d4).toMatch(/grant\s+select\s*,\s*insert\s*,\s*update\s+on\s+public\.profile_field_privacy\s+to\s+authenticated/i);
  });
});

describe("row ownership does not become privilege escalation", () => {
  it("never grants table-level UPDATE on profiles", () => {
    // The small fix and the wrong one: RLS scopes ROWS, not COLUMNS, so a
    // table-level grant under a FOR ALL owner policy hands every column over.
    const tableLevel = /grant\s+(?:[a-z, ]*\b)?update\s+on\s+public\.profiles\s+to\s+(authenticated|anon)/i;
    expect(allSql).not.toMatch(tableLevel);
  });

  it("never grants ALL on profiles to a browser role", () => {
    expect(allSql).not.toMatch(/grant\s+all\s+(?:privileges\s+)?on\s+public\.profiles\s+to\s+(authenticated|anon)/i);
  });

  it("keeps staff- and server-controlled columns out of every browser grant", () => {
    const grants = [...allSql.matchAll(/grant\s+(?:insert|update)\s*\(([^)]*)\)\s*\n?\s*on\s+public\.profiles\s+to\s+(authenticated|anon)/gi)];
    expect(grants.length).toBeGreaterThan(0);
    for (const [, cols] of grants) {
      const listed = cols.split(",").map((c) => c.trim());
      for (const col of PROTECTED) {
        // user_id is insertable on creation but must never be UPDATEable; the
        // update grant is checked separately below.
        if (col === "user_id") continue;
        expect(listed, `${col} must never be browser-writable`).not.toContain(col);
      }
    }
  });

  it("never lets a browser role rewrite user_id", () => {
    const update = /grant\s+update\s*\(([^)]*)\)\s*\n?\s*on\s+public\.profiles/i.exec(d4)?.[1] ?? "";
    expect(update.split(",").map((c) => c.trim())).not.toContain("user_id");
  });

  it("grants no DELETE on profiles to a browser role", () => {
    expect(allSql).not.toMatch(/grant\s+(?:[a-z, ]*\b)?delete\s+on\s+public\.profiles\s+to\s+(authenticated|anon)/i);
  });

  it("grants nothing here to anon", () => {
    expect(d4).not.toMatch(/\bto\s+anon\b/i);
  });

  it("adds no ALTER DEFAULT PRIVILEGES for browser roles", () => {
    // A future table must earn its grant by review rather than inherit one.
    expect(d4).not.toMatch(/alter\s+default\s+privileges[\s\S]*?to\s+(authenticated|anon)/i);
  });
});

describe("the audit blind spot that hid this", () => {
  const services = ["lib/settings/service.ts", "lib/profile/service.ts"];

  it("transport-agnostic services still take an RLS client as a parameter", () => {
    // If this changes shape, the auditor's caller-resolution needs revisiting.
    for (const rel of services) {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, `${rel} should receive its client`).toMatch(/rlsClient\s*:\s*SupabaseClient/);
    }
  });

  it("those services construct no client of their own", () => {
    // Precisely why a file-scoped constructor scan could not see them.
    for (const rel of services) {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      expect(src).not.toMatch(/createSupabaseBrowserClient\s*\(/);
    }
  });

  it("settings service really does write profiles through that client", () => {
    const src = readFileSync(path.join(ROOT, "lib/settings/service.ts"), "utf8");
    expect(src).toMatch(/rlsClient[\s\S]{0,80}\.from\("profiles"\)[\s\S]{0,120}\.update\(/);
    expect(src).toMatch(/visibility_status/);
  });

  it("every column that service writes is covered by a grant", () => {
    // The contract this whole tranche exists to hold: a browser-role write
    // without its base privilege is a fresh-database outage.
    const update = /grant\s+update\s*\(([^)]*)\)\s*\n?\s*on\s+public\.profiles/i.exec(d4)?.[1] ?? "";
    const granted = update.split(",").map((c) => c.trim());
    for (const col of BROWSER_WRITABLE) {
      expect(granted, `${col} is written by browser-role code and needs a grant`).toContain(col);
    }
  });
});

describe("the historical migration is left intact", () => {
  it("does not edit 20260903140000", () => {
    const prior = readFileSync(path.join(MIGRATIONS, "20260903140000_browser_role_grant_reproducibility.sql"), "utf8");
    // It granted SELECT and stopped there; that remains the historical truth.
    expect(prior).toMatch(/grant select on public\.profiles to authenticated/i);
    expect(sqlOf(prior)).not.toMatch(/grant\s+update[\s\S]{0,40}public\.profiles/i);
  });
});
