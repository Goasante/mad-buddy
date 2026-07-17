import { NextResponse } from "next/server";
import { z } from "zod";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { paystackRequest, type PaystackCustomer, type PaystackInitializeTransaction } from "@/lib/paystack/client";
import { getAppUrl, getMissingPaystackConfig, getPaystackPlan, type PaidPlanId } from "@/lib/paystack/config";
import { guardFeature } from "@/lib/admin/enforcement";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const initializeRequestSchema = z.object({
  plan: z.enum(["plus", "pro"])
});

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const route = "/api/paystack/initialize";
  const parsed = initializeRequestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    logBackendEvent("warn", { requestId, route, statusCode: 400, latencyMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Invalid subscription plan." }, { status: 400 });
  }

  const selectedPlan = parsed.data.plan as PaidPlanId;
  const plan = getPaystackPlan(selectedPlan);
  const missingConfig = getMissingPaystackConfig(selectedPlan);

  if (missingConfig.length > 0) {
    logBackendEvent("warn", { requestId, route, statusCode: 503, latencyMs: Date.now() - startedAt });
    return NextResponse.json(
      { error: `Paystack checkout is not configured yet. Missing: ${missingConfig.join(", ")}.` },
      { status: 503 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user?.email) {
    logBackendEvent("warn", {
      requestId,
      route,
      statusCode: 401,
      latencyMs: Date.now() - startedAt,
      errorType: userError ? errorType(userError) : undefined
    });
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit({
    action: "paystack.initialize",
    userId: user.id,
    requestId
  });

  if (!rateLimit.allowed) {
    logBackendEvent("warn", {
      requestId,
      route,
      statusCode: 429,
      latencyMs: Date.now() - startedAt,
      userId: user.id,
      rateLimited: true
    });
    return NextResponse.json({ error: rateLimitMessage(rateLimit.resetAt) }, { status: 429 });
  }

  const admin = createSupabaseAdminClient();

  // Payments kill switch (batch 13 §62). Checked before a checkout session is
  // created, so a billing incident stops new charges rather than only new
  // subscriptions. Existing entitlements are untouched (§63: degrade safely).
  const guard = await guardFeature(admin, "payments");
  if (!guard.allowed) {
    logBackendEvent("warn", { requestId, route, statusCode: 503, latencyMs: Date.now() - startedAt });
    return NextResponse.json({ error: guard.message }, { status: 503 });
  }

  const { data: subscription } = await admin
    .from("subscriptions")
    .select("paystack_customer_code")
    .eq("user_id", user.id)
    .maybeSingle();

  let customerCode = subscription?.paystack_customer_code ?? null;

  if (!customerCode) {
    try {
      const customer = await paystackRequest<PaystackCustomer>("/customer", {
        method: "POST",
        body: {
          email: user.email,
          first_name: user.user_metadata?.full_name ?? undefined,
          metadata: {
            user_id: user.id
          }
        }
      });
      customerCode = customer.customer_code;

      const { error: upsertError } = await admin.from("subscriptions").upsert(
        {
          user_id: user.id,
          provider: "paystack",
          paystack_customer_code: customerCode,
          plan: "free",
          status: "free"
        },
        { onConflict: "user_id" }
      );

      if (upsertError) {
        throw upsertError;
      }
    } catch (error) {
      logBackendEvent("error", {
        requestId,
        route,
        statusCode: 502,
        latencyMs: Date.now() - startedAt,
        userId: user.id,
        errorType: errorType(error)
      });
      return NextResponse.json({ error: "Could not prepare Paystack customer." }, { status: 502 });
    }
  }

  try {
    const transaction = await paystackRequest<PaystackInitializeTransaction>("/transaction/initialize", {
      method: "POST",
      body: {
        email: user.email,
        amount: plan.amount,
        currency: plan.currency,
        plan: plan.planCode,
        callback_url: `${getAppUrl()}/subscription-success?provider=paystack`,
        metadata: {
          user_id: user.id,
          plan: selectedPlan,
          app_plan: plan.appPlan,
          customer_code: customerCode
        }
      }
    });

    logBackendEvent("info", {
      requestId,
      route,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
      userId: user.id
    });

    return NextResponse.json({ authorizationUrl: transaction.authorization_url });
  } catch (error) {
    logBackendEvent("error", {
      requestId,
      route,
      statusCode: 502,
      latencyMs: Date.now() - startedAt,
      userId: user.id,
      errorType: errorType(error)
    });
    return NextResponse.json({ error: "Could not start Paystack checkout." }, { status: 502 });
  }
}
