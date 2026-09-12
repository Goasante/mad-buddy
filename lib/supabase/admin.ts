import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { assertSupabaseServiceRoleEnv } from "@/lib/supabase/env";
import type { FetchImplementation } from "@/lib/network/resilience";

export function createSupabaseAdminClient(options: { fetch?: FetchImplementation } = {}) {
  const { url, serviceRoleKey } = assertSupabaseServiceRoleEnv();

  return createClient<Database>(url, serviceRoleKey, {
    ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
