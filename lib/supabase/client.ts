"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseCookieOptions } from "@/lib/supabase/cookie-options";
import { assertSupabaseBrowserEnv } from "@/lib/supabase/env";

export function createSupabaseBrowserClient() {
  const { url, anonKey } = assertSupabaseBrowserEnv();

  // Same cookie policy as the server client and the proxy: all three write the
  // same cookies, so a mismatch would produce duplicate cookies at different
  // scopes and intermittent "logged out" behaviour.
  return createBrowserClient<Database>(url, anonKey, {
    cookieOptions: supabaseCookieOptions()
  });
}
