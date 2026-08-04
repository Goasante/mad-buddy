import { BillingPageContent } from "@/components/premium/billing-page";
import type { Metadata } from "next";

// Renders per-user billing/onboarding state; never statically prerender
// (build environments have no Supabase secrets).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Membership | Mad Buddy",
  description: "View your Mad Buddy membership, access, usage, and renewal details."
};

export default function BillingPage() {
  return <BillingPageContent />;
}
