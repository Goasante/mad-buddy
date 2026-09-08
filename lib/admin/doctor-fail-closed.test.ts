import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A FAILED AUTHORITY READ MUST NEVER LOOK HEALTHY.
 *
 * This is the highest-consequence property in the whole Doctor, and the hardest
 * to see in review: `.data ?? []` on a failed read yields an empty list, an
 * empty list contains no drift, and the operator is told the account is fine.
 * Nobody looked, and nothing says so.
 *
 * Two occurrences survived an entire correction tranche because the commit that
 * fixed the others never touched this file. Both were found by reading the
 * source rather than by any test, which is why the property is now asserted
 * structurally: every Supabase result the diagnosis consumes must have its
 * `.error` inspected somewhere in the function.
 *
 * Structural rather than behavioural on purpose. Simulating a failure of one
 * specific query would need the whole action mocked, and a mock deep enough to
 * do that stops resembling the real loader -- which is precisely how the two
 * occurrences hid. Reading the shipped source cannot drift from the shipped
 * source.
 */

/* Normalised to LF for the same reason as the sibling coverage test: a CRLF
   checkout breaks every bare-newline boundary search below and would silently
   widen what counts as the function body. */
const SOURCE = readFileSync("app/(admin)/admin/repairs/doctor-actions.ts", "utf8").replace(/\r\n/g, "\n");

const diagnoseBody = (() => {
  const start = SOURCE.indexOf("export async function diagnoseAccountAction");
  const end = SOURCE.indexOf("\nexport async function", start + 10);
  return SOURCE.slice(start, end > -1 ? end : SOURCE.length);
})();

describe("diagnoseAccountAction fails closed on every authority read", () => {
  it("inspects the error of every Supabase result it consumes", () => {
    const consumed = [...new Set([...diagnoseBody.matchAll(/(\w+Result)\.data/g)].map((m) => m[1]))];
    expect(consumed.length, "no results found — the matcher is broken, not the code").toBeGreaterThan(10);

    const unguarded = consumed.filter((name) => !diagnoseBody.includes(`${name}.error`));
    expect(unguarded, `these results are consumed without checking .error: ${unguarded.join(", ")}`).toEqual([]);
  });

  it("never reads .data off an inline await without keeping the result", () => {
    /* The exact shape of both blockers:
         (await admin.from("x")...).data ?? []
         (await admin.from("x")...).data?.map(...) ?? []
       The result object is discarded, so `.error` cannot be checked even in
       principle. Keeping the result is what makes the check possible. */
    expect(diagnoseBody).not.toMatch(/\)\s*\.data\s*\?\?/);
    expect(diagnoseBody).not.toMatch(/\)\s*\.data\?\./);
  });

  it("the closed-UpFor read returns diagnostic-unavailable rather than an empty id list", () => {
    /* If this read fails and falls through, the stranded-request query searches
       an impossible UUID and Support is shown ZERO people waiting. */
    expect(diagnoseBody).toContain("closedOwnedSessionsResult.error");
    const guard = diagnoseBody.slice(
      diagnoseBody.indexOf("closedOwnedSessionsResult.error"),
      diagnoseBody.indexOf("closedOwnedSessionsResult.error") + 220
    );
    expect(guard).toContain("return empty(");
  });

  it("the direct-conversation read returns diagnostic-unavailable rather than an empty list", () => {
    /* The one that mattered for the founder's report: a failed read here left
       no archived conversation to find, so messaging looked healthy on the
       exact account whose messaging was broken. */
    expect(diagnoseBody).toContain("directConversationsResult.error");
    const guard = diagnoseBody.slice(
      diagnoseBody.indexOf("directConversationsResult.error"),
      diagnoseBody.indexOf("directConversationsResult.error") + 260
    );
    expect(guard).toContain("return empty(");
  });

  it("a failed eligibility RPC is not counted as a refusal", () => {
    /* Reported as "the Plan lifecycle is refusing on purpose" for an account
       whose eligibility was never determined -- a product-rule claim invented
       from a broken read. */
    expect(diagnoseBody).toContain("eligibleError");
  });

  it("every diagnostic-unavailable path returns empty(), never a fabricated snapshot", () => {
    const guards = [...diagnoseBody.matchAll(/if \([\w.]*[Ee]rror[^)]*\) \{\s*return ([\w(]+)/g)].map((m) => m[1]);
    expect(guards.length).toBeGreaterThan(0);
    for (const returned of guards) {
      expect(returned.startsWith("empty"), `an error guard returns ${returned} instead of empty()`).toBe(true);
    }
  });
});
