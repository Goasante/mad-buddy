import { NextResponse } from "next/server";
import { z } from "zod";
import { CANCELLATION_REASONS, cancellationReasonLabel } from "@/lib/revenue/cancellation";
import { recordBillingEvent } from "@/lib/revenue/events";
import { paystackRequest } from "@/lib/paystack/client";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const reasonValues = CANCELLATION_REASONS.map((reason) => reason.value) as [string, ...string[]];
const schema = z.object({ reason: z.enum(reasonValues).default("prefer_not_to_say") });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid cancellation reason." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const limit = await consumeRateLimit({ action: "paystack.cancel", userId: user.id });
  if (!limit.allowed) return NextResponse.json({ error: rateLimitMessage(limit.resetAt) }, { status: 429 });

  const admin = createSupabaseAdminClient();
  const { data: subscription, error } = await admin
    .from("subscriptions")
    .select("id, plan, status, current_period_end, cancel_at_period_end, paystack_subscription_code, paystack_email_token")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !subscription || subscription.plan === "free") {
    return NextResponse.json({ error: "No paid subscription was found." }, { status: 404 });
  }
  if (subscription.cancel_at_period_end || subscription.status === "non_renewing") {
    return NextResponse.json({ ok: true, message: "Your subscription is already set to end after the current billing period." });
  }
  if (!subscription.paystack_subscription_code || !subscription.paystack_email_token) {
    return NextResponse.json({ error: "This subscription cannot be changed automatically. Contact support." }, { status: 409 });
  }

  try {
    await paystackRequest<unknown>("/subscription/disable", {
      method: "POST",
      body: { code: subscription.paystack_subscription_code, token: subscription.paystack_email_token }
    });
  } catch {
    return NextResponse.json({ error: "Paystack could not schedule the cancellation. Try again shortly." }, { status: 502 });
  }

  const now = new Date().toISOString();
  const reason = cancellationReasonLabel(parsed.data.reason);
  const { error: updateError } = await admin
    .from("subscriptions")
    .update({ status: "non_renewing", cancel_at_period_end: true, updated_at: now })
    .eq("id", subscription.id);
  if (updateError) return NextResponse.json({ error: "Paystack accepted the request, but Mad Buddy could not refresh the status yet." }, { status: 502 });

  await admin.from("subscription_changes").insert({
    subscription_id: subscription.id,
    user_id: user.id,
    change_type: "cancel",
    from_plan: subscription.plan,
    to_plan: subscription.plan,
    effective_at: subscription.current_period_end,
    status: "scheduled",
    reason
  });
  try {
    await recordBillingEvent(admin, {
      event_type: "subscription_cancelled",
      source: "app_server",
      user_id: user.id,
      subscription_id: subscription.id,
      subscription_plan: subscription.plan,
      dedupe_key: `paystack:subscription_cancelled:${subscription.paystack_subscription_code}`,
      occurred_at: now
    });
  } catch {
    // Paystack and the canonical subscription state have already changed. The
    // webhook will retry the same dedupe key and complete reporting.
  }

  return NextResponse.json({ ok: true, message: "Your subscription will end after the current billing period." });
}
