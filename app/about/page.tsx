import type { Metadata } from "next";
import { AboutPage } from "@/components/legal/about-page";

/**
 * Describes what the product actually does now.
 *
 * The previous description said Mad Buddy helps "friends discover each other
 * nearby", which stopped being the whole story when Linkr shipped -- it also
 * introduces people who are not yet Muddies.
 */
const description =
  "What Mad Buddy is, how we expect people to use it, and the privacy and safety controls behind it.";

export const metadata: Metadata = {
  title: "About",
  description,
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About | Mad Buddy",
    description,
    url: "/about"
  }
};

export default function AboutRoute() {
  return <AboutPage />;
}
