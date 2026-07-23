import { headers } from "next/headers";
import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { absoluteUrl } from "@/lib/seo";

const description =
  "Mad Buddy lets mutually approved friends know when they are nearby through privacy-safe glow signals, no maps, coordinates, or exact distances.";

export const metadata: Metadata = {
  title: "When your Muddies are close, they glow",
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title: "Mad Buddy | When your Muddies are close, they glow",
    description,
    url: "/",
    images: [{ url: "/brand/mad-buddy-logo-414.png", width: 414, height: 414, alt: "Mad Buddy" }]
  },
  twitter: {
    card: "summary_large_image",
    title: "Mad Buddy | When your Muddies are close, they glow",
    description,
    images: ["/brand/mad-buddy-logo-414.png"]
  }
};

export default async function HomePage() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${absoluteUrl("/")}#organization`,
        name: "Mad Buddy",
        url: absoluteUrl("/"),
        logo: absoluteUrl("/brand/mad-buddy-logo-414.png")
      },
      {
        "@type": "WebSite",
        "@id": `${absoluteUrl("/")}#website`,
        name: "Mad Buddy",
        url: absoluteUrl("/"),
        description,
        publisher: { "@id": `${absoluteUrl("/")}#organization` }
      }
    ]
  };

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <LandingPage />
    </>
  );
}
