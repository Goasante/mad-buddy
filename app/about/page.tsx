import type { Metadata } from "next";
import { AboutPage } from "@/components/legal/about-page";

export const metadata: Metadata = {
  title: "About Us",
  description: "Mad Buddy's mission: help friends discover each other nearby and turn digital connection into real life.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About Us | Mad Buddy",
    description: "Mad Buddy's mission: help friends discover each other nearby and turn digital connection into real life.",
    url: "/about"
  }
};

export default function AboutRoute() {
  return <AboutPage />;
}
