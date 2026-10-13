import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { MA_BOOK } from "./product";

export type BookPayment = {
  status?: string; reference?: string; amount?: number; currency?: string; domain?: string;
  customer?: { email?: string };
  metadata?: { product?: string; book_order_id?: string } | string | null;
};

export function normalizeBookEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[\x21-\x7e]+$/.test(email) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function bookMetadata(payment: BookPayment) {
  try {
    const metadata = typeof payment.metadata === "string" ? JSON.parse(payment.metadata) : payment.metadata;
    return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as { product?: string; book_order_id?: string } : null;
  } catch { return null; }
}

export function isVerifiedBookPayment(payment: BookPayment, order: { id: string; reference: string; email: string }, live: boolean) {
  const meta = bookMetadata(payment);
  return payment.status === "success" && payment.reference === order.reference &&
    payment.amount === MA_BOOK.amountMinor && payment.currency === MA_BOOK.currency &&
    meta?.product === MA_BOOK.id && meta.book_order_id === order.id &&
    normalizeBookEmail(payment.customer?.email) === order.email &&
    payment.domain === (live ? "live" : "test");
}

export function hashBookProof(proof: string) { return createHash("sha256").update(proof).digest("hex"); }
export function matchesBookProof(proof: string | undefined, expected: string | null) {
  if (!proof || !expected || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(hashBookProof(proof), "hex"), Buffer.from(expected, "hex"));
}
export function bookCookieName(reference: string) { return `mb_book_${reference}`; }

export function signBookDownload(orderId: string, secret: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ order: orderId, exp: now + 24 * 60 * 60 * 1000, purpose: MA_BOOK.id })).toString("base64url");
  const signature = createHmac("sha256", secret).update(`book-download-v1:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}
export function verifyBookDownload(token: string, secret: string, now = Date.now()): string | null {
  if (token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) return null;
  const [payload, signature] = parts;
  const expected = createHmac("sha256", secret).update(`book-download-v1:${payload}`).digest("base64url");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (claims.purpose !== MA_BOOK.id || typeof claims.exp !== "number" || claims.exp <= now || claims.exp > now + 24 * 60 * 60 * 1000 ||
      typeof claims.order !== "string" || !/^[a-f0-9-]{36}$/.test(claims.order)) return null;
    return claims.order as string;
  } catch { return null; }
}
