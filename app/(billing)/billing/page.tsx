import { BillingPageContent } from "@/components/premium/billing-page";

// Renders per-user billing/onboarding state; never statically prerender
// (build environments have no Supabase secrets).
export const dynamic = "force-dynamic";

export default function BillingPage() {
  return <BillingPageContent />;
}
