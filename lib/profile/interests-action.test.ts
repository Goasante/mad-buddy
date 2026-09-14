import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const action = readFileSync("app/(app)/profile-interests-actions.ts", "utf8");
/* The mutation body moved to lib/profile/interests-service.ts so the native app
   can reach it through /api/profile/interests; the Server Action now delegates.
   Assertions about the WRITES follow the behaviour there; assertions about
   AUTHORISATION stay on the action, which is what proves identity. */
const service = readFileSync("lib/profile/interests-service.ts", "utf8");

describe("interest mutation authority", () => {
  it("exists at all", () => {
    // The regression this guards: `user_interests` was readable, and the
    // completion card asked people to choose interests, with no writer.
    expect(action).toContain("export async function setProfileInterestsAction");
  });

  it("writes only the session user's rows", () => {
    // No userId parameter anywhere in the signature, and every statement
    // scoped by the id resolved from the session.
    expect(action).toContain("const userId = await getAuthedUserId();");
    expect(action).toContain('if (!userId) return { ok: false, message: "Log in first." };');
    expect(service).toContain('.eq("user_id", userId)');
    expect(service).not.toMatch(/input\.userId|parsed\.data\.userId|targetUserId/);
  });

  it("validates against the closed taxonomy on the server", () => {
    expect(service).toContain("validateInterestSelection(parsed.data.interests)");
    expect(service).toContain("if (!selection.ok) return");
    // The validated output is what gets written, never the raw request.
    expect(service).toContain("diffInterests(current, selection.interests)");
  });

  it("checks authorization before touching the database", () => {
    /* Now split across two files, so both halves are asserted: the action
       resolves identity and refuses without it BEFORE calling the service, and
       the service is the only place that touches the table. */
    const auth = action.indexOf("const userId = await getAuthedUserId();");
    const refuse = action.indexOf("if (!userId) return");
    const call = action.indexOf("setProfileInterests(createSupabaseAdminClient()");
    expect(auth).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(auth);
    expect(call).toBeGreaterThan(refuse);
    // The action itself must not reach the table any more.
    expect(action).not.toContain('.from("user_interests")');
    expect(service).toContain('.from("user_interests")');
  });

  it("adds before it removes, so a failure cannot empty a profile", () => {
    // Linkr's editor deletes the whole set then re-inserts; if the insert
    // fails there, the person is left with nothing. This applies a diff and
    // returns early on error, so the previous set survives a failed save.
    const insert = service.indexOf(".insert(");
    const remove = service.indexOf(".delete()");
    expect(insert).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(insert);
  });

  it("needs no migration — it uses the existing table and its ownership RLS", () => {
    expect(service).toContain('.from("user_interests")');
    expect(action + service).toContain("NO MIGRATION");
  });
});
