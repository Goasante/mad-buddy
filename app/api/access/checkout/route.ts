import { NextResponse } from "next/server";
import { z } from "zod";

import { MAD_BUDDY_ACCESS, accessCheckoutAmount, isCheckoutConfigured } from "@/lib/access/product";
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
 * ── THE CLIENT SENDS A PRODUCT NAME, AND NOTHING ELSE ─────────────────────
 *
 * The request body accepts exactly one field, `product`, and it must equal
 * `"mad_buddy_access"`. There is no amount, no currency, no plan code and no
 * duration in the schema, so a client posting `{ amount: 1 }` is not "ignored"
 * in the loose sense -- zod strips it and no code path could read it anyway.
 *
 * Everything chargeable comes from `accessCheckoutAmount()`, which itself takes
 * no parameters. That is the structural guarantee: there is no function
 * signature anywhere in this path through which a caller could supply money.
 *
 * ── WHY A SEPARATE ROUTE FROM /api/paystack/initialize ────────────────────
 *
 * That route's schema is `z.enum(["plus", "pro"])` and its config lookup is
 * `getPaystackPlan(PaidPlanId)` -- the retired ladder. Adding a third branch
 * would mean loosening a schema whose narrowness is the security property, and
 * teaching the legacy path about a product that is not a tier. Access gets its
 * own endpoint with its own single-product schema.
 *
 * Everything else mirrors the existing route deliberately: CSRF origin check,
 * authentication, rate limit, the payments kill switch, and a `checkout_started`
 * billing event before any provider call.
 */

const checkoutRequestSchema = z.object({
  /* The ONLY accepted field. Not an amount, not a plan code, not a duration. */
  product: z.literal("mad_buddy_access")
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

  /* FAILS CLOSED ON MISSING CONFIGURATION. If the price or the plan code is
     absent, or Paystack has no secret key, no checkout is created -- rather
     than one that charges an unverifiable amount. */
  if (!isCheckoutConfigured() || !getPaystackSecretKey()) {
    logBackendEvent("warn", { requestId, route, statusCode: 503, latencyMs: Date.now() - startedAt });
    return NextResponse.json(
      { error: "Mad Buddy Access isn't available to buy just yet. Nothing has been charged." },
      { status: 503 }
    );
  }

  const price = accessCheckoutAmount();
  if (!price) {
    logBackendEvent("warn", { requestId, route, statusCode: 503, latencyMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Mad Buddy Access isn't available to buy just yet." }, { status: 503 });
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

  /* The payments kill switch. Checked before a checkout session exists, so a
     billing incident stops new charges. Existing entitlements are untouched --
     somebody who already has Access keeps it. */
  const guard = await guardFeature(admin, "payments");
  if (!guard.allowed) {
    logBackendEvent("warn", { requestId, route, statusCode: 503, latencyMs: Date.now() - startedAt });
    return NextResponse.json({ error: guard.message }, { status: 503 });
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

  const { data: existing } = await admin
    .from("subscriptions")
    .select("paystack_customer_code")
    .eq("user_id", user.id)
    .maybeSingle();

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

      /* The placeholder row is `free`/`free`, NOT the Access product.
         Nothing has been paid yet -- writing `mad_buddy_access` here would
         make an abandoned checkout look like a sale, and the resolver reads
         this table. The product is recorded only once a verified payment
         arrives. */
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
      if (upsertError) throw upsertError;
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
        /* SERVER-OWNED, every one of them. */
        amount: price.amountMinor,
        currency: price.currency,
        plan: price.planCode,
        callback_url: `${getAppUrl()}/subscription-success?provider=paystack`,
        metadata: {
          user_id: user.id,
          /* Echoed back by Paystack so the webhook can confirm which product
             this transaction was for, independently of the plan code. */
          product: MAD_BUDDY_ACCESS.id,
          customer_code: customerCode
        }
      }
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
      /* Paystack already created the transaction. A failed ledger write must
         not make the caller retry and create a SECOND checkout, so this is
         logged and swallowed -- the webhook is the authority on what actually
         happened. */
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
      reference: transaction.reference
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
