import "server-only";
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
export const ADMIN_COOKIE = "bookshop_admin";
export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
export function signingKey() {
  const s = process.env.BOOK_DOWNLOAD_SECRET?.trim();
  if (!s || s.length < 32) throw new Error("Secure access is not configured.");
  return s;
}
function adminKey() {
  const password = process.env.BOOK_ADMIN_PASSWORD;
  if (!password || password.length < 16)
    throw new Error("Admin login is not configured.");
  return createHmac("sha256", signingKey()).update(password).digest("hex");
}
export function validPassword(value: string) {
  const expected = process.env.BOOK_ADMIN_PASSWORD;
  if (!expected || expected.length < 16 || value.length > 256) return false;
  const salt = signingKey();
  return timingSafeEqual(
    scryptSync(value, salt, 32),
    scryptSync(expected, salt, 32)
  );
}
export function signToken(
  payload: Record<string, unknown>,
  purpose: string,
  key = signingKey()
) {
  const body = Buffer.from(JSON.stringify({ ...payload, purpose })).toString(
    "base64url"
  );
  return (
    body + "." + createHmac("sha256", key).update(body).digest("base64url")
  );
}
export function readToken(
  token: string | undefined,
  purpose: string,
  key = signingKey()
): Record<string, unknown> | null {
  if (!token || token.length > 2048) return null;
  const [body, sig, ...rest] = token.split(".");
  if (rest.length || !body || !sig) return null;
  const expected = createHmac("sha256", key).update(body).digest("base64url");
  if (
    sig.length !== expected.length ||
    !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  )
    return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.purpose === purpose &&
      typeof p.exp === "number" &&
      p.exp > Date.now()
      ? p
      : null;
  } catch {
    return null;
  }
}
export function adminSession() {
  return signToken(
    { exp: Date.now() + 8 * 3600000, nonce: randomBytes(16).toString("hex") },
    "admin",
    adminKey()
  );
}
export async function isAdmin() {
  try {
    return Boolean(
      readToken((await cookies()).get(ADMIN_COOKIE)?.value, "admin", adminKey())
    );
  } catch {
    return false;
  }
}
export function sameOrigin(request: Request) {
  const configured = new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  ).origin;
  return (
    request.headers.get("origin") === configured &&
    request.headers.get("sec-fetch-site") !== "cross-site"
  );
}
