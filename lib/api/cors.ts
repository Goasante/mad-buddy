import { NextResponse } from "next/server";

/**
 * CORS for the mobile app (Path A, Phase 1).
 *
 * The web app calls its own API same-origin, so browsers never send a CORS
 * preflight for it — these headers are added only for the Capacitor native
 * shell, whose webview origin is one of the fixed local schemes below (or a
 * dev origin set via MOBILE_ALLOWED_ORIGIN). For any other/absent Origin we
 * return no CORS headers at all, so same-origin web responses are byte-for-byte
 * unchanged.
 */
const NATIVE_ORIGINS = new Set([
  "capacitor://localhost", // iOS default
  "ionic://localhost",
  "http://localhost", // Android WebView default
  "https://localhost"
]);

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  if (NATIVE_ORIGINS.has(origin)) return true;
  const extra = process.env.MOBILE_ALLOWED_ORIGIN;
  return Boolean(extra && origin === extra);
}

export function corsHeaders(origin: string | null | undefined): Record<string, string> {
  if (!isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin as string,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

/** Answer a CORS preflight (OPTIONS) for an allowed native origin. */
export function preflightResponse(request: Request): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

/** Copy the CORS headers for the request's origin onto a response. No-op for
 *  same-origin web (unknown origin → no headers), so web behaviour is intact. */
export function withCors<T extends NextResponse>(response: T, request: Request): T {
  const headers = corsHeaders(request.headers.get("origin"));
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}
