import type { Metadata } from "next";
import { PricingPageContent } from "@/components/premium/pricing-page";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const description = "Compare Mad Buddy Free, Buddy Plus, and Buddy Pro plans.";

export const metadata: Metadata = {
  title: "Pricing",
  description,
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing | Mad Buddy",
    description,
    url: "/pricing"
  }
};

export default async function PricingPage() {
  const env = getSupabaseServerEnv();
  const user = env.url
    ? (await (await createSupabaseServerClient()).auth.getUser()).data.user
    : null;

  return <PricingPageContent showTrialOffer={Boolean(user)} />;
}
