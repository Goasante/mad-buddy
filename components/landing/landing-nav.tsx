import { getImageProps } from "next/image";
import Link from "next/link";
import { LandingMobileMenu } from "@/components/landing/landing-mobile-menu";
import { brandSymbol } from "@/lib/brand/assets";

const navItemClass =
  "focus-ring inline-flex min-h-11 items-center rounded-full px-3 py-2 text-sm font-semibold text-[#4E0401]/70 transition-colors hover:bg-[#E88C2B]/10 hover:text-[#4E0401] dark:text-[#FFF8F1]/70 dark:hover:bg-white/[0.06] dark:hover:text-[#FFF8F1]";

function LandingBrandMark() {
  const light = getImageProps({
    src: brandSymbol.light.src,
    alt: "",
    width: 32,
    height: 32
  }).props;
  const dark = getImageProps({
    src: brandSymbol.dark.src,
    alt: "",
    width: 32,
    height: 32
  }).props;

  return (
    <picture className="block h-8 w-8">
      <source media="(prefers-color-scheme: dark)" srcSet={dark.srcSet} />
      <img
        {...light}
        alt=""
        aria-hidden="true"
        className="h-8 w-8 object-contain"
      />
    </picture>
  );
}

/**
 * Server-rendered landing navigation.
 *
 * Only the hamburger menu hydrates. The desktop links, brand lockup and CTA
 * are static HTML so the public page does not ship scroll listeners or active
 * section state just to highlight navigation while somebody reads.
 *
 * The brand mark uses one <picture> rather than two CSS-swapped images. The
 * browser therefore requests only the artwork for the active colour scheme;
 * the hidden theme no longer leaves an unrequested lazy image in the DOM for
 * headless audits to misclassify as broken, and a 32px mark no longer exposes
 * a giant fallback optimiser URL from an unused element.
 */
export function LandingNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[#4E0401]/10 bg-[#FEFBF3]/90 pt-[env(safe-area-inset-top,0px)] backdrop-blur-xl dark:border-white/10 dark:bg-[#140B09]/90">
      <style>{`
        footer nav[aria-label="Footer navigation"] a,
        a[href="#main-content"]:focus {
          display: inline-flex;
          min-height: 44px;
          align-items: center;
        }

        footer nav[aria-label="Footer navigation"] a {
          padding-block: 0.625rem;
        }
      `}</style>
      <nav
        className="mx-auto flex h-[4.25rem] w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-10"
        aria-label="Main navigation"
      >
        <Link href="/" className="focus-ring inline-flex min-h-11 items-center gap-2.5 rounded-xl" aria-label="Mad Buddy home">
          <span className="relative grid h-8 w-8 shrink-0 place-items-center">
            <LandingBrandMark />
          </span>
          <span className="text-[15px] font-bold tracking-[-0.02em] text-[#4E0401] dark:text-[#FFF8F1]">Mad Buddy</span>
        </Link>

        <div className="hidden items-center gap-0.5 md:flex">
          <a className={navItemClass} href="#how-it-works">How it works</a>
          <a className={navItemClass} href="#connect">Muddies + Linkr</a>
          <a className={navItemClass} href="#privacy">Privacy</a>
          <Link className={navItemClass} href="/about">About</Link>
          <Link className={navItemClass} href="/pricing">Pricing</Link>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <Link
            href="/login"
            className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold text-[#4E0401]/70 transition-colors hover:bg-[#E88C2B]/10 hover:text-[#4E0401] dark:text-[#FFF8F1]/75 dark:hover:bg-white/[0.06] dark:hover:text-[#FFF8F1]"
          >
            Log in
          </Link>
          <Link
            href="/login"
            className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full bg-[#4E0401] px-5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(78,4,1,0.16)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(78,4,1,0.22)] active:translate-y-0 dark:bg-[#E88C2B] dark:text-[#2A120A]"
          >
            Get started
          </Link>
        </div>

        <LandingMobileMenu />
      </nav>
    </header>
  );
}
