import { createHash, createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { GRACE_PERIOD_DAYS } from "@/lib/billing/entitlements";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { markPaystackSubscriptionStatus, syncPaystackSubscription } from "@/lib/paystack/sync";
import { getMissingPaystackWebhookConfig, getPaystackWebhookSecret } from "@/lib/paystack/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit, getClientIpHashFromRequest } from "@/lib/security/rate-limit";

const MAX_WEBHOOK_BYTES = 256 * 1024;

type PaystackWebhookEvent = {
  event: string;
  data: {
    id?: number | string;
    reference?: string;
    status?: string;
    paid_at?: string | null;
    amount?: number;
    currency?: string;
    metadata?: {
      user_id?: string;
      plan?: "plus" | "pro";
      app_plan?: "buddy_plus" | "buddy_pro";
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
    await handlePaystackEvent(event);
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

async function handlePaystackEvent(event: PaystackWebhookEvent) {
  const admin = createSupabaseAdminClient();
  const data = event.data;
  const userId = data.metadata?.user_id;

  switch (event.event) {
    case "charge.success":
    case "subscription.create":
    case "subscription.enable":
    case "invoice.update": {
      if (!userId) {
        return;
      }

      await syncPaystackSubscription(admin, {
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
      });
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
      return;
    }
    case "subscription.disable": {
      await markPaystackSubscriptionStatus(
        admin,
        data.subscription_code ?? data.subscription?.subscription_code,
        "cancelled",
        { graceEndsAt: null }
      );
      return;
    }
    case "invoice.payment_failed": {
      // Failed renewal starts the grace window (§61): paid features survive
      // until grace_ends_at, then effectivePlan falls back to free (§62).
      await markPaystackSubscriptionStatus(
        admin,
        data.subscription_code ?? data.subscription?.subscription_code,
        "past_due",
        { graceEndsAt: new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString() }
      );
      return;
    }
    default:
      return;
  }
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
