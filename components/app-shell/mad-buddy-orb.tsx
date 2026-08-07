"use client";

import Link from "next/link";
import type { Route } from "next";
import { HomeMarkIcon } from "@/components/brand/brand-icons";
import { cn } from "@/lib/utils";

/**
 * The Mad Buddy Orb: the centre of the bottom navigation and Home.
 *
 * Not an icon and not an action button — it carries no glyph at all. The
 * identity is light and motion: a warm core, a soft outer glow, and a slow
 * breath every few seconds. Everything visual lives in CSS (see the
 * `.mb-orb` rules in globals.css) so there is no JavaScript animation loop
 * and the browser can drop the work entirely when the tab is hidden.
 *
 * It is a real <Link> to /dashboard, so routing, prefetch, middle-click and
 * "open in new tab" all behave exactly like the other tabs. The click handler
 * only adds the already-Home case, and never blocks navigation.
 */

export const ORB_HOME_HREF = "/dashboard" as Route;

export function MadBuddyOrb({
  isActive,
  /**
   * Whether Home has something new worth noticing (a nearby Muddy, a Moment,
   * a Journey update). Rendered as a small accent on the ring — deliberately
   * NOT a red badge and never a counter, so it cannot compete with the real
   * notification badges in the header.
   */
  hasActivity = false,
  className
}: {
  isActive: boolean;
  hasActivity?: boolean;
  className?: string;
}) {
  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    // Let the browser handle modified clicks (new tab, new window) normally.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (!isActive) return;

    // Already on Home. Scroll to top if there is anywhere to scroll, otherwise
    // do nothing at all: no re-navigation, no refresh, no reopened sheets.
    event.preventDefault();
    if (typeof window === "undefined") return;
    if (window.scrollY <= 0) return;

    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
  }

  return (
    <Link
      href={ORB_HOME_HREF}
      prefetch={false}
      onClick={handleClick}
      // Kept from the previous centre item so guided tours still resolve.
      data-tour-id="nav-dashboard"
      aria-label="Home"
      aria-current={isActive ? "page" : undefined}
      className="safe-motion flex min-h-[56px] w-full items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span
        className={cn("mb-orb", isActive && "is-active", hasActivity && "has-activity", className)}
        // Decorative: the accessible name lives on the link above, so the
        // visual layers are never announced.
        aria-hidden="true"
      >
        <span className="mb-orb-core">
          {/* The mark sits ON the gradient, so it takes the orb's foreground
              rather than currentColor — every glow layer around it is
              untouched. */}
          <HomeMarkIcon className="mb-orb-mark" />
        </span>
      </span>
    </Link>
  );
}
