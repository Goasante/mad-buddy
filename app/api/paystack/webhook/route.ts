import { createHash, createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { GRACE_PERIOD_DAYS } from "@/lib/billing/entitlements";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { markPaystackSubscriptionStatus, syncPaystackSubscription, validatePaystackSyncInput } from "@/lib/paystack/sync";
import { getMissingPaystackWebhookConfig, getPaystackWebhookSecret } from "@/lib/paystack/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit, getClientIpHashFromRequest } from "@/lib/security/rate-limit";
import { loadSubscriptionSnapshot, recordBillingEvent, recordSuccessfulPayment } from "@/lib/revenue/events";
import { deliverNotification } from "@/lib/notifications/server";
import { markTrialConverted } from "@/lib/trials/service";
import {
  accessPeriodEnd,
  cancelAccessSubscription,
  isAccessEvent,
  recordAccessSubscription,
  verifyAccessEvent,
  type AccessPaystackEvent
} from "@/lib/access/paystack";
import { MAD_BUDDY_ACCESS } from "@/lib/access/product";

const MAX_WEBHOOK_BYTES = 256 * 1024;

type PaystackWebhookEvent = {
  event: string;
  data: {
    id?: number | string;
    reference?: string;
    status?: string;
    paid_at?: string | null;
    amount?: number;
    fees?: number | null;
    currency?: string;
    metadata?: {
      user_id?: string;
      plan?: "plus" | "pro";
      app_plan?: "buddy_plus" | "buddy_pro";
      /* Set by /api/access/checkout so the webhook can confirm which product a
         transaction was for, independently of the plan code. */
      product?: string;
    };
    customer?: {
      customer_code?: string;
      email?: string;
    };
    authorization?: {
      authorization_code?: string;
    };
    subscription?: {
      subscription_code?: string;
      email_token?: string;
      status?: string;
      next_payment_date?: string | null;
      customer?: {
        customer_code?: string;
      };
      plan?: string | { plan_code?: string };
    };
    subscription_code?: string;
    email_token?: string;
    next_payment_date?: string | null;
    plan?: string | { plan_code?: string };
  };
};

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const route = "/api/paystack/webhook";
  const missingConfig = getMissingPaystackWebhookConfig();
  const webhookSecret = getPaystackWebhookSecret();
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
  }
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
  }
  const signature = request.headers.get("x-paystack-signature");

  if (missingConfig.length > 0 || !webhookSecret) {
    logBackendEvent("warn", { requestId, route, statusCode: 503, latencyMs: Date.now() - startedAt });
    return NextResponse.json(
      { error: "Payment notifications are temporarily unavailable." },
      { status: 503 }
    );
  }

  if (!signature || !isValidPaystackSignature(body, signature, webhookSecret)) {
    logBackendEvent("warn", { requestId, route, statusCode: 400, latencyMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Invalid Paystack signature." }, { status: 400 });
  }

  const rateLimit = await consumeRateLimit({
    action: "paystack.webhook",
    ipHash: getClientIpHashFromRequest(request),
    requestId
  });
  if (!rateLimit.allowed) return NextResponse.json({ error: "Too many webhook requests." }, { status: 429 });

  let event: PaystackWebhookEvent;
  try {
    event = JSON.parse(body) as PaystackWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }
  if (!event || typeof event.event !== "string" || !event.data || typeof event.data !== "object") {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();
  const eventId = buildEventId(event, body);
  const { data: existingEvent } = await admin
    .from("paystack_webhook_events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();

  if (existingEvent) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const { error: insertEventError } = await admin.from("paystack_webhook_events").insert({
    id: eventId,
    type: event.event
  });

  if (insertEventError?.code === "23505") {
    return NextResponse.json({ received: true, duplicate: true });
  }

  if (insertEventError) {
    logBackendEvent("error", {
      requestId,
      route,
      statusCode: 500,
      latencyMs: Date.now() - startedAt,
      errorType: errorType(insertEventError)
    });
    return NextResponse.json({ error: "Webhook receipt could not be recorded." }, { status: 500 });
  }

  try {
    await handlePaystackEvent(event, eventId);
  } catch (error) {
    // A failed attempt must not poison the idempotency ledger. Paystack can
    // safely retry and the next verified delivery will be processed again.
    await admin.from("paystack_webhook_events").delete().eq("id", eventId);
    logBackendEvent("error", {
      requestId,
      route,
      statusCode: 500,
      latencyMs: Date.now() - startedAt,
      errorType: errorType(error)
    });
    return NextResponse.json({ error: "Paystack webhook processing failed." }, { status: 500 });
  }

  logBackendEvent("info", {
    requestId,
    route,
    statusCode: 200,
    latencyMs: Date.now() - startedAt
  });

  return NextResponse.json({ received: true });
}

async function handlePaystackEvent(event: PaystackWebhookEvent, eventId: string) {
  const admin = createSupabaseAdminClient();
  const data = event.data;
  const userId = data.metadata?.user_id;

  /* MAD BUDDY ACCESS IS ROUTED FIRST, AND SEPARATELY.
   *
   * Access events must not reach `validatePaystackSyncInput`, which resolves a
   * plan code onto the retired ladder and throws "Unrecognized Paystack plan"
   * for anything that is not buddy_plus/buddy_pro. Routing on the plan code (or
   * the `product` metadata we set at checkout) keeps both products verified by
   * the rules that actually apply to them.
   *
   * The signature has already been checked and the event de-duplicated by the
   * caller, so this is trusted-as-delivered but NOT trusted-as-described:
   * every field below is still verified against server configuration. */
  const accessEvent = {
    amount: data.amount ?? null,
    currency: data.currency ?? null,
    planCode: typeof data.plan === "string" ? data.plan : data.plan?.plan_code ?? null,
    product: typeof data.metadata?.product === "string" ? data.metadata.product : null
  };

  if (isAccessEvent(accessEvent)) {
    await handleAccessEvent(admin, event.event, accessEvent, data, userId, eventId);
    return;
  }

  switch (event.event) {
    case "charge.success":
    case "subscription.create":
    case "subscription.enable":
    case "invoice.update": {
      if (!userId) {
        return;
      }

      const syncInput = {
        userId,
        plan: data.metadata?.plan ?? data.metadata?.app_plan ?? null,
        status: data.status,
        reference: data.reference ?? null,
        paidAt: data.paid_at ?? null,
        amount: data.amount ?? null,
        currency: data.currency ?? null,
        customer: data.customer ?? null,
        authorization: data.authorization ?? null,
        subscription:
          data.subscription ??
          (data.subscription_code
            ? {
                subscription_code: data.subscription_code,
                email_token: data.email_token,
                status: data.status,
                next_payment_date: data.next_payment_date,
                customer: data.customer,
                plan: data.plan
              }
            : null),
        planCode: typeof data.plan === "string" ? data.plan : data.plan?.plan_code ?? null
      } as const;
      const plan = validatePaystackSyncInput(syncInput);
      const previous = await loadSubscriptionSnapshot(admin, userId);

      if (
        event.event === "charge.success" &&
        data.reference &&
        typeof data.amount === "number" &&
        data.currency
      ) {
        await recordSuccessfulPayment(admin, {
          userId,
          plan,
          previous,
          source: "paystack_webhook",
          reference: data.reference,
          providerEventId: eventId,
          amountMinor: data.amount,
          providerFeeMinor: data.fees,
          currency: data.currency,
          paidAt: data.paid_at,
          subscriptionId: previous?.id
        });
      }
      await syncPaystackSubscription(admin, syncInput);
      if (event.event === "charge.success") {
        await markTrialConverted(admin, userId, plan);
      }
      return;
    }
    case "subscription.not_renew": {
      // Cancelled-but-paid-through: access continues to period end (§59).
      await markPaystackSubscriptionStatus(
        admin,
        data.subscription_code ?? data.subscription?.subscription_code,
        "non_renewing",
        { cancelAtPeriodEnd: true }
      );
      await recordLifecycleEvent(admin, eventId, data, "subscription_cancelled");
      return;
    }
    case "subscription.disable": {
      await markPaystackSubscriptionStatus(
        admin,
        data.subscription_code ?? data.subscription?.subscription_code,
        "cancelled",
        { graceEndsAt: null }
      );
      await recordLifecycleEvent(admin, eventId, data, "subscription_cancelled");
      return;
    }
    case "invoice.payment_failed": {
      // Failed renewal starts the grace window (§61): paid features survive
      // until grace_ends_at, then effectivePlan falls back to free (§62).
      const subscriptionCode = data.subscription_code ?? data.subscription?.subscription_code;
      const subscription = await findSubscriptionByCode(admin, subscriptionCode);
      await markPaystackSubscriptionStatus(
        admin,
        subscriptionCode,
        "past_due",
        { graceEndsAt: new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString() }
      );
      if (subscription) {
        await recordBillingEvent(admin, {
          event_type: "payment_failed",
          source: "paystack_webhook",
          user_id: subscription.user_id,
          subscription_id: subscription.id,
          subscription_plan: subscription.plan,
          amount_minor: typeof data.amount === "number" ? data.amount : null,
          currency: data.currency?.toUpperCase() ?? null,
          transaction_reference: data.reference ?? null,
          provider_event_id: eventId,
          dedupe_key: `paystack:payment_failed:${data.reference ?? eventId}`
        });
        await deliverNotification(admin, {
          userId: subscription.user_id,
          priority: "high",
          type: "subscription_update",
          title: "Payment needs attention",
          message: "Your Mad Buddy renewal didn't go through. Update your payment details to keep your benefits."
        });
      }
      return;
    }
    default:
      return;
  }
}

async function findSubscriptionByCode(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  subscriptionCode: string | null | undefined
) {
  if (!subscriptionCode) return null;
  const { data, error } = await admin
    .from("subscriptions")
    .select("id, user_id, plan, status")
    .eq("paystack_subscription_code", subscriptionCode)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function recordLifecycleEvent(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  eventId: string,
  data: PaystackWebhookEvent["data"],
  eventType: "subscription_cancelled"
) {
  const subscriptionCode = data.subscription_code ?? data.subscription?.subscription_code;
  const subscription = await findSubscriptionByCode(admin, subscriptionCode);
  if (!subscription) return;
  await recordBillingEvent(admin, {
    event_type: eventType,
    source: "paystack_webhook",
    user_id: subscription.user_id,
    subscription_id: subscription.id,
    subscription_plan: subscription.plan,
    provider_event_id: eventId,
    // A non-renewing notice and a later disablement are separate lifecycle
    // facts. Retries of either provider event still share the same event ID.
    dedupe_key: `paystack:${eventType}:${eventId}`
  });
}

function isValidPaystackSignature(body: string, signature: string, secret: string) {
  const expected = createHmac("sha512", secret).update(body).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");

  return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer);
}

function buildEventId(event: PaystackWebhookEvent, rawBody: string) {
  const stableId = [
    event.event,
    event.data.id,
    event.data.reference,
    event.data.subscription_code,
    event.data.subscription?.subscription_code
  ]
    .filter(Boolean)
    .join(":");
  return stableId || `${event.event}:${createHash("sha256").update(rawBody).digest("hex")}`;
}

/**
 * Mad Buddy Access webhook events.
 *
 * Every branch verifies against server configuration before writing anything.
 * A refused event is logged and DROPPED -- never retried into a different code
 * path, and never partially applied.
 */
async function handleAccessEvent(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  eventName: string,
  accessEvent: AccessPaystackEvent,
  data: PaystackWebhookEvent["data"],
  userId: string | undefined,
  eventId: string
): Promise<void> {
  /* CANCELLATION IS VERIFIED DIFFERENTLY, and deliberately earlier.
   *
   * `subscription.not_renew` and `subscription.disable` carry no amount and
   * often no user metadata -- they are keyed on the subscription code. Running
   * them through the full amount check would reject legitimate cancellations,
   * so they are matched on the subscription code we already stored, which is
   * itself proof the subscription is ours. */
  if (eventName === "subscription.not_renew" || eventName === "subscription.disable") {
    const subscriptionCode = data.subscription_code ?? data.subscription?.subscription_code ?? null;
    await cancelAccessSubscription(admin, subscriptionCode);
    return;
  }

  const verification = verifyAccessEvent(accessEvent);
  if (!verification.ok) {
    /* Refused. Logged with the reason so a real misconfiguration is
       diagnosable, and dropped so a forged or mismatched event cannot
       activate access. */
    logBackendEvent("warn", {
      requestId: eventId,
      route: "/api/paystack/webhook",
      statusCode: 200,
      latencyMs: 0,
      errorType: `access_event_rejected:${verification.reason}`
    });
    return;
  }

  if (!userId) return;

  if (
    eventName === "charge.success" ||
    eventName === "subscription.create" ||
    eventName === "subscription.enable" ||
    eventName === "invoice.update"
  ) {
    const paidAt = data.paid_at ? new Date(data.paid_at) : new Date();
    const periodEnd = accessPeriodEnd(
      data.next_payment_date ?? data.subscription?.next_payment_date ?? null,
      paidAt
    );

    await recordAccessSubscription(admin, {
      userId,
      status: "active",
      periodStart: paidAt,
      periodEnd,
      customerCode: data.subscription?.customer?.customer_code ?? data.customer?.customer_code ?? null,
      subscriptionCode: data.subscription?.subscription_code ?? data.subscription_code ?? null,
      emailToken: data.subscription?.email_token ?? data.email_token ?? null,
      authorizationCode: data.authorization?.authorization_code ?? null
    });

    if (eventName === "charge.success" && data.reference && typeof data.amount === "number" && data.currency) {
      await recordBillingEvent(admin, {
        event_type: "payment_succeeded",
        source: "paystack_webhook",
        user_id: userId,
        subscription_plan: "mad_buddy_access",
        amount_minor: data.amount,
        currency: data.currency,
        transaction_reference: data.reference,
        provider_event_id: eventId,
        dedupe_key: `paystack:access_payment_succeeded:${data.reference}`
      });
    }
    return;
  }

  if (eventName === "invoice.payment_failed") {
    /* A failed renewal does NOT revoke access immediately. The resolver
       honours `grace_ends_at`, and the existing lifecycle already manages the
       grace window; marking past_due here would duplicate that and risk
       shortening it. The subscription simply stops renewing, and the period
       end does the rest. */
    await recordBillingEvent(admin, {
      event_type: "payment_failed",
      source: "paystack_webhook",
      user_id: userId,
      subscription_plan: "mad_buddy_access",
      amount_minor: typeof data.amount === "number" ? data.amount : null,
      currency: data.currency ?? MAD_BUDDY_ACCESS.currency,
      transaction_reference: data.reference ?? null,
      provider_event_id: eventId,
      dedupe_key: `paystack:access_payment_failed:${data.reference ?? eventId}`
    });
  }
}
