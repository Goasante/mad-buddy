import "server-only";
import { NextResponse } from "next/server";
import { invalidMutationOriginResponse } from "@/lib/security/csrf";
import { consumeRateLimit, getClientIpHashFromRequest, type RateLimitAction } from "@/lib/security/rate-limit";

export const bookPrivateHeaders = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export async function guardBookRequest(request: Request, action: RateLimitAction) {
  const originError = invalidMutationOriginResponse(request);
  if (originError) return originError;
  const rate = await consumeRateLimit({ action, ipHash: getClientIpHashFromRequest(request) });
  return rate.allowed ? null : NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: bookPrivateHeaders });
}
export async function readBookJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return null;
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 4096) return null;
  try { return JSON.parse(text); } catch { return null; }
}
