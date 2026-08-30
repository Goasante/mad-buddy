import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const page = read("components/hangout/hangout-mode-page.tsx");
const planning = read("lib/social/planning.ts");
const actions = read("app/(app)/hangout-actions.ts");

/**
 * THE DEFECT THIS FILE EXISTS FOR.
 *
 * `editing` was derived from `activeHangout !== null` -- from whether the owner
 * happened to have an UpFor at all -- and an edit ends the previous session.
 * So creating B cancelled A, and creating C cancelled B. Production data showed
 * exactly that chain: three sessions created minutes apart, two of them
 * `cancelled`.
 *
 * The backend ceiling of three was never the problem; the client could not
 * represent what the database already allowed.
 */
describe("creating an UpFor never ends another one", () => {
  it("derives edit mode from explicit intent, not from existence", () => {
    expect(page).toContain("const editing = editingUpForId !== null;");
    expect(page).toContain("const previousId = editingUpForId;");
  });

  it("no longer treats having any UpFor as editing it", () => {
    // The exact expression that caused the outage.
    expect(page).not.toContain("const editing = isActive && activeHangout !== null;");
    expect(page).not.toContain("const previousId = activeHangout?.id;");
  });

  it("offers a create path that clears any edit target first", () => {
    // Reaching for Create while an UpFor runs means "another one", so the
    // target must be cleared or the next submit would end a sibling.
    const openCreate = page.slice(page.indexOf("function openCreate("));
    expect(openCreate.slice(0, 400)).toContain("setEditingUpForId(null)");
  });

  it("offers an edit path that names one UpFor by id", () => {
    const openEdit = page.slice(page.indexOf("function openEdit("));
    expect(openEdit.slice(0, 300)).toContain("setEditingUpForId(target.id)");
  });

  it("clears the edit target on every exit from the form", () => {
    // A stale id would make the NEXT create behave as an edit -- the same bug
    // returning by a different route.
    expect((page.match(/setEditingUpForId\(null\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("the owner can load every UpFor they hold", () => {
  it("exposes a multi-session loader, not just the newest one", () => {
    expect(planning).toContain("export async function ownedUpForSessions(");
  });

  it("selects starts_at, so scheduled can be told from live", () => {
    const loader = planning.slice(planning.indexOf("export async function ownedUpForSessions("));
    expect(loader.slice(0, 900)).toContain("starts_at");
  });

  it("does not cap the owner's own sessions at one", () => {
    const loader = planning.slice(
      planning.indexOf("export async function ownedUpForSessions("),
      planning.indexOf("export async function currentActiveHangout(")
    );
    expect(loader).not.toContain(".limit(1)");
  });

  it("excludes terminal rows by status, so a cancelled UpFor leaves the list", () => {
    const loader = planning.slice(
      planning.indexOf("export async function ownedUpForSessions("),
      planning.indexOf("export async function currentActiveHangout(")
    );
    expect(loader).toContain("LIVE_HANGOUT_STATUSES");
  });
});

describe("requests are scoped to the UpFor that received them", () => {
  it("exposes a per-session request projection", () => {
    expect(actions).toContain("export async function getOwnerRequestsByUpForAction(");
    expect(actions).toContain("export type OwnerRequestsByUpFor");
  });

  it("reads every owned session's requests, not only the newest session's", () => {
    const fn = actions.slice(actions.indexOf("export async function getOwnerRequestsByUpForAction("));
    const body = fn.slice(0, 1800);
    expect(body).toContain('.in("hangout_session_id", sessionIds)');
    expect(body).not.toContain(".maybeSingle()");
  });

  it("costs one round trip regardless of how many UpFors exist", () => {
    // A per-session poll would be N times the traffic for the same answer.
    const fn = actions.slice(actions.indexOf("export async function getOwnerRequestsByUpForAction("));
    const body = fn.slice(0, 1800);
    expect((body.match(/from\("hangout_requests"\)/g) ?? []).length).toBe(1);
  });

  it("still resolves ownership server-side, never from the client", () => {
    const fn = actions.slice(actions.indexOf("export async function getOwnerRequestsByUpForAction("));
    expect(fn.slice(0, 1200)).toContain('.eq("owner_id", userId)');
  });
});

describe("the server ceiling is untouched", () => {
  it("still rejects the fourth session in the database, not the client", () => {
    const migration = read("supabase/migrations/20260830120000_upfor_scheduling.sql");
    expect(migration).toContain("upfor_limit_reached");
    expect(migration).toContain("pg_advisory_xact_lock");
  });

  it("keeps the client limit as an explanation, not an authority", () => {
    // The client may say why a create failed; it may not be what decides.
    expect(actions).toContain("MAX_ACTIVE_UPFORS");
    expect(actions).toContain("p_limit: MAX_ACTIVE_UPFORS");
  });
});
