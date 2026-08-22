import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const action = readFileSync("app/(app)/profile-interests-actions.ts", "utf8");

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
    expect(action).toContain('.eq("user_id", userId)');
    expect(action).not.toMatch(/input\.userId|parsed\.data\.userId|targetUserId/);
  });

  it("validates against the closed taxonomy on the server", () => {
    expect(action).toContain("validateInterestSelection(parsed.data.interests)");
    expect(action).toContain("if (!selection.ok) return");
    // The validated output is what gets written, never the raw request.
    expect(action).toContain("diffInterests(current, selection.interests)");
  });

  it("checks authorization before touching the database", () => {
    const auth = action.indexOf("const userId = await getAuthedUserId();");
    const write = action.indexOf('.from("user_interests")');
    expect(auth).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(auth);
  });

  it("adds before it removes, so a failure cannot empty a profile", () => {
    // Linkr's editor deletes the whole set then re-inserts; if the insert
    // fails there, the person is left with nothing. This applies a diff and
    // returns early on error, so the previous set survives a failed save.
    const insert = action.indexOf(".insert(");
    const remove = action.indexOf(".delete()");
    expect(insert).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(insert);
  });

  it("needs no migration — it uses the existing table and its ownership RLS", () => {
    expect(action).toContain('.from("user_interests")');
    expect(action).toContain("NO MIGRATION");
  });
});
