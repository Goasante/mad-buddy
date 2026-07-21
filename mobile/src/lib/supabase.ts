import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * The mobile app's Supabase client. Unlike the web app (cookie sessions via
 * @supabase/ssr), the native app holds its own token session in local storage
 * and presents it as a bearer token to both Supabase (RLS reads) and the web
 * app's /api/* route handlers (privileged mutations).
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    // WebView localStorage is stable across launches; good enough for v1. A
    // future hardening step can swap this for @capacitor/preferences.
    storageKey: "mad-buddy-auth"
  }
});

/** The current access token, or null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
