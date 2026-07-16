import { SubscriptionResultPage } from "@/components/premium/subscription-result-page";
import { paystackRequest, type PaystackVerifiedTransaction } from "@/lib/paystack/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { syncPaystackSubscription } from "@/lib/paystack/sync";

type SubscriptionSuccessPageProps = {
  searchParams: Promise<{ reference?: string; trxref?: string; provider?: string }>;
};

export default async function SubscriptionSuccessPage({ searchParams }: SubscriptionSuccessPageProps) {
  const params = await searchParams;
  const reference = params.reference ?? params.trxref;

  if (!reference || params.provider !== "paystack") {
    return <SubscriptionResultPage type="success" />;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <SubscriptionResultPage
        type="success"
        message="Payment received. Log in again so Mad Buddy can refresh your subscription status."
      />
    );
  }

  let verified = false;
  let message: string | undefined;

  try {
    const transaction = await paystackRequest<PaystackVerifiedTransaction>(
      `/transaction/verify/${encodeURIComponent(reference)}`
    );
    const metadataUserId = transaction.metadata?.user_id;

    if (transaction.status !== "success" || metadataUserId !== user.id) {
      message = "Payment returned from Paystack, but it could not be verified for this account yet.";
    } else {
      const admin = createSupabaseAdminClient();
      const paystackPlan =
        typeof transaction.plan === "string" ? transaction.plan : transaction.plan?.plan_code ?? null;

      await syncPaystackSubscription(admin, {
        userId: user.id,
        plan: transaction.metadata?.plan ?? null,
        status: transaction.status,
        reference: transaction.reference,
        paidAt: transaction.paid_at ?? null,
        amount: transaction.amount,
        customer: transaction.customer ?? null,
        authorization: transaction.authorization ?? null,
        planCode: paystackPlan
      });
      verified = true;
    }
  } catch {
    message =
      "Payment returned from Paystack. We could not verify it immediately, so the webhook will finish syncing your plan.";
  }

  return <SubscriptionResultPage type="success" verified={verified} message={message} />;
}
