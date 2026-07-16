import type { Metadata } from "next";
import { PrivacyPolicyPage } from "@/components/legal/privacy-policy-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Mad Buddy handles account, proximity, location, and subscription information.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy Policy | Mad Buddy",
    description: "How Mad Buddy handles account, proximity, location, and subscription information.",
    url: "/privacy"
  }
};

export default function PrivacyPage() {
  return <PrivacyPolicyPage />;
}
