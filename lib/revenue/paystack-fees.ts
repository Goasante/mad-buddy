import "server-only";

import { paystackRequest, type PaystackVerifiedTransaction } from "@/lib/paystack/client";
import { verifiedPaymentAmounts } from "@/lib/revenue/financial-intelligence";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Bounded reconciliation for successful charges whose webhook did not carry a
 * fee. Every value is re-read from Paystack and matched against the trusted
 * ledger before enrichment. Missing or inconsistent data stays unavailable.
 */
export async function reconcileMissingPaystackFees(admin: Admin, limit = 50) {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const { data: rows, error } = await admin
    .from("billing_events")
    .select("id, transaction_reference, amount_minor, currency")
    .eq("event_type", "payment_succeeded")
    .eq("provider", "paystack")
    .eq("fee_status", "unavailable")
    .not("transaction_reference", "is", null)
    .order("occurred_at", { ascending: true })
    .limit(safeLimit);
  if (error) throw new Error(error.message);

  let reconciled = 0;
  for (const row of rows ?? []) {
    if (!row.transaction_reference || row.amount_minor === null || !row.currency) continue;
    try {
      const transaction = await paystackRequest<PaystackVerifiedTransaction>(
        `/transaction/verify/${encodeURIComponent(row.transaction_reference)}`
      );
      if (
        transaction.status !== "success" ||
        transaction.reference !== row.transaction_reference ||
        transaction.amount !== row.amount_minor ||
        transaction.currency.toUpperCase() !== row.currency.toUpperCase()
      ) {
        continue;
      }
      const verified = verifiedPaymentAmounts(transaction.amount, transaction.fees);
      if (verified.feeStatus !== "verified") continue;
      const { data: updated, error: updateError } = await admin
        .from("billing_events")
        .update({
          provider_fee_minor: verified.providerFeeMinor,
          net_amount_minor: verified.netAmountMinor,
          fee_status: verified.feeStatus
        })
        .eq("id", row.id)
        .eq("fee_status", "unavailable")
        .select("id");
      if (updateError) throw new Error(updateError.message);
      reconciled += updated?.length ?? 0;
    } catch {
      // Keep the row unavailable. The next bounded scheduled run can retry;
      // one provider failure must not discard already reconciled rows.
    }
  }
  return reconciled;
}
