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

/**
 * Puts the signed-in user's access token on the Realtime socket, and resolves
 * once it's there. Callers must await this BEFORE `.subscribe()`.
 *
 * Every `postgres_changes` subscription in this app is on an RLS-protected
 * table with a `user_id`/`conversation_id`-scoped filter. Realtime evaluates RLS
 * against the SOCKET's own credentials, not the cookies on the page — so a
 * socket carrying only the publishable key cannot see any row it subscribes to,
 * and Supabase closes the channel with CHANNEL_ERROR. Because each caller builds
 * its own client inside an effect and subscribed immediately, no auth-state
 * event had fired yet to attach the token, so every channel raced straight into
 * that error and fell back to polling.
 *
 * `setAuth()` is deliberately called with NO argument: that is the documented
 * form that has the client resolve its own current token internally. Reading the
 * token out ourselves would require the unverified cookie-reading session call
 * that is banned repo-wide (see lib/security/session-storage.test.ts) — and
 * there is no reason to hold a raw token here just to hand it straight back.
 *
 * This grants no trust by itself: the server still validates the JWT and applies
 * RLS. An unauthenticated socket simply fails as before and the caller's poll
 * fallback covers it.
 */
export async function authenticateRealtime(
  client: ReturnType<typeof createSupabaseBrowserClient>
): Promise<void> {
  try {
    await client.realtime.setAuth();
  } catch {
    // Leave the socket as-is; the channel will error and the caller polls.
  }
}
