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
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${absoluteUrl("/")}#organization`,
        name: "Mad Buddy",
        url: absoluteUrl("/"),
        logo: absoluteUrl("/brand/mad-buddy-mark-light.png")
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
      {/* suppressHydrationWarning: CSP nonce-hiding, the same browser behaviour
          documented on the theme script in app/layout.tsx. The user agent empties
          the `nonce` content attribute once the document has loaded, so React's
          hydration comparison sees `nonce=""` where the server sent a real value.
          Nothing is mismatched; the attribute was deliberately hidden by the
          browser. Scoped to this element so real mismatches still surface. */}
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
