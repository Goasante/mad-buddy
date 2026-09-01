import type { Metadata } from "next";
import { PricingPageContent } from "@/components/premium/pricing-page";

const description =
  "Mad Buddy Core is free. Mad Buddy Access is GHS 5.00/month for Linkr and UpFor expansion, with 14 days of Welcome Access after your first Muddy.";

export const metadata: Metadata = {
  title: "Pricing",
  description,
  alternates: { canonical: "/pricing" },
  openGraph: { title: "Pricing | Mad Buddy", description, url: "/pricing" }
};

export default function PricingPage() {
  return <PricingPageContent />;
}
