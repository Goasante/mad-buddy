import { describe, expect, it } from "vitest";
import {
  QR_WINDOW_MS,
  createPersonalQrToken,
  generateInviteToken,
  hashInviteToken,
  inviteExpiryMs,
  resolveInviteRedemption,
  shortCodeFromToken,
  verifyPersonalQrToken,
  type InviteRedemptionInput
} from "@/lib/discovery/invites";

const SECRET = "qr-test-secret";
const NOW = Date.parse("2026-07-17T12:00:00.000Z");

describe("invite tokens (spec §26)", () => {
  it("generates unpredictable tokens", () => {
    expect(generateInviteToken()).not.toBe(generateInviteToken());
    expect(generateInviteToken().length).toBeGreaterThan(20);
  });

  it("stores only a hash — the raw token is unrecoverable from the database", () => {
    const token = generateInviteToken();
    const hash = hashInviteToken(token);
    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token);
    expect(hashInviteToken(token)).toBe(hash); // deterministic lookup
  });

  it("uses the documented expiry per type", () => {
    expect(inviteExpiryMs("personal")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(inviteExpiryMs("community")).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("invite redemption (spec §23, §28)", () => {
  function redeem(overrides: Partial<InviteRedemptionInput> = {}): InviteRedemptionInput {
    return {
      status: "active",
      inviteType: "personal",
      requestedType: "personal",
      expiresAtMs: NOW + 60_000,
      revokedAtMs: null,
      usesCount: 0,
      maxUses: 1,
      nowMs: NOW,
      creatorId: "creator",
      redeemerId: "redeemer",
      alreadyFriends: false,
      isBlockedEitherDirection: false,
      ...overrides
    };
  }

  it("allows a valid redemption", () => {
    expect(resolveInviteRedemption(redeem())).toEqual({ allowed: true, reason: "allowed" });
  });

  it("enforces purpose binding — an event token is never a friendship invite", () => {
    expect(resolveInviteRedemption(redeem({ inviteType: "event", requestedType: "personal" }))).toEqual({
      allowed: false,
      reason: "purpose_mismatch"
    });
  });

  it("refuses expired, revoked, and used-up tokens", () => {
    expect(resolveInviteRedemption(redeem({ expiresAtMs: NOW - 1 })).reason).toBe("expired");
    expect(resolveInviteRedemption(redeem({ revokedAtMs: NOW - 1 })).reason).toBe("revoked");
    expect(resolveInviteRedemption(redeem({ usesCount: 1, maxUses: 1 })).reason).toBe("used_up");
    expect(resolveInviteRedemption(redeem({ status: "used" })).reason).toBe("used_up");
  });

  it("refuses self-redemption and blocked pairs", () => {
    expect(resolveInviteRedemption(redeem({ redeemerId: "creator" })).reason).toBe("self");
    expect(resolveInviteRedemption(redeem({ isBlockedEitherDirection: true })).reason).toBe("blocked");
  });

  it("reports already-friends so the caller opens the profile instead of duplicating", () => {
    expect(resolveInviteRedemption(redeem({ alreadyFriends: true })).reason).toBe("already_friends");
  });
});

describe("rotating personal QR (spec §33, §37)", () => {
  it("round-trips within the current window", () => {
    const token = createPersonalQrToken("user-1", SECRET, NOW);
    const result = verifyPersonalQrToken(token, SECRET, NOW);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.userId).toBe("user-1");
  });

  it("still accepts the immediately previous window, so a rollover scan doesn't fail", () => {
    const token = createPersonalQrToken("user-1", SECRET, NOW);
    expect(verifyPersonalQrToken(token, SECRET, NOW + QR_WINDOW_MS).valid).toBe(true);
  });

  it("expires a screenshot: an old token stops working", () => {
    const token = createPersonalQrToken("user-1", SECRET, NOW);
    expect(verifyPersonalQrToken(token, SECRET, NOW + 3 * QR_WINDOW_MS)).toEqual({
      valid: false,
      reason: "expired"
    });
  });

  it("rotates — the token changes as windows advance", () => {
    expect(createPersonalQrToken("user-1", SECRET, NOW)).not.toBe(
      createPersonalQrToken("user-1", SECRET, NOW + 2 * QR_WINDOW_MS)
    );
  });

  it("rejects forged and malformed tokens", () => {
    const token = createPersonalQrToken("user-1", SECRET, NOW);
    expect(verifyPersonalQrToken(token, "wrong-secret", NOW).reason).toBe("bad_signature");
    expect(verifyPersonalQrToken("garbage", SECRET, NOW).reason).toBe("malformed");
    // Can't swap in another user id and keep the MAC.
    const [, index, mac] = token.split(".");
    expect(verifyPersonalQrToken(`user-2.${index}.${mac}`, SECRET, NOW).reason).toBe("bad_signature");
  });

  it("provides a typable fallback code (spec §35)", () => {
    const code = shortCodeFromToken(createPersonalQrToken("user-1", SECRET, NOW));
    expect(code).toMatch(/^[0-9A-F]{8}$/);
  });
});
