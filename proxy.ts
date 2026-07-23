import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authenticatedRedirect, requiredLoginRedirect } from "@/lib/security/route-protection";
import { supabaseCookieOptions } from "@/lib/supabase/cookie-options";
import type { Database } from "@/lib/supabase/database.types";

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

export async function proxy(request: NextRequest) {
  const loginRedirect = requiredLoginRedirect(request.nextUrl.pathname);
  const signedInRedirect = authenticatedRedirect(request.nextUrl.pathname);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

  // Nothing to decide for this path.
  if (!loginRedirect && !signedInRedirect) {
    return NextResponse.next();
  }

  // Guest-only page and no session cookie: definitely signed out, nothing to do.
  if (!loginRedirect && !hasSupabaseAuthCookie(request)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request
  });

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookieOptions: supabaseCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  // Signed out on a protected page: send them to the right login screen and
  // remember where they were headed.
  if (!user && loginRedirect) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = loginRedirect;
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Already signed in on a guest-only page (landing, login, signup, forgot
  // password): drop them straight into the app instead of the marketing page
  // or an empty form.
  if (user && signedInRedirect) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = signedInRedirect;
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
