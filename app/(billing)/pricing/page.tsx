import type { Metadata } from "next";
import { PricingPageContent } from "@/components/premium/pricing-page";

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

export default function PricingPage() {
  return <PricingPageContent />;
}
