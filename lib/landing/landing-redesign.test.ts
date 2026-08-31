import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const source = (path: string) => stripComments(read(path));

const rawLanding = read("components/landing/landing-page.tsx");
const rawNavigation = read("components/landing/landing-nav.tsx");
const rawPublicShell = read("components/front-door/public-shell.tsx");
const landing = stripComments(rawLanding);
const navigation = stripComments(rawNavigation);
const publicShell = stripComments(rawPublicShell);
const mobileMenu = source("components/landing/landing-mobile-menu.tsx");
const homePage = source("app/page.tsx");

const imageTags = [rawLanding, rawNavigation, rawPublicShell].flatMap((rawSource) => [
  ...(rawSource.match(/<Image\b[\s\S]*?\/>/g) ?? []),
  ...(rawSource.match(/<img\b[\s\S]*?>/g) ?? [])
]);
const eagerImageTags = imageTags.filter(
  (tag) => /\bpriority(?:\s|=|\/|>)/.test(tag) || /\bloading\s*=\s*["']eager["']/.test(tag)
);

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
    expect(navigation).toContain("<PublicHeader mobileMenu={<LandingMobileMenu />} />");
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

  it("has exactly one landing LCP image marked priority/eager", () => {
    expect(eagerImageTags).toHaveLength(1);
    expect(eagerImageTags[0]).toContain('src="/brand/mad-buddy-hero-mockup-v2.png"');
    expect(landing).not.toContain("BrandSymbol");
    expect(landing).not.toContain("BrandMark");
  });

  it("gives the hero responsive sizing and requests only the active nav mark theme", () => {
    expect(landing).toContain('(max-width: 639px) 92vw');
    expect(landing).toContain('(max-width: 1023px) 74vw');
    expect(publicShell).toContain("<picture");
    expect(publicShell).toContain('media="(prefers-color-scheme: dark)"');
    expect(publicShell).toContain("srcSet={brandSymbol.dark.src}");
    expect(publicShell).toContain("src={brandSymbol.light.src}");
    expect(publicShell).toContain('width="32"');
    expect(publicShell).toContain('height="32"');
    expect(publicShell).not.toContain("dark:hidden");
    expect(publicShell).not.toContain("dark:block");
  });

  it("routes both genuine acquisition CTAs to signup and uses the canonical footer", () => {
    expect((rawLanding.match(/href="\/signup"/g) ?? [])).toHaveLength(2);
    expect(landing).toContain("<PublicFooter />");
    expect(landing).not.toContain("function Footer()");
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
  it("keeps the skip link and >=44px visible interactive targets", () => {
    expect(landing).toContain('href="#main-content"');
    expect(landing).toContain('<main id="main-content">');
    expect(landing).toContain("min-h-12");
    expect(mobileMenu).toContain("min-h-11");
    expect(publicShell).toContain("inline-flex min-h-11 items-center");
    expect(publicShell).toContain('aria-label="Footer navigation"');
    expect(publicShell).toContain("min-h-11 min-w-11");
  });

  it("describes the real product in route metadata and structured data", () => {
    expect(homePage).toContain("WebApplication");
    expect(homePage).toContain("SocialNetworkingApplication");
    expect(homePage).toContain("without live maps, exact coordinates, exact distances, or location history");
    expect(homePage).toContain('alternates: { canonical: "/" }');
    expect(homePage).toContain('card: "summary_large_image"');
  });
});
