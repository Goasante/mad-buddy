import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { REPAIR_CATALOG } from "@/lib/admin/repairs";

/**
 * THE FOUNDER RULE, ENFORCED IN SOURCE:
 *
 *   "If Admin offers a Repair button, that repair must prove its named
 *    invariant afterward. No exceptions."
 *
 * A repair that reports success on its mutation's return value is the exact
 * lie the verification contract exists to prevent, and it is easy to
 * reintroduce -- a new `case` with an inline update is three lines and looks
 * perfectly reasonable in review. So this asserts the property structurally
 * rather than trusting each author to remember.
 */

const SOURCE = readFileSync("app/(admin)/admin/repairs/actions.ts", "utf8");

const switchBody = (() => {
  const start = SOURCE.indexOf("async function executeRepair");
  const end = SOURCE.indexOf("\n}", start);
  return SOURCE.slice(start, end);
})();

/** The delegating call that follows a repair's `case` label, if there is one. */
function branchAfter(repairId: string): string {
  const marker = `case "${repairId}":`;
  const at = switchBody.indexOf(marker);
  if (at === -1) return "";
  return switchBody.slice(at + marker.length, at + marker.length + 120).trim();
}

describe("every executable repair proves its invariant", () => {
  it("routes each catalog repair to a named helper rather than an inline mutation", () => {
    for (const repair of REPAIR_CATALOG) {
      const next = branchAfter(repair.id);
      expect(next, `${repair.id} has no branch in executeRepair`).not.toBe("");
      expect(next.startsWith("return "), `${repair.id} does not delegate to a helper`).toBe(true);
      expect(next, `${repair.id} does not pass the account through`).toContain("(admin, userId)");
    }
  });

  it("and every one of those helpers returns a verification", () => {
    for (const repair of REPAIR_CATALOG) {
      const next = branchAfter(repair.id);
      const helper = next.slice("return ".length, next.indexOf("("));
      expect(helper, `${repair.id} has no helper`).toBeTruthy();

      const start = SOURCE.indexOf(`async function ${helper}(`);
      expect(start, `${helper} is not defined in this file`).toBeGreaterThan(-1);
      const body = SOURCE.slice(start, SOURCE.indexOf("\n}", start));

      /* Each helper must be able to reach the outcomes the contract defines:
         a real result, the "already correct" case, and failure. A helper that
         cannot report failure is not verifying anything. */
      expect(body.includes("verification:"), `${helper} returns no verification`).toBe(true);
      expect(body.includes("notApplicable("), `${helper} cannot report nothing-to-do`).toBe(true);
      expect(body.includes("stillBroken("), `${helper} cannot report a failed repair`).toBe(true);
    }
  });

  it("no repair branch performs an inline write", () => {
    expect(switchBody).not.toContain(".update(");
    expect(switchBody).not.toContain(".delete(");
  });

  it("every repair is reachable from a finding that names a broken state", () => {
    /* POST-WRITE VERIFICATION IS NOT ENOUGH. It proves the mutation did what
       it said; it says nothing about whether the mutation should have been
       offered. A repair with no defect predicate is a button that acts on a
       healthy account, which is how an operator ends up marking somebody's
       real unread mail as read or setting their privacy mode for them.
       Three entries were removed for failing this. */
    const findingSources = [
      readFileSync("lib/admin/account-doctor.ts", "utf8"),
      readFileSync("lib/admin/support-owned-diagnostics.ts", "utf8")
    ].join(" ");

    for (const repair of REPAIR_CATALOG) {
      expect(
        findingSources.includes(`"${repair.id}"`),
        `${repair.id} is executable but no diagnostic ever recommends it`
      ).toBe(true);
    }
  });

  it("the catalog and the switch agree on which repairs exist", () => {
    const cases = [...switchBody.matchAll(/case "([a-z_]+)":/g)].map((entry) => entry[1]);
    expect(new Set(cases)).toEqual(new Set(REPAIR_CATALOG.map((repair) => repair.id)));
  });
});
