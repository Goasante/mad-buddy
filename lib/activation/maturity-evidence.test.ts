import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * HOME MUST NOT REDISCOVER A MONOTONIC FACT BY SCANNING HISTORY.
 *
 * MB-GOD-060. `loadMaturityEvidence` answered "has any conversation of mine
 * ever had two different senders?" by reading every non-system, non-deleted
 * message in every direct conversation, on EVERY Home load. That is
 * O(total messages ever exchanged) per render — correct, batched, and
 * unbounded. A two-year user with 20 conversations averaging 500 messages made
 * Home read 10,000 rows to produce one boolean.
 *
 * The fix is a milestone written once when it becomes true
 * (`first_reply_received`, by a trigger on `messages`) and backfilled for
 * existing accounts.
 *
 * These assertions are structural because the property IS structural: the
 * defect is "which tables does this function touch", and the behavioural proof
 * lives in scripts/hardening/first-reply-milestone.mjs (7/7 — one-sided stays
 * false, a system message does not count, a real reply records for both
 * people, repeats do not duplicate, and it is monotonic).
 */

const ROOT = join(__dirname, "..", "..");
const projection = readFileSync(join(ROOT, "lib/activation/projection.ts"), "utf8");
const maturity = readFileSync(join(ROOT, "lib/activation/home-maturity.ts"), "utf8");

/** The body of loadMaturityEvidence, up to the next top-level declaration. */
function maturityEvidenceBody(): string {
  const start = projection.indexOf("async function loadMaturityEvidence(");
  expect(start, "loadMaturityEvidence no longer exists").toBeGreaterThan(-1);
  const rest = projection.slice(start);
  const next = rest.indexOf("\nexport async function ");
  return next === -1 ? rest : rest.slice(0, next);
}

describe("Home maturity evidence", () => {
  it("reads the milestone rather than message history", () => {
    const body = maturityEvidenceBody();
    expect(body).toContain('"first_reply_received"');
    expect(body).toContain('from("activation_milestones")');
  });

  it("never queries the messages table", () => {
    /* THE REGRESSION THIS EXISTS FOR. Any reintroduction of a per-render
       message read — however well batched — puts an unbounded scan back on
       Home's critical path. */
    const body = maturityEvidenceBody();
    expect(body, "Home is scanning messages again").not.toContain('from("messages")');
  });

  it("does not walk conversations to get there either", () => {
    /* The old implementation reached messages via conversation_members →
       conversations → messages. Blocking only the last hop would let the first
       two return as a partial regression. */
    const body = maturityEvidenceBody();
    expect(body).not.toContain('from("conversation_members")');
    expect(body).not.toContain('from("conversations")');
  });

  it("bounds every query it does make", () => {
    // The milestone lookup must be a single-row existence check, not a scan.
    const body = maturityEvidenceBody();
    expect(body).toMatch(/\.limit\(1\)/);
  });

  it("still answers the only question the consumer asks", () => {
    /* home-maturity.ts compares `> 0` and never uses the number, which is what
       makes a boolean milestone a faithful replacement. If a consumer ever
       starts using the COUNT, this fails and the substitution has to be
       revisited rather than silently lying. */
    expect(maturity).toContain("input.twoSidedConversationCount > 0");
    expect(maturity, "a consumer now depends on the actual count")
      .not.toMatch(/twoSidedConversationCount\s*[>=<]=?\s*[2-9]/);
  });
});
