import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A PAUSED FEATURE GATES NEW PARTICIPATION AND NEVER TRAPS ANYBODY.
 *
 * MB-GOD-055. `moments-actions.ts` states the rule without qualification --
 * "the MUTATIONS re-check the flag server-side" -- and four did not. Two of
 * those omissions were CORRECT and two were not, which is why the rule needed
 * a semantic split rather than blanket enforcement:
 *
 *   CREATION / NEW PARTICIPATION  → gated. A paused feature must not keep
 *                                   accruing state for a surface nobody sees.
 *   WITHDRAWAL / SAFETY           → never gated. Pausing a feature must not
 *                                   trap somebody in content, a relationship
 *                                   or a moderation queue they cannot leave.
 *
 * The Product Constitution's "disabled features cannot block progression" cuts
 * BOTH ways, and this test is where that distinction is written down.
 */

const source = readFileSync(
  join(__dirname, "..", "..", "app", "(app)", "moments-actions.ts"),
  "utf8"
);

/** The body of one exported action, up to the next one. */
function actionBody(name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  expect(start, `${name} no longer exists`).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const nextIndex = rest.indexOf("\nexport async function ");
  return nextIndex === -1 ? rest : rest.slice(0, nextIndex);
}

const GATED = ["uploadMomentMediaAction", "reactToMomentAction", "tuneInAction"];
const UNGATED = ["deleteMomentAction", "reportContentAction", "tuneOutAction"];

describe("Moments flag semantics", () => {
  it.each(GATED)("%s gates new participation on the flag", (name) => {
    expect(actionBody(name)).toContain("momentsPausedState");
  });

  it.each(UNGATED)("%s stays reachable while the feature is paused", (name) => {
    /* Deliberately NOT gated. Deleting your own Moment, reporting content and
       tuning out are withdrawal and safety: blocking them because the feature
       is paused would trap content, suspend moderation, or hold somebody in a
       relationship they can no longer manage. */
    expect(actionBody(name)).not.toContain("momentsPausedState");
  });

  it("removing a reaction is withdrawal but is gated with its counterpart", () => {
    /* Recorded honestly rather than asserted either way: react/unreact are a
       matched pair on the same surface, and splitting them would let a paused
       feature show a reaction that cannot be undone through the same control.
       Keeping both gated is a deliberate choice, not an oversight. */
    expect(actionBody("removeMomentReactionAction")).toContain("momentsPausedState");
    expect(actionBody("reactToMomentAction")).toContain("momentsPausedState");
  });

  it("the guard reads the flag rather than trusting the caller", () => {
    expect(source).toContain("isMomentsEnabled(admin)");
  });

  it("reads are not gated, so paused content stays retrievable", () => {
    // Stated in the guard's own comment: gating reads would strand existing
    // Moments the moment the flag returns.
    expect(source).toContain("Reads are intentionally NOT gated");
  });
});
