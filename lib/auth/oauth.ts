import type { Provider } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type MadBuddyOAuthProvider = Extract<Provider, "google">;

export async function startOAuth(provider: MadBuddyOAuthProvider, next: "/dashboard" | "/onboarding") {
  const callbackUrl = new URL("/auth/callback", window.location.origin);
  callbackUrl.searchParams.set("next", next);

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
