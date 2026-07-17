import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { InviteStatus, InviteType } from "@/lib/supabase/database.types";

/**
 * Invite links + rotating personal QR (feature architecture batch 8,
 * spec §19-§38). Two deliberately different token designs:
 *
 *  - INVITE LINKS are long-lived, revocable, and use-counted, so they need
 *    server state. We generate a random token, store only its SHA-256 hash
 *    (spec §26: don't store the raw token), and hand the raw token to the user
 *    once. A database leak therefore yields no usable invite links.
 *
 *  - PERSONAL QR rotates every few minutes and must validate without a write
 *    on every render. It's an HMAC over (userId, windowIndex), so a screenshot
 *    stops working once its window passes (spec §33) with no storage at all.
 */

// ---------------------------------------------------------------------------
// Invite links (spec §22, §23, §26)
// ---------------------------------------------------------------------------

/** Raw token: 256 bits of entropy, URL-safe. Shown to the user exactly once. */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this ever reaches the database (spec §26). */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Expiry defaults (spec §24).
export const INVITE_EXPIRY_MS: Record<InviteType, number> = {
  personal: 7 * 24 * 60 * 60 * 1000,
  event: 7 * 24 * 60 * 60 * 1000,
  circle: 7 * 24 * 60 * 60 * 1000,
  community: 30 * 24 * 60 * 60 * 1000
};

export function inviteExpiryMs(type: InviteType): number {
  return INVITE_EXPIRY_MS[type] ?? INVITE_EXPIRY_MS.personal;
}

export type InviteRedemptionInput = {
  status: InviteStatus;
  inviteType: InviteType;
  /** The purpose the caller is trying to use it for (spec §23). */
  requestedType: InviteType;
  expiresAtMs: number;
  revokedAtMs: number | null;
  usesCount: number;
  maxUses: number;
  nowMs: number;
  creatorId: string;
  redeemerId: string | null;
  alreadyFriends: boolean;
  isBlockedEitherDirection: boolean;
};

export type InviteRedemptionResult = {
  allowed: boolean;
  reason:
    | "expired"
    | "revoked"
    | "used_up"
    | "not_active"
    | "purpose_mismatch"
    | "self"
    | "already_friends"
    | "blocked"
    | "allowed";
};

/**
 * Whether an invite token may be redeemed now. Purpose binding is enforced
 * first-class (spec §23): an event token can never be redeemed as a personal
 * friendship invite, even if it is otherwise valid.
 */
export function resolveInviteRedemption(input: InviteRedemptionInput): InviteRedemptionResult {
  // Purpose binding before anything else — a mismatched token is simply wrong.
  if (input.inviteType !== input.requestedType) return { allowed: false, reason: "purpose_mismatch" };
  if (input.revokedAtMs !== null) return { allowed: false, reason: "revoked" };
  if (input.status === "revoked") return { allowed: false, reason: "revoked" };
  if (input.status === "used") return { allowed: false, reason: "used_up" };
  if (input.status !== "active") return { allowed: false, reason: "not_active" };
  if (input.nowMs >= input.expiresAtMs) return { allowed: false, reason: "expired" };
  if (input.usesCount >= input.maxUses) return { allowed: false, reason: "used_up" };
  if (input.isBlockedEitherDirection) return { allowed: false, reason: "blocked" };
  if (input.redeemerId && input.redeemerId === input.creatorId) return { allowed: false, reason: "self" };
  // Already Muddies: not an error — the caller opens the profile instead of
  // creating a duplicate request (spec §64 step 13).
  if (input.alreadyFriends) return { allowed: false, reason: "already_friends" };
  return { allowed: true, reason: "allowed" };
}

// ---------------------------------------------------------------------------
// Rotating personal QR (spec §32, §33, §37)
// ---------------------------------------------------------------------------

/** Rotation window. A screenshot is useless once its window passes. */
export const QR_WINDOW_MS = 5 * 60 * 1000;

export function qrWindowIndex(nowMs: number): number {
  return Math.floor(nowMs / QR_WINDOW_MS);
}

function qrPayload(userId: string, windowIndex: number): string {
  return `qr:personal:${userId}:${windowIndex}`;
}

/** Token for the CURRENT window. Carries no private data — just an opaque MAC. */
export function createPersonalQrToken(userId: string, secret: string, nowMs: number): string {
  const index = qrWindowIndex(nowMs);
  const mac = createHmac("sha256", secret).update(qrPayload(userId, index)).digest("base64url");
  return `${userId}.${index}.${mac}`;
}

export type QrVerifyResult =
  | { valid: true; userId: string; reason: "valid" }
  | { valid: false; userId?: undefined; reason: "malformed" | "bad_signature" | "expired" };

/**
 * Verifies a scanned personal QR. Accepts the current window and the one
 * immediately before it, so a scan that happens as the window rolls over
 * doesn't spuriously fail — but nothing older (spec §33, §37).
 */
export function verifyPersonalQrToken(token: string, secret: string, nowMs: number): QrVerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed" };
  const [userId, indexRaw, mac] = parts;
  const index = Number.parseInt(indexRaw, 10);
  if (!userId || !Number.isFinite(index) || !mac) return { valid: false, reason: "malformed" };

  const currentIndex = qrWindowIndex(nowMs);
  if (index !== currentIndex && index !== currentIndex - 1) {
    return { valid: false, reason: "expired" };
  }

  const expected = createHmac("sha256", secret).update(qrPayload(userId, index)).digest("base64url");
  const provided = Buffer.from(mac);
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
    return { valid: false, reason: "bad_signature" };
  }

  return { valid: true, userId, reason: "valid" };
}

/** Short human-typable fallback when the camera is unavailable (spec §35). */
export function shortCodeFromToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 8).toUpperCase();
}
