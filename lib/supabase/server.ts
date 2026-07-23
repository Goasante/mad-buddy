import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseCookieOptions } from "@/lib/supabase/cookie-options";
import { assertSupabaseBrowserEnv } from "@/lib/supabase/env";

export async function createSupabaseServerClient() {
  const { url, anonKey } = assertSupabaseBrowserEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookieOptions: supabaseCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component, where the cookie store is
          // read-only and `set` throws. Safe to ignore per the official
          // @supabase/ssr guidance: proxy.ts refreshes the session on every
          // matched request and writes the refreshed cookies there. Without
          // this guard the throw escapes and takes down the entire page render
          // whenever a token happens to refresh mid-render.
        }
      }
    }
  });
}
