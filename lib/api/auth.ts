import "server-only";

import type { User } from "@supabase/supabase-js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseBrowserEnv } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

export type ApiAuth = {
  user: User;
  /** A Supabase client scoped to this user, so RLS applies to its queries. */
  supabase: SupabaseClient<Database>;
};

/**
 * Resolves the authenticated user for an API route from EITHER transport:
 *
 *  - Web (unchanged): the Supabase cookie session, exactly as today.
 *  - Mobile (new): an `Authorization: Bearer <access_token>` header from the
 *    Capacitor app's Supabase client.
 *
 * Returns a user-scoped client in both cases, so route handlers keep running
 * queries under RLS as that user. Privileged operations still use the
 * service-role admin client as before. Returns null when unauthenticated.
 *
 * This is additive: the cookie branch is byte-for-byte what the existing
 * handlers already do, so retrofitting a route never changes web behaviour.
 */
export async function resolveApiUser(request: Request): Promise<ApiAuth | null> {
  const header = request.headers.get("authorization");

  if (header?.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    if (!token) return null;

    const env = getSupabaseBrowserEnv();
    if (!env.url || !env.anonKey) return null;

    // A stateless client that presents the caller's token, so both auth
    // verification and every subsequent query run as that user under RLS.
    const supabase = createClient<Database>(env.url, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const {
      data: { user },
      error
    } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    return { user, supabase };
  }

  // Web: the cookie session, unchanged.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { user, supabase };
}
