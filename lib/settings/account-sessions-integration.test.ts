import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260923223709_mirror_auth_sessions_for_account_devices.sql");
const page = read("app/(app)/settings/sessions/page.tsx");
const component = read("components/settings/sessions-page.tsx");
const actions = read("app/(app)/settings-actions.ts");

describe("account session projection", () => {
  it("mirrors authoritative auth sessions without token or IP material", () => {
    expect(migration).toContain("after insert or update or delete on auth.sessions");
    expect(migration).toContain("public.account_sessions");
    expect(migration).not.toMatch(/access_token|refresh_token|\bip\b/);
  });

  it("is owner-readable and not user-writable", () => {
    expect(migration).toContain("alter table public.account_sessions enable row level security");
    expect(migration).toContain("for select");
    expect(migration).toContain("(select auth.uid()) = user_id");
    expect(migration).not.toMatch(/for (?:insert|update|delete|all)/);
  });

  it("lists every session and marks the current JWT session", () => {
    expect(page).toContain('claims.session_id');
    expect(page).toContain('.from("account_sessions")');
    expect(component).toContain("sessions.map");
    expect(component).toContain("This device");
    expect(component).toContain("Last active");
  });

  it("revokes other Supabase sessions and clears their projection", () => {
    expect(actions).toContain('signOut({ scope: "others" })');
    expect(actions).toContain('.from("account_sessions")');
    expect(actions).toContain('.neq("session_id", currentSessionId)');
  });
});
