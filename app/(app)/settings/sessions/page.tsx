import { SessionsPage } from "@/components/settings/sessions-page";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function deviceLabel(userAgent: string) {
  const browser = userAgent.includes("Edg/") ? "Edge" : userAgent.includes("Chrome/") ? "Chrome" : userAgent.includes("Firefox/") ? "Firefox" : userAgent.includes("Safari/") ? "Safari" : "Browser";
  const device = /Android/i.test(userAgent) ? "Android" : /iPhone|iPad/i.test(userAgent) ? "iPhone or iPad" : /Windows/i.test(userAgent) ? "Windows" : /Macintosh/i.test(userAgent) ? "Mac" : /Linux/i.test(userAgent) ? "Linux" : "Current device";
  return `${device} · ${browser}`;
}

export default async function SettingsSessionsPage() {
  const [headerList, supabase] = await Promise.all([headers(), createSupabaseServerClient()]);
  const { data: { user } } = await supabase.auth.getUser();
  return <SessionsPage deviceLabel={deviceLabel(headerList.get("user-agent") ?? "")} signedInAt={user?.last_sign_in_at ?? null} />;
}
