import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

/**
 * Returns an opaque version for the latest audited Admin repair on THIS
 * authenticated account.
 *
 * The browser never chooses a target user and never receives the repair type,
 * actor, reason or any private account data. A changed opaque version only
 * means "support changed something; refresh canonical state".
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ version: null }, { status: 401, headers: noStoreHeaders() });
  }

  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return NextResponse.json({ version: null }, { status: 200, headers: noStoreHeaders() });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("admin_audit_events")
    .select("id, created_at")
    .eq("target_type", "user")
    .eq("target_id", user.id)
    .like("action", "repair:%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Refresh signalling is deliberately best-effort. It must never make the
    // authenticated app unavailable when Admin observability is degraded.
    return NextResponse.json({ version: null }, { status: 200, headers: noStoreHeaders() });
  }

  return NextResponse.json(
    { version: data ? `${data.created_at}:${data.id}` : null },
    { status: 200, headers: noStoreHeaders() }
  );
}

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache"
  };
}
