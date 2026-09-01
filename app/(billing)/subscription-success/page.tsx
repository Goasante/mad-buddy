import { SubscriptionResultPage } from "@/components/premium/subscription-result-page";

export const dynamic = "force-dynamic";

/**
 * Compatibility callback for historical Paystack return URLs.
 *
 * Verification is webhook/server-authority work. This page deliberately does
 * not run the retired Plus/Pro synchronisation path and cannot activate a
 * ladder tier from query-string data.
 */
export default function SubscriptionSuccessPage() {
  return (
    <SubscriptionResultPage
      type="success"
      message="Payment returned to Mad Buddy. Your Access status is updated only from verified server-side payment events."
    />
  );
}
