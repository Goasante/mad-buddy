import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authenticatedRedirect, requiredLoginRedirect } from "@/lib/security/route-protection";
import { safeAuthNext } from "@/lib/auth/oauth-redirect";
import { buildContentSecurityPolicy, supabaseOriginFromEnv } from "@/lib/security/csp";
import { supabaseCookieOptions } from "@/lib/supabase/cookie-options";
import type { Database } from "@/lib/supabase/database.types";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";

/**
 * Cheap pre-check: without a Supabase auth cookie the visitor cannot have a
 * session, so we can skip the getUser() round trip entirely. This keeps the
 * public landing page fast for anonymous traffic, which is the vast majority.
 */
function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token"));
}

/**
 * A fresh nonce per request, so the enforced CSP only trusts the inline
 * scripts this render actually produced. base64url of 16 random bytes.
 */
function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function proxy(request: NextRequest) {
  // --- Per-request CSP nonce --------------------------------------------
  // The nonce goes on the REQUEST headers so Next.js auto-applies it to its
  // own runtime scripts, and on the RESPONSE header (Content-Security-Policy)
  // to enforce it. x-nonce lets the app's own inline scripts read it. This is
  // the documented Next.js nonce pattern; every response below carries it.
  const nonce = createNonce();
  const cspHeader = buildContentSecurityPolicy({
    supabaseOrigin: supabaseOriginFromEnv(process.env.NEXT_PUBLIC_SUPABASE_URL),
    mode: "enforce",
    nonce,
    allowDevEval: process.env.NODE_ENV === "development"
  });

  function withSecurityHeaders(requestHeaders?: Headers): NextResponse {
    const response =
      requestHeaders !== undefined
        ? NextResponse.next({ request: { headers: requestHeaders } })
        : NextResponse.next();
    response.headers.set("Content-Security-Policy", cspHeader);
    return response;
  }

  function baseRequestHeaders(): Headers {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    // Next reads the nonce from this request header to nonce its own scripts.
    headers.set("Content-Security-Policy", cspHeader);
    return headers;
  }

  const loginRedirect = requiredLoginRedirect(request.nextUrl.pathname);
  const signedInRedirect = authenticatedRedirect(request.nextUrl.pathname);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return withSecurityHeaders(baseRequestHeaders());
  }

  // Nothing to decide for this path (public page or self-guarding API route).
  if (!loginRedirect && !signedInRedirect) {
    return withSecurityHeaders(baseRequestHeaders());
  }

  // Guest-only page and no session cookie: definitely signed out, nothing to do.
  if (!loginRedirect && !hasSupabaseAuthCookie(request)) {
    return withSecurityHeaders(baseRequestHeaders());
  }

  const requestHeaders = baseRequestHeaders();
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", cspHeader);

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookieOptions: supabaseCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        response.headers.set("Content-Security-Policy", cspHeader);
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      }
    }
  });

  // getUser() is a network round trip to Supabase Auth on every protected/
  // guest-only page navigation, with no built-in timeout — a slow or
  // unreachable auth endpoint used to hang the whole page load (the "taking
  // longer than expected" dialog). On timeout or any other failure here we
  // fail open on the REDIRECT decision only (let the request through as-is);
  // RLS and the page/action-level auth checks still gate actual data access,
  // so this never grants access to anything the backend wouldn't already
  // allow — it only stops the middleware itself from being a single point of
  // app-wide slowness.
  let user: { id: string } | null = null;
  try {
    const result = await withTimeout(supabase.auth.getUser(), {
      operation: "proxy.getUser",
      timeoutMs: 5_000
    });
    user = result.data.user;
  } catch (error) {
    if (!isRequestTimeoutError(error)) throw error;
    return response;
  }

  // Signed out on a protected page: send them to the right login screen and
  // remember where they were headed.
  if (!user && loginRedirect) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = loginRedirect;
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    const redirect = NextResponse.redirect(redirectUrl);
    redirect.headers.set("Content-Security-Policy", cspHeader);
    return redirect;
  }

  // Already signed in on a guest-only page (landing, login, signup, forgot
  // password): drop them straight into the app instead of the marketing page
  // or an empty form.
  if (user && signedInRedirect) {
    const destination = safeAuthNext(request.nextUrl.searchParams.get("next"), signedInRedirect);
    const parsedDestination = new URL(destination, request.url);
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = parsedDestination.pathname;
    redirectUrl.search = parsedDestination.search;
    redirectUrl.hash = parsedDestination.hash;
    const redirect = NextResponse.redirect(redirectUrl);
    redirect.headers.set("Content-Security-Policy", cspHeader);
    return redirect;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
