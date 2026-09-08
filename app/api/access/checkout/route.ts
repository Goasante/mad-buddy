import { NextResponse } from "next/server";
import { z } from "zod";

import {
  MAD_BUDDY_ACCESS,
  accessCheckoutAmount,
  accessMobileMoneyCheckoutAmount,
  isCheckoutConfigured,
  isMobileMoneyCheckoutConfigured,
  type AccessCheckoutMethod,
  type AccessPaymentMode
} from "@/lib/access/product";
import { guardFeature } from "@/lib/admin/enforcement";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { paystackRequest, type PaystackCustomer, type PaystackInitializeTransaction } from "@/lib/paystack/client";
import { getAppUrl, getPaystackSecretKey } from "@/lib/paystack/config";
import { recordBillingEvent } from "@/lib/revenue/events";
import { invalidMutationOriginResponse } from "@/lib/security/csrf";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Start a Mad Buddy Access checkout.
 *
 * The client may choose only WHICH checkout experience to use. It never sends
 * an amount, currency, Paystack plan code or duration. Those remain server
 * authority.
 *
 * - `card` creates the existing monthly Paystack subscription and auto-renews.
 * - `mobile_money` creates a one-time GHS transaction with the Mobile Money
 *   channel only. A verified success buys 30 days and never auto-renews.
 */
const checkoutRequestSchema = z.object({
  product: z.literal("mad_buddy_access"),
  /* Default preserves compatibility with older web/native clients that posted
     only the product before Ghana Mobile Money was added. */
  paymentMethod: z.enum(["card", "mobile_money"]).default("card")
});

