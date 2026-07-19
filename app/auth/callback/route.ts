import { NextResponse, type NextRequest } from "next/server";
import { ensureOAuthAccountForUser } from "@/lib/auth/oauth-account";
import { authErrorRedirect, safeAuthNext } from "@/lib/auth/oauth-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseBrowserEnv } from "@/lib/supabase/env";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeAuthNext(requestUrl.searchParams.get("next"));
  const error = requestUrl.searchParams.get("error");
  const errorPage = next === "/onboarding" ? "/signup" : "/login";
  const env = getSupabaseBrowserEnv();

  if (error) {
    return NextResponse.redirect(authErrorRedirect(requestUrl.origin, errorPage, "cancelled"));
  }

  if (!env.url || !env.anonKey || !code) {
    return NextResponse.redirect(authErrorRedirect(requestUrl.origin, errorPage, "callback_failed"));
  }

  const supabase = await createSupabaseServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return NextResponse.redirect(authErrorRedirect(requestUrl.origin, errorPage, "callback_failed"));
  }

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.redirect(authErrorRedirect(requestUrl.origin, errorPage, "callback_failed"));
  }

  try {
    const profile = await ensureOAuthAccountForUser(user);
    const destination = profile.is_onboarded ? next : "/onboarding";
    return NextResponse.redirect(new URL(destination, requestUrl.origin));
  } catch {
    await supabase.auth.signOut();
    return NextResponse.redirect(authErrorRedirect(requestUrl.origin, errorPage, "account_setup_failed"));
  }
}
