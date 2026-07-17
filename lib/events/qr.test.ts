import { describe, expect, it } from "vitest";
import { createEventToken, verifyEventToken } from "@/lib/events/qr";

const SECRET = "test-secret-value";
const OTHER_SECRET = "a-different-secret";
const NOW = Date.parse("2026-07-16T12:00:00.000Z");

function token(overrides: Partial<Parameters<typeof createEventToken>[0]> = {}) {
  return createEventToken(
    { contextId: "11111111-1111-1111-1111-111111111111", purpose: "check_in", expiresAtMs: NOW + 60_000, ...overrides },
    SECRET
  );
}

describe("event QR tokens (spec §29)", () => {
  it("round-trips a valid token", () => {
    const result = verifyEventToken(token(), SECRET, NOW);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.contextId).toBe("11111111-1111-1111-1111-111111111111");
      expect(result.payload.purpose).toBe("check_in");
    }
  });

  it("rejects a token signed with a different secret", () => {
    expect(verifyEventToken(token(), OTHER_SECRET, NOW)).toMatchObject({
      valid: false,
      reason: "bad_signature"
    });
  });

  it("rejects a tampered payload (can't extend your own expiry)", () => {
    const forged = createEventToken(
      { contextId: "11111111-1111-1111-1111-111111111111", purpose: "check_in", expiresAtMs: NOW + 999_999 },
      OTHER_SECRET
    );
    expect(verifyEventToken(forged, SECRET, NOW).valid).toBe(false);
  });

  it("rejects an expired token", () => {
    expect(verifyEventToken(token({ expiresAtMs: NOW - 1 }), SECRET, NOW)).toMatchObject({
      valid: false,
      reason: "expired"
    });
  });

  it("rejects malformed input", () => {
    expect(verifyEventToken("garbage", SECRET, NOW).reason).toBe("malformed");
    expect(verifyEventToken("", SECRET, NOW).reason).toBe("malformed");
    expect(verifyEventToken("a.b.c", SECRET, NOW).reason).toBe("malformed");
  });

  it("gives each token a distinct nonce so identical payloads differ", () => {
    expect(token()).not.toBe(token());
  });

  it("carries no user data — only context, purpose, expiry, nonce", () => {
    const payloadPart = token().split(".")[0];
    const decoded = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    expect(Object.keys(decoded).sort()).toEqual(["contextId", "expiresAtMs", "nonce", "purpose"]);
  });
});
