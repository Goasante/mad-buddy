import "server-only";
import { NextResponse } from "next/server";
import { consumeRateLimit, getClientIpHashFromRequest, type RateLimitAction } from "@/lib/security/rate-limit";

export const bookPrivateHeaders = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export async function guardBookRequest(request: Request, action: RateLimitAction) {
  const rate = await consumeRateLimit({ action, ipHash: getClientIpHashFromRequest(request) });
  return rate.allowed ? null : NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: bookPrivateHeaders });
}
export async function readBookJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return null;
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 4096) return null;
  try { return JSON.parse(text); } catch { return null; }
}
