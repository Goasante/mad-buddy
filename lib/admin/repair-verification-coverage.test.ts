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

  it("every repair is reachable from a finding the LIVE loader can produce", () => {
    /* Grepping for the repair id was not enough, and the gap was not academic:
       three repairs were named by findings whose guard could NEVER fire.
       `presence.signal === "stale"` was dead because the loader projects a
       usable signal as `fresh` and everything else as `missing`;
       `stalePushDevices > 0` was dead because that field is hard-coded 0.
       Both advertised capability no operator could reach.

       So each repair now names the snapshot FIELD its finding is guarded on,
       and the test asserts the live loader actually assigns that field a value
       which can satisfy the guard -- rather than trusting that a branch
       mentioning the id is live. */
    const REACHABILITY: Record<string, { source: string; field: string; deadValue?: string }> = {
      reconcile_direct_messaging: {
        source: "app/(admin)/admin/repairs/doctor-actions.ts",
        field: "archivedDirectWithLiveFriendshipCount"
      },
      reconcile_plan_chats: {
        source: "app/(admin)/admin/repairs/doctor-actions.ts",
        field: "planChatMismatchCount"
      },
      settle_stranded_upfor_requests: {
        source: "app/(admin)/admin/repairs/doctor-actions.ts",
        field: "strandedUpForRequestCount"
      },
      clear_stuck_status: {
        source: "app/(admin)/admin/repairs/doctor-actions.ts",
        field: "staleStatusCount"
      }
    };

    for (const repair of REPAIR_CATALOG) {
      const entry = REACHABILITY[repair.id];
      expect(entry, `${repair.id} has no declared reachability`).toBeDefined();
      if (!entry) continue;

      const loader = readFileSync(entry.source, "utf8");

      /* The field must derive from DATA, not from a literal. `stalePushDevices: 0`
         is exactly the shape this rejects: it satisfies "the loader mentions
         it" while guaranteeing the finding can never fire.
         A field is live if it is either computed inline from a query result
         (`x: (someResult.data ?? []).length`) or accumulated elsewhere and
         passed by shorthand. A bare numeric literal is neither. */
      /* Plain string checks rather than built regexes: an escaped pattern here
         is easy to get subtly wrong, and a broken pattern in a safety test is
         worse than no test. */
      const assignedConstant = [0, 1, 2, 3].some((n) => loader.includes(`${entry.field}: ${n}`));
      expect(
        assignedConstant,
        `${entry.field} is assigned a constant, so its finding can never fire`
      ).toBe(false);

      // Either computed inline from a query result, or accumulated then passed.
      const inlineFromData = loader.includes(`${entry.field}: (`);
      const accumulated = loader.includes(`${entry.field} += `) || loader.includes(`${entry.field} = `);
      const passedByShorthand = loader.includes(`    ${entry.field},`);
      expect(
        inlineFromData || (accumulated && passedByShorthand),
        `${entry.field} is not derived from a live read`
      ).toBe(true);
    }
  });

  it("no repair is recommended by a finding guarded on an impossible value", () => {
    /* The two dead guards, pinned by name so re-adding either fails here. */
    const supportOwned = readFileSync("lib/admin/support-owned-diagnostics.ts", "utf8");
    expect(supportOwned).not.toContain('presence.signal === "stale"');
    expect(supportOwned).not.toContain("stalePushDevices > 0");
  });

  it("the catalog and the switch agree on which repairs exist", () => {
    const cases = [...switchBody.matchAll(/case "([a-z_]+)":/g)].map((entry) => entry[1]);
    expect(new Set(cases)).toEqual(new Set(REPAIR_CATALOG.map((repair) => repair.id)));
  });
});

describe("verifiers fail closed", () => {
  const HELPERS = [
    "reconcileDirectMessaging",
    "reconcilePlanChats",
    "settleStrandedUpForRequests",
    "clearStuckStatus"
  ];

  /* Bounded at the function's own closing brace. Slicing to the NEXT
     `async function` overran the last helper in the file and swept up
     unrelated code, which reported a false unchecked read. */
  function bodyOf(name: string): string {
    const start = SOURCE.indexOf(`async function ${name}(`);
    const end = SOURCE.indexOf("\n}\n", start);
    return SOURCE.slice(start, end > -1 ? end : SOURCE.length);
  }

  it("no repair helper destructures a read without inspecting its error", () => {
    /* The failure mode: `const { data } = await admin...` silently yields
       undefined on a failed read, `?? []` turns it into an empty list, and the
       verifier then reports FIXED because it found nothing wrong. The operator
       is told the problem is solved when nobody actually looked. */
    for (const helper of HELPERS) {
      const body = bodyOf(helper);
      const unchecked = [...body.matchAll(/const \{ data(?::\s*\w+)? \} = await/g)];
      expect(unchecked.map((m) => m[0]), `${helper} has an unchecked read`).toEqual([]);
    }
  });

  it("every helper can report that verification itself was unavailable", () => {
    for (const helper of HELPERS) {
      const body = bodyOf(helper);
      expect(
        body.includes("verificationUnavailable(") || body.includes("return fail("),
        `${helper} cannot report a failed verification read`
      ).toBe(true);
    }
  });

  it("an unavailable verification is never reported as fixed", () => {
    const contract = readFileSync("lib/admin/repair-verification.ts", "utf8");
    const helper = contract.slice(contract.indexOf("export const verificationUnavailable"));
    expect(helper).toContain('outcome: "still_broken"');
    expect(helper).not.toContain('outcome: "fixed"');
  });
});
