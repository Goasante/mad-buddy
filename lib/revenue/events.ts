import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  BillingEventSource,
  BillingEventType,
  Database,
  SubscriptionPlan,
  SubscriptionStatus
} from "@/lib/supabase/database.types";
import { legacyTierOf } from "@/lib/supabase/database.types";
import { verifiedPaymentAmounts } from "@/lib/revenue/financial-intelligence";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type BillingInsert = Database["public"]["Tables"]["billing_events"]["Insert"];

export type SubscriptionSnapshot = {
  id: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
} | null;

export async function loadSubscriptionSnapshot(admin: Admin, userId: string): Promise<SubscriptionSnapshot> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("id, plan, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  /* NARROWED TO THE LADDER, deliberately.
   *
   * This snapshot feeds MRR movement (`upgrade` / `downgrade` / `churn`),
   * which is computed from a RANK over free < buddy_plus < buddy_pro. Mad
   * Buddy Access has no position in that ordering, and inventing one would
   * fabricate upgrade/downgrade events between products that are not on the
   * same scale.
   *
   * Access revenue is not lost -- `billing_events.subscription_plan` records
   * the real product, because that column is the enum and now carries
   * `mad_buddy_access`. Only this legacy MRR-movement view treats it as
   * off-ladder. */
  return { ...data, plan: legacyTierOf(data.plan) };
}

/**
 * Append a canonical billing fact. Duplicate delivery is success: the unique
 * dedupe key is the protection boundary shared by webhook and return-URL sync.
 */
export async function recordBillingEvent(admin: Admin, event: BillingInsert): Promise<boolean> {
  const { error } = await admin.from("billing_events").insert(event);
  if (!error) return true;
  if (error.code === "23505") {
    // A webhook and the verified return page may race. The first delivery owns
    // the immutable financial fact; a later verified response may only enrich
    // a previously unavailable Paystack fee for that same dedupe key.
    if (
      event.event_type === "payment_succeeded" &&
      event.fee_status === "verified" &&
      event.provider_fee_minor !== null &&
      event.provider_fee_minor !== undefined &&
      event.net_amount_minor !== null &&
      event.net_amount_minor !== undefined
    ) {
      const { error: enrichmentError } = await admin
        .from("billing_events")
        .update({
          provider_fee_minor: event.provider_fee_minor,
          net_amount_minor: event.net_amount_minor,
          fee_status: "verified"
        })
        .eq("dedupe_key", event.dedupe_key)
        .eq("fee_status", "unavailable");
      if (enrichmentError) throw new Error(enrichmentError.message);
    }
    return true;
  }
  throw new Error(error.message);
}

export async function recordSuccessfulPayment(
  admin: Admin,
  input: {
    userId: string;
    plan: Exclude<SubscriptionPlan, "free">;
    previous: SubscriptionSnapshot;
    source: Extract<BillingEventSource, "paystack_webhook" | "paystack_verify">;
    reference: string;
    providerEventId?: string | null;
    amountMinor: number;
    providerFeeMinor?: number | null;
    currency: string;
    paidAt?: string | null;
    subscriptionId?: string | null;
  }
) {
  const occurredAt = validDate(input.paidAt) ?? new Date().toISOString();
  const { data: existingReferenceEvents, error: existingError } = await admin
    .from("billing_events")
    .select("event_type")
    .eq("provider", "paystack")
    .eq("transaction_reference", input.reference)
    .in("event_type", ["subscription_activated", "subscription_renewed", "payment_recovered", "plan_upgraded", "plan_downgraded"]);
  if (existingError) throw new Error(existingError.message);
  const existingTypes = new Set((existingReferenceEvents ?? []).map((event) => event.event_type));
  const base = {
    source: input.source,
    provider: "paystack",
    user_id: input.userId,
    subscription_id: input.subscriptionId ?? input.previous?.id ?? null,
    subscription_plan: input.plan,
    previous_plan: input.previous?.plan ?? "free",
    amount_minor: input.amountMinor,
    currency: input.currency.toUpperCase(),
    transaction_reference: input.reference,
    provider_event_id: input.providerEventId ?? null,
    occurred_at: occurredAt
  } satisfies Omit<BillingInsert, "event_type" | "dedupe_key">;

  await recordBillingEvent(admin, {
    ...base,
    ...verifiedFeeFields(input.amountMinor, input.providerFeeMinor),
    event_type: "payment_succeeded",
    dedupe_key: `paystack:payment_succeeded:${input.reference}`
  });

  const hasLifecycle = existingTypes.has("subscription_activated") || existingTypes.has("subscription_renewed");
  if (!hasLifecycle) {
    const wasPaid = Boolean(input.previous && input.previous.plan !== "free" && input.previous.status !== "cancelled" && input.previous.status !== "expired");
    await recordBillingEvent(admin, {
      ...base,
      event_type: wasPaid ? "subscription_renewed" : "subscription_activated",
      amount_minor: null,
      dedupe_key: `paystack:${wasPaid ? "subscription_renewed" : "subscription_activated"}:${input.reference}`
    });
  }

  if (input.previous?.status === "past_due" || input.previous?.status === "attention") {
    await recordBillingEvent(admin, {
      ...base,
      event_type: "payment_recovered",
      amount_minor: null,
      dedupe_key: `paystack:payment_recovered:${input.reference}`
    });
  }

  if (input.previous && input.previous.plan !== input.plan && input.previous.plan !== "free") {
    const rank: Record<SubscriptionPlan, number> = { free: 0, buddy_plus: 1, buddy_pro: 2 };
    const eventType: BillingEventType = rank[input.plan] > rank[input.previous.plan] ? "plan_upgraded" : "plan_downgraded";
    await recordBillingEvent(admin, {
      ...base,
      event_type: eventType,
      amount_minor: null,
      dedupe_key: `paystack:${eventType}:${input.reference}`
    });
  }
}

function verifiedFeeFields(amountMinor: number, providerFeeMinor: number | null | undefined) {
  const verified = verifiedPaymentAmounts(amountMinor, providerFeeMinor);
  return {
    provider_fee_minor: verified.providerFeeMinor,
    net_amount_minor: verified.netAmountMinor,
    fee_status: verified.feeStatus
  };
}

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
