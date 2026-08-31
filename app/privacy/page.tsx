import type { Metadata } from "next";
import { PublicPageShell } from "@/components/front-door/public-shell";
import { PrivacyPolicyPage } from "@/components/legal/privacy-policy-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Mad Buddy handles account, proximity, location, Linkr discovery, and subscription information.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy Policy | Mad Buddy",
    description: "How Mad Buddy handles account, proximity, location, Linkr discovery, and subscription information.",
    url: "/privacy"
  }
};

export default function PrivacyPage() {
  return (
    <PublicPageShell>
      <PrivacyPolicyPage />
    </PublicPageShell>
  );
}
