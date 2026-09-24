import { headers } from "next/headers";

import { SessionsPage } from "@/components/settings/sessions-page";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function deviceLabel(userAgent: string | null) {
  if (!userAgent || /node|supabase-js/i.test(userAgent)) return "Other device";
  const browser = userAgent.includes("Edg/")
    ? "Edge"
    : userAgent.includes("CriOS/")
      ? "Chrome"
      : userAgent.includes("Chrome/")
        ? "Chrome"
        : userAgent.includes("FxiOS/") || userAgent.includes("Firefox/")
          ? "Firefox"
          : userAgent.includes("Safari/")
            ? "Safari"
            : "App";
  const device = /Android/i.test(userAgent)
    ? "Android"
    : /iPhone/i.test(userAgent)
      ? "iPhone"
      : /iPad/i.test(userAgent)
        ? "iPad"
        : /Windows/i.test(userAgent)
          ? "Windows"
          : /Macintosh/i.test(userAgent)
            ? "Mac"
            : /Linux/i.test(userAgent)
              ? "Linux"
              : "Device";
  return `${device} · ${browser}`;
}

export default async function SettingsSessionsPage() {
  const [headerList, supabase] = await Promise.all([headers(), createSupabaseServerClient()]);
  const [{ data: { user } }, claimsResult] = await Promise.all([
    supabase.auth.getUser(),
    typeof supabase.auth.getClaims === "function"
      ? supabase.auth.getClaims()
      : Promise.resolve({ data: null })
  ]);
  const currentSessionId =
    claimsResult.data?.claims && typeof claimsResult.data.claims.session_id === "string"
      ? claimsResult.data.claims.session_id
      : null;

  const { data } = user
    ? await supabase
        .from("account_sessions")
        .select("session_id, created_at, last_seen_at, user_agent, not_after")
        .eq("user_id", user.id)
        .order("last_seen_at", { ascending: false })
    : { data: [] };

  const currentUserAgent = headerList.get("user-agent");
  const sessions = (data ?? []).map((session) => ({
    id: session.session_id,
    label: session.session_id === currentSessionId
      ? deviceLabel(currentUserAgent)
      : deviceLabel(session.user_agent),
    createdAt: session.created_at,
    lastSeenAt: session.last_seen_at,
    expiresAt: session.not_after,
    current: session.session_id === currentSessionId
  }));

  return <SessionsPage sessions={sessions} />;
}
