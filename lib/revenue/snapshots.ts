import "server-only";

import { paystackPlans } from "@/lib/paystack/config";
import {
  calculateSnapshotMovement,
  reconcileSnapshotMovement,
  type SnapshotMovementEvent,
  type SnapshotPrice
} from "@/lib/revenue/financial-intelligence";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, SubscriptionPlan } from "@/lib/supabase/database.types";
import { legacyTierOf } from "@/lib/supabase/database.types";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type SnapshotInsert = Database["public"]["Tables"]["financial_snapshots"]["Insert"];

const PRICES: SnapshotPrice[] = [
  { plan: "buddy_plus", amountMinor: paystackPlans.plus.amount, currency: paystackPlans.plus.currency.toUpperCase() },
  { plan: "buddy_pro", amountMinor: paystackPlans.pro.amount, currency: paystackPlans.pro.currency.toUpperCase() }
];

export async function captureDailyFinancialSnapshots(admin: Admin, at = new Date()) {
  const snapshotDate = at.toISOString().slice(0, 10);
  const nowIso = at.toISOString();
  const [{ count: totalUsers, error: profileError }, subscriptionResult, previousResult] = await Promise.all([
    admin.from("profiles").select("user_id", { count: "exact", head: true }).is("deleted_at", null),
    admin.rpc("get_revenue_subscription_snapshot", { p_now: nowIso }),
    admin
      .from("financial_snapshots")
      .select("snapshot_date, currency, ending_mrr_minor, captured_at")
      .lt("snapshot_date", snapshotDate)
      .order("snapshot_date", { ascending: false })
      .limit(50)
  ]);
  if (profileError) throw new Error(profileError.message);
  if (subscriptionResult.error) throw new Error(subscriptionResult.error.message);
  if (previousResult.error) throw new Error(previousResult.error.message);

  let plusUsers = 0;
  let proUsers = 0;
  for (const row of subscriptionResult.data ?? []) {
    if (row.effective_plan === "buddy_plus") plusUsers += Number(row.user_count);
    if (row.effective_plan === "buddy_pro") proUsers += Number(row.user_count);
  }
  const users = totalUsers ?? 0;
  const freeUsers = Math.max(0, users - plusUsers - proUsers);
  const counts: Record<Exclude<SubscriptionPlan, "free">, number> = {
    buddy_plus: plusUsers,
    buddy_pro: proUsers
  };
  const previousByCurrency = new Map<string, { snapshot_date: string; ending_mrr_minor: number; captured_at: string }>();
  for (const row of previousResult.data ?? []) {
    const currency = row.currency.toUpperCase();
    if (!previousByCurrency.has(currency)) previousByCurrency.set(currency, row);
  }

  const previousCaptureTimes = [...previousByCurrency.values()].map((row) => row.captured_at);
  const earliestPrevious = previousCaptureTimes.sort()[0] ?? null;
  const movementEvents = earliestPrevious
    ? await loadMovementEvents(admin, earliestPrevious, nowIso)
    : [];

  const currencies = [...new Set(PRICES.map((price) => price.currency))].sort();
  const capturedAt = nowIso;
  const rows: SnapshotInsert[] = currencies.map((currency) => {
    const previous = previousByCurrency.get(currency);
    const relevantEvents = previous
      ? movementEvents
          .filter((event) => event.occurredAt > previous.captured_at)
          .map(({ eventType, plan, previousPlan }) => ({ eventType, plan, previousPlan }))
      : [];
    const endingMrr = PRICES.filter((price) => price.currency === currency).reduce((sum, price) => sum + counts[price.plan] * price.amountMinor, 0);
    const reconciliation = previous
      ? reconcileSnapshotMovement(
          previous.ending_mrr_minor,
          endingMrr,
          calculateSnapshotMovement(relevantEvents, PRICES, currency)
        )
      : null;
    const movement = reconciliation?.movement ?? null;
    return {
      snapshot_date: snapshotDate,
      currency,
      active_free_users: freeUsers,
      buddy_plus_users: plusUsers,
      buddy_pro_users: proUsers,
      active_paid_subscriptions: plusUsers + proUsers,
      opening_mrr_minor: previous?.ending_mrr_minor ?? null,
      new_mrr_minor: movement?.newMrrMinor ?? null,
      expansion_mrr_minor: movement?.expansionMrrMinor ?? null,
      reactivation_mrr_minor: movement?.reactivationMrrMinor ?? null,
      contraction_mrr_minor: movement?.contractionMrrMinor ?? null,
      churned_mrr_minor: movement?.churnedMrrMinor ?? null,
      ending_mrr_minor: endingMrr,
      reconciliation_status: reconciliation?.status ?? "baseline",
      reconciliation_reason: reconciliation?.reason ?? (previous ? null : "opening_snapshot_unavailable"),
      reconciliation_difference_minor: reconciliation?.differenceMinor ?? null,
      captured_at: capturedAt,
      updated_at: capturedAt
    };
  });

  const { error } = await admin.from("financial_snapshots").upsert(rows, { onConflict: "snapshot_date,currency" });
  if (error) throw new Error(error.message);
  return rows;
}

async function loadMovementEvents(admin: Admin, afterIso: string, throughIso: string) {
  const [billingResult, changesResult] = await Promise.all([
    admin
      .from("billing_events")
      .select("event_type, subscription_plan, previous_plan, occurred_at")
      .gt("occurred_at", afterIso)
      .lte("occurred_at", throughIso)
      .in("event_type", ["subscription_activated", "subscription_cancelled", "subscription_expired", "plan_upgraded", "plan_downgraded"])
      .order("occurred_at", { ascending: true })
      .limit(5000),
    admin
      .from("subscription_changes")
      .select("change_type, from_plan, to_plan, applied_at, effective_at")
      .eq("status", "applied")
      .gt("applied_at", afterIso)
      .lte("applied_at", throughIso)
      .order("applied_at", { ascending: true })
      .limit(5000)
  ]);
  if (billingResult.error) throw new Error(billingResult.error.message);
  if (changesResult.error) throw new Error(changesResult.error.message);

  const events: Array<SnapshotMovementEvent & { occurredAt: string }> = (billingResult.data ?? []).map((row) => ({
    eventType: row.event_type,
    /* Ladder analytics: Access is off-ladder here. The real product stays recorded on the billing_events row. */
    plan: legacyTierOf(row.subscription_plan),
    previousPlan: row.previous_plan,
    occurredAt: row.occurred_at
  }));
  for (const row of changesResult.data ?? []) {
    const eventType =
      row.change_type === "upgrade"
        ? "plan_upgraded"
        : row.change_type === "downgrade"
          ? "plan_downgraded"
          : row.change_type === "cancel"
            ? "subscription_cancelled"
            : row.change_type === "reactivate"
              ? "subscription_reactivated"
              : null;
    const occurredAt = row.applied_at ?? row.effective_at;
    if (!eventType || !occurredAt) continue;
    events.push({ eventType, plan: row.to_plan, previousPlan: row.from_plan, occurredAt });
  }
  return events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}
