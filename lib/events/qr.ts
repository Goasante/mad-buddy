import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Signed event QR/invite tokens (feature architecture batch 5, spec §29, §56).
 *
 * A token carries only: a context id, an expiry, and a nonce — never user data,
 * never secrets, never database credentials. It is HMAC-signed server-side and
 * verified server-side; a client can neither forge nor extend one.
 *
 * Format: base64url(payloadJson).base64url(hmac) — compact enough for a QR.
 */

export type EventTokenPayload = {
  /** What the token grants against (event id or event-circle id). */
  contextId: string;
  /** Narrow the token's purpose so an event QR can't be replayed as a join. */
  purpose: "check_in" | "circle_join";
  /** Epoch ms expiry (spec §29: tokens must expire). */
  expiresAtMs: number;
  /** Random per-token value so identical payloads differ (spec §29). */
  nonce: string;
};

export type TokenVerifyResult =
  | { valid: true; payload: EventTokenPayload; reason: "valid" }
  | { valid: false; payload?: undefined; reason: "malformed" | "bad_signature" | "expired" };

function base64urlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function sign(payloadPart: string, secret: string): string {
  return base64urlEncode(createHmac("sha256", secret).update(payloadPart).digest());
}

export function createEventToken(
  input: Omit<EventTokenPayload, "nonce"> & { nonce?: string },
  secret: string
): string {
  const payload: EventTokenPayload = {
    contextId: input.contextId,
    purpose: input.purpose,
    expiresAtMs: input.expiresAtMs,
    nonce: input.nonce ?? randomBytes(8).toString("hex")
  };
  const payloadPart = base64urlEncode(JSON.stringify(payload));
  return `${payloadPart}.${sign(payloadPart, secret)}`;
}

/**
 * Verifies signature first, then expiry — an attacker must never learn whether
 * a forged token's payload "would have been" valid. Signature comparison is
 * constant-time.
 */
export function verifyEventToken(token: string, secret: string, nowMs: number): TokenVerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false, reason: "malformed" };
  const [payloadPart, signaturePart] = parts;

  const expected = sign(payloadPart, secret);
  const provided = Buffer.from(signaturePart);
  const expectedBuffer = Buffer.from(expected);
  if (
    provided.length !== expectedBuffer.length ||
    !timingSafeEqual(provided, expectedBuffer)
  ) {
    return { valid: false, reason: "bad_signature" };
  }

  let payload: EventTokenPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadPart).toString("utf8")) as EventTokenPayload;
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (
    typeof payload?.contextId !== "string" ||
    typeof payload?.expiresAtMs !== "number" ||
    (payload.purpose !== "check_in" && payload.purpose !== "circle_join")
  ) {
    return { valid: false, reason: "malformed" };
  }

  if (payload.expiresAtMs <= nowMs) return { valid: false, reason: "expired" };
  return { valid: true, payload, reason: "valid" };
}
