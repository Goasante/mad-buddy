import { NextResponse } from "next/server";
import {
  calculateUsage,
  loadBillingState,
  resolveUserEntitlements,
  serializeEntitlements
} from "@/lib/billing/service";
import { effectivePlan } from "@/lib/billing/entitlements";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Current entitlements + usage (spec §14). The client may use this to show
 * limits and upgrade prompts, but the server remains authoritative, every
 * protected operation re-checks (spec §13).
 */
export async function GET() {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return NextResponse.json({ error: "Billing is not configured yet." }, { status: 503 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const nowMs = Date.now();
  const [state, entitlements, usage] = await Promise.all([
    loadBillingState(admin, user.id),
    resolveUserEntitlements(admin, user.id, nowMs),
    calculateUsage(admin, user.id)
  ]);

  const response = NextResponse.json({
    plan: effectivePlan(state, nowMs),
    status: state.status,
    // Renewal/period info the billing screen needs (spec §70).
    currentPeriodEnd: state.periodEndMs ? new Date(state.periodEndMs).toISOString() : null,
    inGracePeriod: state.graceEndsMs !== null && nowMs <= state.graceEndsMs,
    entitlements: serializeEntitlements(entitlements),
    usage
  });

  // Entitlements are per-user and change on billing events, never shared.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
