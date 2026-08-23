import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDirectMessageEligibility } from "@/lib/messaging/rules";

/**
 * ONE JOB, ONE IMPLEMENTATION: creating a direct conversation.
 *
 * MB-GOD-053. `lib/linkr/connection-service.ts` used to build the conversation
 * itself -- look up the direct_key, insert the row, seed both members, handle
 * the unique-key race -- duplicating `getOrCreateDirectConversation`. Nothing
 * unsafe came of it, but one job with two implementations drifts the moment
 * only one is updated.
 *
 * The comment that justified the duplication claimed the canonical helper
 * "requires the pair to be approved Muddies". THAT WAS STALE, and this file
 * exists partly so the claim can never go unchecked again: the first block
 * proves the canonical rule accepts a Linkr pair, and the second proves Linkr
 * still delegates rather than reimplementing.
 */

const ROOT = join(__dirname, "..", "..");
const linkr = readFileSync(join(ROOT, "lib/linkr/connection-service.ts"), "utf8");

const base = {
  areApprovedMuddies: false,
  hasActiveLinkrConnection: false,
  isBlockedEitherDirection: false,
  recipientPermission: "all_muddies" as const,
  senderIsCloseFriendOfRecipient: false,
  senderSharesSelectedCircle: false,
  recipientSuspended: false,
  senderSuspended: false
};

describe("the canonical rule accepts a Linkr pair", () => {
  it("allows a connected pair who are NOT Muddies", () => {
    // The exact state after a mutual connection, and the assumption the
    // refactor rests on.
    const result = resolveDirectMessageEligibility({ ...base, hasActiveLinkrConnection: true });
    expect(result.allowed, `refused with reason "${result.reason}"`).toBe(true);
  });

  it("still refuses two unconnected strangers", () => {
    /* The control. Without this, the assertion above could be passing because
       the rule allows everybody, which would prove nothing. */
    expect(resolveDirectMessageEligibility(base).allowed).toBe(false);
  });

  it("keeps a block winning over a Linkr connection", () => {
    const result = resolveDirectMessageEligibility({
      ...base, hasActiveLinkrConnection: true, isBlockedEitherDirection: true
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("blocked");
  });

  it("lets a Linkr connection outrank a restrictive message preference", () => {
    /* The connection IS the mutual consent that "nobody" exists to require, so
       a Linkr pair must not be locked out by it. If this ever flips, routing
       Linkr through the canonical helper would silently stop creating
       conversations -- which is why it is pinned here. */
    const result = resolveDirectMessageEligibility({
      ...base, hasActiveLinkrConnection: true, recipientPermission: "nobody"
    });
    expect(result.allowed).toBe(true);
  });
});

describe("Linkr delegates conversation creation", () => {
  it("calls the canonical service", () => {
    expect(linkr).toContain("getOrCreateDirectConversation");
  });

  it("does not build a conversation itself", () => {
    /* The duplicated implementation's fingerprints. Reintroducing any of them
       means the second implementation is back. */
    expect(linkr, "Linkr inserts conversations again").not.toMatch(
      /from\("conversations"\)\s*\n?\s*\.insert/
    );
    expect(linkr, "Linkr seeds conversation members again").not.toMatch(
      /from\("conversation_members"\)\s*\n?\s*\.insert/
    );
  });

  it("still owns the connection record itself", () => {
    /* The boundary runs BOTH ways: messaging was not broadened to know about
       Linkr, and Linkr's own reciprocity record stays here. */
    expect(linkr).toContain('from("linkr_connections")');
    const messaging = readFileSync(join(ROOT, "lib/messaging/service.ts"), "utf8");
    expect(messaging, "messaging must not learn about linkr_connections").not.toContain(
      'from("linkr_connections")'
    );
  });
});
