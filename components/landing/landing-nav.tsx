"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const sectionIds = ["how-it-works", "features", "safety"] as const;

type LandingNavProps = {
  activeSection: string | null;
  onSectionChange: (section: string | null) => void;
};

export function LandingNav({ activeSection, onSectionChange }: LandingNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobilePanelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobile();
        return;
      }

      if (event.key !== "Tab" || !mobilePanelRef.current) return;

      const focusable = mobilePanelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const firstLink = mobilePanelRef.current?.querySelector<HTMLElement>("a, button");
    firstLink?.focus();

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen, closeMobile]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-md">
      <nav
        className="mx-auto flex h-[4.25rem] max-w-6xl items-center justify-between gap-3 px-4 sm:h-[4.5rem] sm:px-6"
        aria-label="Main navigation"
      >
        <Link
          href="/"
          className="focus-ring flex items-center gap-3 rounded-lg font-semibold"
          aria-label="Mad Buddy home"
          onClick={() => onSectionChange(null)}
        >
          <BrandMark className="h-9 w-9" priority />
          <span>Mad Buddy</span>
        </Link>

        <div className="hidden items-center gap-1 text-sm font-medium text-muted-foreground md:flex">
          <NavAnchor
            href="#how-it-works"
            isActive={activeSection === "how-it-works"}
            onClick={() => onSectionChange("how-it-works")}
          >
            How it works
          </NavAnchor>
          <NavAnchor
            href="#safety"
            isActive={activeSection === "safety"}
            onClick={() => onSectionChange("safety")}
          >
            Privacy
          </NavAnchor>
          <Link
            className={navLinkClass(false)}
            href="/pricing"
            onClick={() => onSectionChange(null)}
          >
            Pricing
          </Link>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <Button asChild size="sm" variant="ghost">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">Get started</Link>
          </Button>
        </div>

        <button
          ref={menuButtonRef}
          type="button"
          className="focus-ring safe-motion inline-flex h-10 w-10 items-center justify-center rounded-full border border-transparent text-foreground hover:bg-secondary md:hidden"
          aria-expanded={mobileOpen}
          aria-controls={menuId}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </nav>

      {mobileOpen ? (
        <div
          id={menuId}
          ref={mobilePanelRef}
          className="border-t border-border/70 bg-background px-4 py-4 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation"
        >
          <div className="flex flex-col gap-1">
            <MobileNavLink href="#how-it-works" onNavigate={closeMobile}>
              How it works
            </MobileNavLink>
            <MobileNavLink href="#safety" onNavigate={closeMobile}>
              Privacy
            </MobileNavLink>
            <MobileNavLink href="/faq" onNavigate={closeMobile}>
              FAQ
            </MobileNavLink>
            <MobileNavLink href="/pricing" onNavigate={closeMobile}>
              Pricing
            </MobileNavLink>
            <MobileNavLink href="/login" onNavigate={closeMobile}>
              Log in
            </MobileNavLink>
          </div>
          <Button asChild className="mt-4 w-full" size="lg">
            <Link href="/signup" onClick={closeMobile}>
              Get started
            </Link>
          </Button>
        </div>
      ) : null}
    </header>
  );
}

export function useLandingActiveSection() {
  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    const syncSectionFromHash = () => {
      const section = window.location.hash.slice(1);
      setActiveSection(sectionIds.includes(section as (typeof sectionIds)[number]) ? section : null);
    };

    const syncSectionFromScroll = () => {
      const headerBottom = window.innerWidth >= 640 ? 72 : 68;
      let currentSection: string | null = null;

      for (const sectionId of sectionIds) {
        const section = document.getElementById(sectionId);
        if (section && section.getBoundingClientRect().top <= headerBottom) {
          currentSection = sectionId;
        }
      }

      setActiveSection(currentSection);
    };

    let animationFrame = 0;
    const scheduleScrollSync = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(syncSectionFromScroll);
    };

    syncSectionFromHash();
    window.addEventListener("hashchange", syncSectionFromHash);
    window.addEventListener("scroll", scheduleScrollSync, { passive: true });
    window.addEventListener("resize", scheduleScrollSync);
    scheduleScrollSync();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("hashchange", syncSectionFromHash);
      window.removeEventListener("scroll", scheduleScrollSync);
      window.removeEventListener("resize", scheduleScrollSync);
    };
  }, []);

  return [activeSection, setActiveSection] as const;
}

function NavAnchor({
  href,
  isActive,
  onClick,
  children
}: {
  href: string;
  isActive: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <a
      className={navLinkClass(isActive)}
      href={href}
      aria-current={isActive ? "location" : undefined}
      onClick={onClick}
    >
      {children}
    </a>
  );
}

function MobileNavLink({
  href,
  onNavigate,
  children
}: {
  href: `#${string}` | "/pricing" | "/faq" | "/login" | "/signup";
  onNavigate: () => void;
  children: ReactNode;
}) {
  if (href.startsWith("/")) {
    return (
      <Link href={href} className={mobileLinkClass} onClick={onNavigate}>
        {children}
      </Link>
    );
  }

  return (
    <a href={href} className={mobileLinkClass} onClick={onNavigate}>
      {children}
    </a>
  );
}

function navLinkClass(isActive: boolean) {
  return cn(
    "focus-ring rounded-full px-3 py-2 transition-[color,background-color] duration-200 motion-reduce:transition-none",
    isActive
      ? "bg-secondary text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]"
      : "hover:bg-secondary/70 hover:text-foreground"
  );
}

const mobileLinkClass =
  "focus-ring rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-secondary";
