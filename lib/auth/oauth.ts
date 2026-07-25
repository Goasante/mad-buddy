import type { Provider } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { safeAuthNext } from "@/lib/auth/oauth-redirect";

export type MadBuddyOAuthProvider = Extract<Provider, "google">;

export async function startOAuth(provider: MadBuddyOAuthProvider, next: string) {
  const callbackUrl = new URL("/auth/callback", window.location.origin);
  callbackUrl.searchParams.set("next", safeAuthNext(next));

  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: callbackUrl.toString()
    }
  });

  if (error) {
    throw error;
  }
}
