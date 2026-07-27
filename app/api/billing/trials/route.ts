import { NextResponse } from "next/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cancelUserTrial, getTrialEligibility, startUserTrial } from "@/lib/trials/service";

async function authenticatedUser() {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return { error: "Trials are not configured.", status: 503 } as const;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { error: "Authentication required.", status: 401 } as const;
  return { user: data.user } as const;
}

export async function GET() {
  const auth = await authenticatedUser();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const state = await getTrialEligibility(createSupabaseAdminClient(), auth.user.id);
  const response = NextResponse.json(state);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST() {
  const auth = await authenticatedUser();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const limit = await consumeRateLimit({ action: "trials.start", userId: auth.user.id });
  if (!limit.allowed) return NextResponse.json({ error: rateLimitMessage(limit.resetAt) }, { status: 429 });
  try {
    const trial = await startUserTrial(createSupabaseAdminClient(), auth.user.id);
    return NextResponse.json({
      ok: true,
      trial: { plan: trial.plan, startedAt: trial.trial_started_at, endsAt: trial.trial_ends_at }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "A premium trial could not be started.";
    return NextResponse.json({ error: safeTrialError(message) }, { status: 409 });
  }
}

export async function DELETE() {
  const auth = await authenticatedUser();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const cancelled = await cancelUserTrial(createSupabaseAdminClient(), auth.user.id);
  return NextResponse.json({ ok: true, cancelled });
}

function safeTrialError(message: string) {
  if (message.includes("already_paid")) return "Your paid plan already includes premium access.";
  if (message.includes("trial_already_active")) return "Your premium trial is already active.";
  if (message.includes("trial_already_used")) return "This account has already used a premium trial.";
  if (message.includes("onboarding_required")) return "Finish account setup before starting a trial.";
  if (message.includes("trials_disabled") || message.includes("trial_not_available")) {
    return "Premium trials are not available right now.";
  }
  return "This account is not eligible for a premium trial.";
}
