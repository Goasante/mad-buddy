import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260719160000_client_exposure_security_hardening.sql"),
  "utf8"
).toLowerCase();

describe("client database privileges", () => {
  it("prevents direct friendship fabrication and ownership-field writes", () => {
    expect(migration).toContain("revoke insert on table public.friendships from anon, authenticated");
    expect(migration).toContain("revoke insert, update on table public.friend_requests from anon, authenticated");
    expect(migration).toContain("revoke insert, update on table public.meetup_requests from anon, authenticated");
  });

  it("keeps raw-location and notification mutations behind server routes", () => {
    expect(migration).toContain("revoke insert, update, delete on table public.user_locations from anon, authenticated");
    expect(migration).toContain("revoke insert, update, delete on table public.notifications from anon, authenticated");
  });

  it("removes direct exposure of internal restriction metadata", () => {
    expect(migration).toContain("drop policy if exists \"restrictions visible to subject\"");
    expect(migration).toContain("revoke select, insert, update, delete on table public.user_restrictions from anon, authenticated");
  });
});
