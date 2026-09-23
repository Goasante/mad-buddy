import { headers } from "next/headers";
import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { absoluteUrl } from "@/lib/seo";

const description =
  "Mad Buddy is a free social app for privacy-safe proximity, Linkr discovery, UpFor, plans and messaging. Light ads support the free experience, and Mad Buddy Access removes ads, without live maps, exact coordinates, precise measured distances, or location history.";

export const metadata: Metadata = {
  title: "When your Muddies are close, they glow",
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title: "Mad Buddy | When your Muddies are close, they glow",
    description,
    url: "/",
    siteName: "Mad Buddy",
    type: "website",
    images: [{ url: "/brand/mad-buddy-social-share.jpg", width: 1200, height: 630, alt: "Mad Buddy" }]
  },
  twitter: {
    card: "summary_large_image",
    title: "Mad Buddy | When your Muddies are close, they glow",
    description,
    images: ["/brand/mad-buddy-social-share.jpg"]
  }
};

export default async function HomePage() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const organizationId = `${absoluteUrl("/")}#organization`;
  const websiteId = `${absoluteUrl("/")}#website`;
  const applicationId = `${absoluteUrl("/")}#application`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: "Mad Buddy",
        url: absoluteUrl("/"),
        logo: absoluteUrl("/brand/mad-buddy-mark-light.png")
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        name: "Mad Buddy",
        url: absoluteUrl("/"),
        description,
        publisher: { "@id": organizationId }
      },
      {
        "@type": "WebApplication",
        "@id": applicationId,
        name: "Mad Buddy",
        url: absoluteUrl("/"),
        applicationCategory: "SocialNetworkingApplication",
        operatingSystem: "Web",
        description,
        publisher: { "@id": organizationId }
      }
    ]
  };

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <LandingPage />
    </>
  );
}
