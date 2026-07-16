export function getSupabaseBrowserEnv() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  };
}

export function getSupabaseServerEnv() {
  return {
    ...getSupabaseBrowserEnv(),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
}

export function assertSupabaseBrowserEnv() {
  const env = getSupabaseBrowserEnv();

  if (!env.url || !env.anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return env as { url: string; anonKey: string };
}

export function assertSupabaseServiceRoleEnv() {
  const env = getSupabaseServerEnv();

  if (!env.url || !env.serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  return env as { url: string; anonKey?: string; serviceRoleKey: string };
}
