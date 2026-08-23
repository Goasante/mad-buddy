import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Connect must re-check blocks BEFORE it writes anything.
 *
 * WHY THIS TEST EXISTS. A hardening probe called `linkr_record_connect`
 * directly with a block in place, watched a connection form, and looked like a
 * P0 privacy defect. It was not: the RPC is deliberately narrow — its own
 * comment says "Did they already choose us? Only this function may ask" — and
 * the block check lives one layer up, in `connectWithCandidate`.
 *
 * The product was right and the probe was wrong. But the episode exposed a real
 * gap: nothing asserted that the guard stays where it is. If a refactor moved
 * the block check below the RPC call, or dropped it on the assumption that the
 * database enforces it, a blocked person could form a Linkr connection and no
 * test would notice.
 *
 * Two properties are load-bearing and both are asserted here:
 *
 *  1. **Order.** The block check must run BEFORE `linkr_record_connect`. A block
 *     placed between the deck loading and the tap has to win, and the deck is by
 *     definition a snapshot of the past.
 *  2. **Silence.** A blocked Connect must return a result indistinguishable from
 *     an ordinary private Connect. Telling the caller "you are blocked" would
 *     turn Connect into a block detector — which is a privacy leak wearing the
 *     costume of a helpful error message.
 */

const SERVICE = "lib/linkr/connection-service.ts";

describe("Linkr connect: the block guard", () => {
  const raw = readFileSync(SERVICE, "utf8");
  // Prose is not code: the file documents this rule at length, and asserting on
  // raw text would pass on the explanation rather than the implementation.
  const source = stripComments(raw);

  /** The body of one exported function, to the start of the next. */
  function body(name: string): string {
    const start = source.indexOf(`export async function ${name}`);
    expect(start, `${name} not found — did it move or get renamed?`).toBeGreaterThan(-1);
    const next = source.indexOf("export async function ", start + 1);
    return source.slice(start, next === -1 ? undefined : next);
  }

  it("checks blocks before recording any interest", () => {
    const connect = body("connectWithCandidate");
    const blockCheck = connect.indexOf("isBlockedEitherDirection");
    const rpcCall = connect.indexOf("linkr_record_connect");

    expect(blockCheck, "connectWithCandidate no longer checks isBlockedEitherDirection").toBeGreaterThan(-1);
    expect(rpcCall, "connectWithCandidate no longer calls linkr_record_connect").toBeGreaterThan(-1);

    /* The check must be REACHABLE, not merely present.
       Mutation-testing this file caught a real weakness in it: disabling the
       guard with `if (false && await isBlockedEitherDirection(...))` still
       passed, because the call was still in the source at the right position.
       A source-level guard that only proves a string exists is worth very
       little; this at least refuses the obvious ways to neuter it. */
    const guardLine = connect.slice(connect.lastIndexOf("if", blockCheck), blockCheck);
    expect(guardLine, "the block check has been short-circuited").not.toMatch(/false\s*&&/);
    expect(guardLine, "the block check has been negated").not.toMatch(/!\s*await/);
    expect(
      blockCheck,
      "The block check must run BEFORE linkr_record_connect. The RPC performs no " +
        "block check of its own (deliberately — it is reciprocity-only), so moving " +
        "the guard after it would let a blocked pair connect."
    ).toBeLessThan(rpcCall);
  });

  it("does not reveal the block to the caller", () => {
    const connect = body("connectWithCandidate");
    const blockCheck = connect.indexOf("isBlockedEitherDirection");
    /* Slice from the RETURN, not from the check. The check line necessarily
       contains the word "block" (it is the function's name), so starting there
       made the assertion below fail on the guard itself. What must not mention
       a block is the value handed BACK to the caller. */
    const returnStart = connect.indexOf("return", blockCheck);
    const branch = connect.slice(returnStart, connect.indexOf(";", returnStart));

    // It reports ok:true with no match and no message — exactly what an
    // ordinary one-sided Connect returns.
    expect(branch).toContain("ok: true");
    expect(branch).toContain("matched: false");
    // Any wording here that names the block turns Connect into a block detector.
    expect(branch.toLowerCase()).not.toContain("block");
    expect(branch.toLowerCase()).not.toContain("cannot");
    expect(branch.toLowerCase()).not.toContain("unavailable");
  });

  it("re-checks eligibility against a stale deck, not just the block", () => {
    // The same snapshot problem applies to every non-negotiable: a card the
    // client is holding may describe an account that has since gone ghost,
    // been deleted, lost its photo, or turned Linkr off.
    const connect = body("connectWithCandidate");
    for (const guard of ["visibility_status", "deleted_at", "enabled"]) {
      expect(connect, `connectWithCandidate no longer re-checks ${guard} before connecting`).toContain(guard);
    }
  });

  it("does not demand a block check on Pass, which needs none", () => {
    /* Recorded as a deliberate ASYMMETRY rather than an omission.
       `passCandidate` writes a private "not interested" row for the actor. It
       creates no connection, no conversation and no visibility to the target,
       so there is nothing a block would protect — and adding a check would cost
       a round trip on the most frequently tapped control in the deck.
       Connect is different precisely because it can CREATE something. An earlier
       version of this test asserted the opposite and was wrong. */
    const passBody = body("passCandidate");
    expect(passBody).not.toContain("linkr_record_connect");
    expect(passBody).toContain('action: "pass"');
  });
});