export async function POST(request: Request) {
  const originError = invalidMutationOriginResponse(request);
  if (originError) return originError;

  const requestId = createRequestId();
  const startedAt = Date.now();
  const route = "/api/access/checkout";

  const parsed = checkoutRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    logBackendEvent("warn", { requestId, route, statusCode: 400, latencyMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Invalid checkout request." }, { status: 400 });
  }

  const paymentMethod: AccessCheckoutMethod = parsed.data.paymentMethod;
  const paymentMode: AccessPaymentMode =
    paymentMethod === "mobile_money" ? "mobile_money_30d" : "card_subscription";
  const cardPrice = paymentMethod === "card" ? accessCheckoutAmount() : null;
  const mobileMoneyPrice = paymentMethod === "mobile_money" ? accessMobileMoneyCheckoutAmount() : null;
  const price = cardPrice ?? mobileMoneyPrice;

  const configured =
    paymentMethod === "card" ? isCheckoutConfigured() : isMobileMoneyCheckoutConfigured();
  if (!configured || !price || !getPaystackSecretKey()) {
    logBackendEvent("warn", { requestId, route, statusCode: 503, latencyMs: Date.now() - startedAt });
    return NextResponse.json(
      { error: "Mad Buddy Access isn't available to buy just yet. Nothing has been charged." },
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

  const rateLimit = await consumeRateLimit({ action: "paystack.initialize", userId: user.id, requestId });
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

  const guard = await guardFeature(admin, "payments");
  if (!guard.allowed) {
    logBackendEvent("warn", { requestId, route, statusCode: 503, latencyMs: Date.now() - startedAt });
    return NextResponse.json({ error: guard.message }, { status: 503 });
  }

  /* Do not sell a second paid period while a provider-backed Access period is
     already live. This prevents accidental double-purchases and, importantly,
     stops a direct API call from replacing an active recurring card row with a
     manual Mobile Money row. Welcome/admin/global access may still buy Access. */
  const { data: existing, error: existingError } = await admin
    .from("subscriptions")
    .select(
      "paystack_customer_code, plan, status, current_period_end, grace_ends_at, paystack_subscription_code"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingError) {
    logBackendEvent("error", {
      requestId,
      route,
      statusCode: 503,
      latencyMs: Date.now() - startedAt,
      userId: user.id,
      errorType: errorType(existingError)
    });
    return NextResponse.json({ error: "Checkout is temporarily unavailable. Try again shortly." }, { status: 503 });
  }

  if (hasLivePaidAccess(existing)) {
    return NextResponse.json(
      { error: "Mad Buddy Access is already active. Manage the current paid period in Settings." },
      { status: 409 }
    );
  }

  try {
    await recordBillingEvent(admin, {
      event_type: "checkout_started",
      source: "app_server",
      user_id: user.id,
      subscription_plan: "mad_buddy_access",
      amount_minor: price.amountMinor,
      currency: price.currency,
      dedupe_key: `access_checkout_started:${requestId}`
    });
  } catch (error) {
    logBackendEvent("error", {
      requestId,
      route,
      statusCode: 503,
      latencyMs: Date.now() - startedAt,
      userId: user.id,
      errorType: errorType(error)
    });
    return NextResponse.json({ error: "Checkout is temporarily unavailable. Try again shortly." }, { status: 503 });
  }

  let customerCode = existing?.paystack_customer_code ?? null;

  if (!customerCode) {
    try {
      const customer = await paystackRequest<PaystackCustomer>("/customer", {
        method: "POST",
        body: {
          email: user.email,
          first_name: user.user_metadata?.full_name ?? undefined,
          metadata: { user_id: user.id }
        }
      });
      customerCode = customer.customer_code;

      if (existing) {
        /* Preserve an expired historical paid row. Customer creation is not a
           payment and must not rewrite its product/status to free. */
        const { error: updateError } = await admin
          .from("subscriptions")
          .update({ paystack_customer_code: customerCode, provider: "paystack" })
          .eq("user_id", user.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await admin.from("subscriptions").insert({
          user_id: user.id,
          provider: "paystack",
          paystack_customer_code: customerCode,
          plan: "free",
          status: "free"
        });
        if (insertError) throw insertError;
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
    const transactionBody: Record<string, unknown> = {
      email: user.email,
      amount: price.amountMinor,
      currency: price.currency,
      callback_url: `${getAppUrl()}/subscription-success?provider=paystack`,
      metadata: {
        user_id: user.id,
        product: MAD_BUDDY_ACCESS.id,
        access_payment_mode: paymentMode,
        customer_code: customerCode
      }
    };

    if (paymentMethod === "card") {
      /* A Paystack plan is what creates recurring billing. Restricting the
         hosted checkout to card makes the UI promise match provider reality. */
      transactionBody.plan = cardPrice?.planCode;
      transactionBody.channels = ["card"];
    } else {
      /* No plan here. Attaching one is exactly what removes Ghana Mobile Money
         from a recurring checkout. Paystack's hosted sheet will offer the
         eligible Ghana providers for the `mobile_money` channel. */
      transactionBody.channels = ["mobile_money"];
    }

    const transaction = await paystackRequest<PaystackInitializeTransaction>("/transaction/initialize", {
      method: "POST",
      body: transactionBody
    });

    try {
      await recordBillingEvent(admin, {
        event_type: "payment_attempted",
        source: "app_server",
        user_id: user.id,
        subscription_plan: "mad_buddy_access",
        amount_minor: price.amountMinor,
        currency: price.currency,
        transaction_reference: transaction.reference,
        dedupe_key: `paystack:access_payment_attempted:${transaction.reference}`
      });
    } catch (error) {
      /* The provider already created the checkout. Do not create a second
         transaction merely because analytics/ledger enrichment failed here;
         the signed webhook remains payment authority. */
      logBackendEvent("warn", {
        requestId,
        route,
        latencyMs: Date.now() - startedAt,
        userId: user.id,
        errorType: errorType(error)
      });
    }

    logBackendEvent("info", {
      requestId,
      route,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
      userId: user.id
    });

    return NextResponse.json({
      authorizationUrl: transaction.authorization_url,
      reference: transaction.reference,
      paymentMethod
    });
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

type ExistingSubscription = {
  plan: string | null;
  status: string | null;
  current_period_end: string | null;
  grace_ends_at: string | null;
} | null;

function hasLivePaidAccess(subscription: ExistingSubscription): boolean {
  if (!subscription || subscription.plan !== "mad_buddy_access") return false;
  if (!subscription.status || !["active", "trialing", "past_due", "non_renewing"].includes(subscription.status)) {
    return false;
  }

  const effectiveEnd =
    subscription.status === "past_due"
      ? subscription.grace_ends_at ?? subscription.current_period_end
      : subscription.current_period_end;

  /* A live paid row without an end is treated as active, matching the resolver's
     fail-safe behaviour rather than risking a duplicate charge. */
  if (!effectiveEnd) return true;
  const parsedEnd = Date.parse(effectiveEnd);
  return Number.isNaN(parsedEnd) || parsedEnd > Date.now();
}
