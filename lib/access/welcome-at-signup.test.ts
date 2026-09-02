import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const MIGRATION = "supabase/migrations/20260902120000_welcome_access_at_signup.sql";

/**
 * Welcome Access has to be there the moment somebody signs up.
 *
 * The reported defect: a new user opened UpFor or Linkr and hit a payment
 * screen. Not a bug in the resolver -- the window was deliberately triggered by
 * `first_muddy_added`, so an account with no friendships genuinely had no
 * grant. The product decision changed; these assertions pin the new rule and,
 * more importantly, the properties that must survive it.
 */

describe("the window opens at signup", () => {
  it("triggers on the row every account has", () => {
    const sql = read(MIGRATION);

    // `profiles` rather than `auth.users`: the bootstrap deletes the auth user
    // outright if the profile insert fails, so there is no account without one.
    expect(sql).toContain("after insert on public.profiles");
    expect(sql).toContain("start_welcome_access_at_signup");
  });

  it("grants the same 14 days as the friendship path", () => {
    expect(read(MIGRATION)).toContain("v_duration_days integer := 14");
  });

  it("writes a welcome_access grant, not a subscription or a tier", () => {
    const sql = read(MIGRATION);
    expect(sql).toContain("insert into public.access_grants");
    expect(sql).toContain("'welcome_access'");
    expect(sql).not.toMatch(/buddy_plus|buddy_pro/);
  });
});

describe("whichever fires first is the only one that counts", () => {
  it("keeps the original friendship trigger rather than replacing it", () => {
    const sql = read(MIGRATION);

    // Dropping it would move the window for anybody who signed up before this
    // change and adds their first Muddy afterwards.
    expect(sql).not.toMatch(/drop trigger if exists friendships_start_welcome_access/);
    expect(sql).not.toMatch(/drop function[\s\S]*start_welcome_access\(\)/);
  });

  it("relies on the partial unique index for idempotency", () => {
    // This is what makes two triggers safe: the second insert is a no-op, so
    // nobody gets two windows and nobody's window is extended.
    expect(read(MIGRATION)).toContain("on conflict (user_id) where source = 'welcome_access' do nothing");
  });

  it("does not backfill existing accounts", () => {
    const sql = read(MIGRATION);

    // A backfill would hand a fresh 14 days to people who signed up months ago
    // and to anyone whose window is already spent. That is a giveaway, not a
    // migration, and it is not this change's to make.
    expect(sql).not.toMatch(/insert into public\.access_grants[\s\S]*from public\.profiles/i);
    expect(sql).not.toMatch(/update public\.access_grants/i);
  });
});

describe("the grant stays privileged", () => {
  it("runs as security definer with a pinned search_path", () => {
    const sql = read(MIGRATION);
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public, pg_temp");
  });

  it("is not executable by users", () => {
    // Access is written by triggers and the service role only. RLS gives no
    // user-facing INSERT policy on access_grants, and this keeps the function
    // from becoming a way around that.
    expect(read(MIGRATION)).toContain(
      "revoke all on function public.start_welcome_access_at_signup() from public, anon, authenticated"
    );
  });
});

describe("the documented model matches the code", () => {
  it("states that the window starts at account creation", () => {
    const doc = read("docs/product/MONETIZATION-ACCESS-MODEL.md");
    expect(doc).toMatch(/Account creation, or `first_muddy_added`/);
    expect(doc).not.toMatch(/### Why it starts at the first Muddy/);
  });

  it("records that the change is not retroactive", () => {
    expect(read("docs/product/MONETIZATION-ACCESS-MODEL.md")).toMatch(/not retroactive/i);
  });
});
