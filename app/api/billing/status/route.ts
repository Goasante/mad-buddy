import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { errorType, logBackendEvent } from "@/lib/observability/logger";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .select("plan, status, current_period_start, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    /* Record the cause before returning the generic message.
     * The user-facing text stays vague on purpose — it must not leak schema
     * detail — but discarding the error entirely is what made MB-GOD-020
     * (a broken data export) invisible for its whole life. logBackendEvent is
     * the privacy-safe channel: it strips location, tokens and secrets, and
     * errorType records the Postgres CODE rather than the message. */
    logBackendEvent("error", {
      route: "/api/billing/status",
      action: "billing.status",
      statusCode: 500,
      errorType: errorType(error)
    });
    return NextResponse.json({ error: "Could not load subscription status." }, { status: 500 });
  }

  return NextResponse.json(
    data ?? {
      plan: "free",
      status: "free",
      current_period_start: null,
      current_period_end: null
    }
  );
}
