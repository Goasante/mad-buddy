"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

const mobileLinks = [
  { href: "#how-it-works", label: "How it works", kind: "anchor" as const },
  { href: "#connect", label: "Muddies + Linkr", kind: "anchor" as const },
  { href: "#privacy", label: "Privacy", kind: "anchor" as const },
  { href: "/about", label: "About", kind: "route" as const },
  { href: "/pricing", label: "Pricing", kind: "route" as const },
  { href: "/faq", label: "FAQ", kind: "route" as const }
] as const;

/**
 * The landing page's only client-side interaction island.
 *
 * Everything outside this menu is server-rendered marketing content. Keeping
 * focus trapping, Escape handling and body-scroll locking here means the
 * landing page no longer hydrates merely to track scroll position or reveal
 * static sections.
 */
export function LandingMobileMenu() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    const focusable = panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    focusable?.[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  return (
    <div className="md:hidden">
      <button
        ref={triggerRef}
        type="button"
        className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#4E0401]/10 bg-white/45 text-[#4E0401] transition-colors hover:bg-white/75 dark:border-white/10 dark:bg-white/[0.04] dark:text-[#FFF8F1] dark:hover:bg-white/[0.08]"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
      </button>

      {open ? (
        <div className="fixed inset-0 z-40 bg-[#24120E]/28 pt-[calc(env(safe-area-inset-top,0px)+4.25rem)] backdrop-blur-[2px]" onMouseDown={() => close(false)}>
          <div
            id={menuId}
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="border-t border-[#4E0401]/10 bg-[#FEFBF3] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-4 shadow-[0_24px_70px_rgba(78,4,1,0.16)] dark:border-white/10 dark:bg-[#140B09]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <nav className="grid gap-1" aria-label="Mobile landing navigation">
              {mobileLinks.map((item) =>
                item.kind === "anchor" ? (
                  <a
                    key={item.href}
                    href={item.href}
                    className="focus-ring min-h-11 rounded-xl px-3 py-3 text-base font-semibold text-[#4E0401] hover:bg-[#E88C2B]/10 dark:text-[#FFF8F1]"
                    onClick={() => close(false)}
                  >
                    {item.label}
                  </a>
                ) : (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="focus-ring min-h-11 rounded-xl px-3 py-3 text-base font-semibold text-[#4E0401] hover:bg-[#E88C2B]/10 dark:text-[#FFF8F1]"
                    onClick={() => close(false)}
                  >
                    {item.label}
                  </Link>
                )
              )}
            </nav>
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[#4E0401]/10 pt-4 dark:border-white/10">
              <Link
                href="/login"
                className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full border border-[#4E0401]/15 bg-white/65 px-4 text-sm font-semibold text-[#4E0401] dark:border-white/15 dark:bg-white/[0.05] dark:text-[#FFF8F1]"
                onClick={() => close(false)}
              >
                Log in
              </Link>
              <Link
                href="/login"
                className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full bg-[#4E0401] px-4 text-sm font-semibold text-white shadow-sm transition-transform active:scale-[0.98] dark:bg-[#E88C2B] dark:text-[#2A120A]"
                onClick={() => close(false)}
              >
                Get started
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
