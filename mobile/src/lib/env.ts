// Public build-time config. Vite inlines import.meta.env.VITE_* at build.
// These are all public values — never put the Supabase service role key here.

export const env = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, ""),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? ""
};

export function assertEnv(): string | null {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    return "Supabase config is missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.";
  }
  if (!env.apiBaseUrl) {
    return "API base URL is missing. Set VITE_API_BASE_URL to the deployed web app.";
  }
  return null;
}
