import type { Metadata } from "next";
import { PricingPageContent } from "@/components/premium/pricing-page";

const description =
  "Mad Buddy is free to use with light ads. Mad Buddy Access is GHS 4.99/month and removes ads, while Linkr, UpFor and the core social experience remain available without a subscription.";

export const metadata: Metadata = {
  title: "Pricing",
  description,
  alternates: { canonical: "/pricing" },
  openGraph: { title: "Pricing | Mad Buddy", description, url: "/pricing" }
};

export default function PricingPage() {
  return <PricingPageContent />;
}