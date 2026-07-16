import { SubscriptionResultPage } from "@/components/premium/subscription-result-page";

// Renders per-user billing/onboarding state; never statically prerender
// (build environments have no Supabase secrets).
export const dynamic = "force-dynamic";

export default function SubscriptionCancelledPage() {
  return <SubscriptionResultPage type="cancelled" />;
}
