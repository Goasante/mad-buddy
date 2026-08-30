import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const source = (path: string) => stripComments(read(path));

const landing = source("components/landing/landing-page.tsx");
const navigation = source("components/landing/landing-nav.tsx");
const mobileMenu = source("components/landing/landing-mobile-menu.tsx");
const homePage = source("app/page.tsx");

describe("landing rendering architecture", () => {
  it("keeps the marketing body server-rendered", () => {
    expect(landing).not.toContain('"use client"');
    expect(landing).not.toContain("useEffect(");
    expect(landing).not.toContain("IntersectionObserver");
    expect(landing).not.toContain("document.documentElement");
  });

  it("keeps the desktop navigation server-rendered and isolates the mobile menu", () => {
    expect(navigation).not.toContain('"use client"');
    expect(navigation).toContain("<LandingMobileMenu />");
    expect(mobileMenu).toContain('"use client"');
    expect(mobileMenu).toContain('event.key === "Escape"');
    expect(mobileMenu).toContain('event.key !== "Tab"');
  });

  it("does not reintroduce page-wide scroll tracking or snapping", () => {
    expect(landing).not.toContain("landing-snap");
    expect(landing).not.toContain("landing-section");
    expect(landing).not.toContain("landing-reveal");
    expect(navigation).not.toContain('addEventListener("scroll"');
    expect(navigation).not.toContain('addEventListener("resize"');
  });
});

describe("landing visual and image contract", () => {
  it("keeps the real brand palette and rejects a purple landing identity", () => {
    expect(landing).toContain("#E88C2B");
    expect(landing).toContain("#4E0401");
    expect(landing).toContain("#FEFBF3");
    expect(landing).not.toMatch(/purple|violet/i);
    expect(navigation).not.toMatch(/purple|violet/i);
  });

  it("has one LCP-priority image and no footer image payload", () => {
    expect((landing.match(/\bpriority\b/g) ?? []).length).toBe(1);
    expect(navigation).not.toContain("priority");
    expect(landing).toContain('src="/brand/mad-buddy-hero-mockup-v2.png"');
    expect(landing).not.toContain("BrandSymbol");
    expect(landing).not.toContain("BrandMark");
  });

  it("gives the hero responsive image sizing instead of a generic viewport width", () => {
    expect(landing).toContain('(max-width: 639px) 92vw');
    expect(landing).toContain('(max-width: 1023px) 74vw');
    expect(navigation).toContain('sizes="32px"');
  });
});

describe("landing product story", () => {
  it("keeps the brand promise and tells the real connection model", () => {
    expect(landing).toContain("When your Muddies are close");
    expect(landing).toContain("Muddies");
    expect(landing).toContain("Linkr");
    expect(landing).toContain("UpFor");
    expect(landing).toContain("Safe Arrival");
  });

  it("states the privacy boundary as a product capability", () => {
    for (const statement of [
      "Exact GPS coordinates",
      "A live map or map pin",
      "Exact numerical distance",
      "Location history"
    ]) {
      expect(landing).toContain(statement);
    }
    expect(landing).toContain("Ghost Mode");
  });

  it("keeps the page focused instead of restoring the old feature wall", () => {
    expect(landing).not.toContain("function FeatureSection");
    expect(landing).not.toContain('id="features"');
    expect(landing).toContain("function FeelingSection");
    expect(landing).toContain("function ConnectionSection");
    expect(landing).toContain("function MomentumSection");
    expect(landing).toContain("function PrivacySection");
  });
});

describe("landing accessibility and discovery", () => {
  it("keeps a skip link, semantic main, and full-size primary touch targets", () => {
    expect(landing).toContain('href="#main-content"');
    expect(landing).toContain('<main id="main-content">');
    expect(landing).toContain("min-h-12");
    expect(mobileMenu).toContain("min-h-11");
  });

  it("describes the real product in route metadata and structured data", () => {
    expect(homePage).toContain("WebApplication");
    expect(homePage).toContain("SocialNetworkingApplication");
    expect(homePage).toContain("without live maps, exact coordinates, exact distances, or location history");
    expect(homePage).toContain('alternates: { canonical: "/" }');
    expect(homePage).toContain('card: "summary_large_image"');
  });
});
