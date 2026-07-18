import type { Metadata } from "next";
import { FaqPage } from "@/components/legal/faq-page";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Common questions about how Mad Buddy keeps proximity private, mutual, and on your terms.",
  alternates: { canonical: "/faq" },
  openGraph: {
    title: "FAQ | Mad Buddy",
    description: "Common questions about how Mad Buddy keeps proximity private, mutual, and on your terms.",
    url: "/faq"
  }
};

export default function FaqRoute() {
  return <FaqPage />;
}
