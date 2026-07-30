import { createClient } from "@supabase/supabase-js";
import { env } from "./env";
import { mobileAuthStorage } from "./auth-storage";

/**
 * The mobile app's Supabase client. Unlike the web app (cookie sessions via
 * @supabase/ssr), the native app stores its refresh/session credentials in the
 * iOS Keychain or Android Keystore-backed storage. Browser builds keep normal
 * browser storage. Both transports present access tokens as Bearer credentials
 * to the web app's /api/* route handlers.
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: "mad-buddy-auth",
    storage: mobileAuthStorage()
  }
});

/** The current access token, or null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
