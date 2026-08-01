import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260801150000_profile_birth_details.sql"),
  "utf8"
).toLowerCase();

describe("profile birth details migration", () => {
  it("stores the raw date outside the broadly readable profiles table", () => {
    expect(sql).toContain("create table if not exists public.profile_birth_details");
    expect(sql).not.toMatch(/alter table public\.profiles[\s\S]*date_of_birth/);
  });

  it("enforces owner-only RLS and blocks anonymous access", () => {
    expect(sql).toContain("alter table public.profile_birth_details enable row level security");
    expect(sql).toContain("for select using (auth.uid() = user_id)");
    expect(sql).toContain("for insert with check (auth.uid() = user_id)");
    expect(sql).toContain("for update using (auth.uid() = user_id) with check (auth.uid() = user_id)");
    expect(sql).toContain("for delete using (auth.uid() = user_id)");
    expect(sql).toContain("revoke all on table public.profile_birth_details from anon");
  });

  it("adds only derived-field privacy keys and validates the source date", () => {
    for (const field of ["birthday", "age", "zodiac"]) expect(sql).toContain(`'${field}'`);
    expect(sql).toContain("date of birth cannot be in the future");
    expect(sql).toContain("interval '120 years'");
  });
});
