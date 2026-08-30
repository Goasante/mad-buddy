import Link from "next/link";
import type { ReactNode } from "react";
import { BrandSymbol } from "@/components/brand/brand-symbol";
import { PublicMobileMenu } from "@/components/front-door/public-mobile-menu";
import { brandSymbol } from "@/lib/brand/assets";

const navItemClass =
  "focus-ring inline-flex min-h-11 items-center rounded-full px-3 py-2 text-sm font-semibold text-[#4E0401]/70 transition-colors hover:bg-[#E88C2B]/10 hover:text-[#4E0401] dark:text-[#FFF8F1]/70 dark:hover:bg-white/[0.06] dark:hover:text-[#FFF8F1]";

function PublicBrandSymbol() {
  return (
    <picture className="block h-8 w-8">
      <source media="(prefers-color-scheme: dark)" srcSet={brandSymbol.dark.src} />
      <img
        src={brandSymbol.light.src}
        alt=""
        width="32"
        height="32"
        loading="lazy"
        aria-hidden="true"
        className="h-8 w-8 object-contain"
      />
    </picture>
  );
}

export function PublicHeader({
  mobileMenu
}: {
  mobileMenu?: ReactNode;
} = {}) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[#4E0401]/10 bg-[#FEFBF3]/90 pt-[env(safe-area-inset-top,0px)] backdrop-blur-xl dark:border-white/10 dark:bg-[#140B09]/90">
      <nav
        className="mx-auto flex h-[4.25rem] w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-10"
        aria-label="Main navigation"
      >
        <Link href="/" className="focus-ring inline-flex min-h-11 items-center gap-2.5 rounded-xl" aria-label="Mad Buddy home">
          <PublicBrandSymbol />
          <span className="text-[15px] font-bold tracking-[-0.02em] text-[#4E0401] dark:text-[#FFF8F1]">Mad Buddy</span>
        </Link>

        <div className="hidden items-center gap-0.5 md:flex">
          <Link className={navItemClass} href="/#how-it-works">How it works</Link>
          <Link className={navItemClass} href="/#connect">Muddies + Linkr</Link>
          <Link className={navItemClass} href="/safety">Safety</Link>
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
            href="/signup"
            className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full bg-[#4E0401] px-5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(78,4,1,0.16)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(78,4,1,0.22)] active:translate-y-0 dark:bg-[#E88C2B] dark:text-[#2A120A]"
          >
            Get started
          </Link>
        </div>

        {mobileMenu ?? <PublicMobileMenu />}
      </nav>
    </header>
  );
}

const footerLinks = [
  { href: "/about", label: "About" },
  { href: "/safety", label: "Safety" },
  { href: "/faq", label: "FAQ" },
  { href: "/support", label: "Support" },
  { href: "/pricing", label: "Pricing" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" }
] as const;

export function PublicFooter() {
  return (
    <footer className="border-t border-[#4E0401]/10 bg-[#FEFBF3] pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-8 text-[#4E0401] dark:border-white/10 dark:bg-[#100807] dark:text-[#FFF8F1]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-7 px-4 sm:px-6 lg:px-10">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <Link href="/" className="focus-ring inline-flex min-h-11 w-fit items-center gap-2.5 rounded-xl font-semibold">
            <BrandSymbol className="h-7 w-7" />
            Mad Buddy
          </Link>
          <nav className="flex flex-wrap gap-x-1 gap-y-1" aria-label="Footer navigation">
            {footerLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-[#4E0401]/60 transition-colors hover:bg-[#E88C2B]/10 hover:text-[#4E0401] dark:text-[#FFF8F1]/60 dark:hover:bg-white/[0.05] dark:hover:text-[#FFF8F1]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex flex-col gap-2 border-t border-[#4E0401]/10 pt-5 text-xs leading-5 text-[#4E0401]/50 sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:text-[#FFF8F1]/50">
          <p>© {new Date().getFullYear()} Mad Buddy.</p>
          <p>Privacy-safe proximity. No exact-location reveal in the ordinary social experience.</p>
        </div>
      </div>
    </footer>
  );
}

export function PublicPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#FEFBF3] text-[#311712] selection:bg-[#E88C2B]/25 selection:text-[#4E0401] dark:bg-[#100807] dark:text-[#FFF8F1]">
      <a
        href="#main-content"
        className="focus-ring sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-[#FEFBF3] focus:px-4 focus:py-2 focus:text-[#4E0401] focus:shadow-lg dark:focus:bg-[#1B0E0B] dark:focus:text-[#FFF8F1]"
      >
        Skip to content
      </a>
      <PublicHeader />
      <main id="main-content" className="pt-[calc(env(safe-area-inset-top,0px)+4.25rem)]">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
