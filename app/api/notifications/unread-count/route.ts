import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { getSupabaseBrowserEnv } from "@/lib/supabase/env";

// Cost note: the client previously derived this badge count by fetching a
// full page of notification rows and counting the unread ones in JS — both
// wasteful (rows shipped just to be counted) and wrong once a user had more
// unread notifications than that page's limit. A head-only exact count never
// ships a single row.
export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function GET(request: Request) {
  const env = getSupabaseBrowserEnv();
  if (!env.url || !env.anonKey) {
    return withCors(NextResponse.json({ error: "Supabase is not configured yet." }, { status: 503 }), request);
  }

  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const { user, supabase } = auth;

  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_read", false);

  if (error) {
    return withCors(NextResponse.json({ error: "Could not load the unread count." }, { status: 500 }), request);
  }

  return withCors(NextResponse.json({ unreadCount: count ?? 0 }), request);
}
