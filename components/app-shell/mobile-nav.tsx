"use client";

import { Compass, Hand, LockKeyhole, MessageCircle, Users, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { NavigationGlyph, type NavigationGlyphName } from "@/components/app-shell/navigation-glyph";
import type { BrandNavigationIconName } from "@/lib/brand/assets";
import { MadBuddyOrb, ORB_HOME_HREF } from "@/components/app-shell/mad-buddy-orb";
import { useFeatureAvailability } from "@/components/features/feature-availability-context";
import { featureForHref } from "@/lib/features/availability";
import { CountBadge } from "@/components/ui/count-badge";
import { Link, usePathname, type LinkProps } from "@/lib/platform";
import { cn } from "@/lib/utils";

/**
 * The mobile bottom navigation, shared by the web app and the Capacitor SPA.
 *
 * EXTRACTED FROM app-shell.tsx, rather than sharing that whole file. The shell
 * is 1,548 lines and carries genuinely web-only machinery -- next/dynamic for
 * the lazy camera chunk, the desktop sidebar, a wallpaper promise unwrapped
 * with React use() inside Suspense. None of that can exist in a Vite bundle,
 * and none of it is the navigation. Moving just the chrome keeps the seam at a
 * real boundary instead of forcing the whole shell through the adapter.
 *
 * The web shell imports these back, so web renders exactly what it did before.
 */

/**
 * The destination type is taken FROM THE ADAPTER rather than declared here.
 *
 * On web `LinkProps["href"]` resolves to Next's typed-route union, so every
 * entry in MOBILE_TABS is still validated against the real route table at
 * compile time -- `next build` rejects a path that does not exist. On mobile
 * the same property is a plain string, which is what react-router needs.
 *
 * The alternatives were both worse: hardcoding `string` broke `next build`
 * ("Type 'string' is not assignable to ... RouteImpl"), and casting at the
 * Link call site would have silently disabled typed-route checking for every
 * tab -- exactly the safety the adapter exists to preserve.
 */
/* Excludes the object form: every tab is a plain path, and the code below
   calls .slice() on it for the tour id. Next's href also accepts a UrlObject,
   which no tab uses. */
type PlatformHref = Extract<LinkProps<string>["href"], string>;

export type MobileTab = {
  href: PlatformHref;
  label: string;
  icon: LucideIcon;
  brandIcon?: BrandNavigationIconName;
};

/** Four destinations split either side of Home; route metadata stays stable. */
export const MOBILE_TABS = [
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/friends", label: "Muddies", icon: Users },
  { href: "/linkr", label: "Linkr", icon: Compass, brandIcon: "linkr" },
  { href: "/meet-up", label: "Meetups", icon: Hand, brandIcon: "upfor" }
  // `satisfies` checks the shape WITHOUT widening href to string, so each
  // literal path survives for Next to narrow to a Route.
] satisfies MobileTab[];

/**
 * Keeps a tab lit on nested routes (/friends/someone, /plans/123), matching
 * the desktop sidebar's rule. Takes only what it needs so it works for both a
 * MobileTab and a full NavigationItem.
 */
export function isNavigationItemActive(item: { href: string }, pathname: string) {
  return (
    pathname === item.href ||
    pathname.startsWith(`${item.href}/`) ||
    (item.href === "/settings" && pathname === "/upgrade")
  );
}

/**
 * Shared five-slot navigation: Messages, Muddies, Home, Linkr, Meetups.
 * The approved design uses equal slots, solid icons and permanent labels.
 * The CSS owns the floating pill and inset active state; this component keeps
 * route matching, feature gates, counts, tours and immersive hiding intact.
 */
export function MobileNav({
  immersive = false,
  onHomeReselect,
  messageUnreadCount = 0,
  muddyRequestCount = 0,
  isDestinationAvailable
}: {
  immersive?: boolean;
  onHomeReselect: () => void;
  messageUnreadCount?: number;
  muddyRequestCount?: number;
  /**
   * Whether a destination exists on the current platform.
   *
   * Omitted on web, where every tab's destination exists -- so web renders
   * exactly as before. The native shell passes `isBuiltForMobile`, which
   * reports Linkr and Meetups as absent; those tabs keep their slot (the
   * four-tab layout around the Orb stays identical on both platforms) but are
   * dimmed and cannot navigate.
   *
   * Injected rather than imported so this file carries no platform-specific
   * import, and so web behaviour cannot change by accident.
   */
  isDestinationAvailable?: (href: string) => boolean;
}) {
  const pathname = usePathname();
  const [unavailableNotice, setUnavailableNotice] = useState<string | null>(null);

  // Auto-dismiss: the notice answers one tap. It should not linger over the
  // nav or need a second interaction to clear.
  useEffect(() => {
    if (!unavailableNotice) return;
    const timer = window.setTimeout(() => setUnavailableNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [unavailableNotice]);

  // The Orb sits in the middle; the four destinations split around it.
  const leftTabs = MOBILE_TABS.slice(0, 2);
  const rightTabs = MOBILE_TABS.slice(2);
  const homeActive = isNavigationItemActive({ href: ORB_HOME_HREF }, pathname);

  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-background/95 pb-[min(env(safe-area-inset-bottom,0px),0.75rem)] backdrop-blur-xl dark:border-white/10 dark:bg-[#151517]/95 md:hidden",
        "transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none",
        immersive ? "pointer-events-none translate-y-full opacity-0" : "translate-y-0 opacity-100"
      )}
      aria-hidden={immersive || undefined}
      inert={immersive || undefined}
      aria-label="Mobile navigation"
    >
      <ul className="mx-auto flex w-full max-w-[min(30rem,100%)] items-stretch justify-between px-1.5">
        {leftTabs.map((tab) => (
          <MobileNavTab
            key={tab.href}
            tab={tab}
            pathname={pathname}
            messageUnreadCount={tab.href === "/messages" ? messageUnreadCount : 0}
            muddyRequestCount={tab.href === "/friends" ? muddyRequestCount : 0}
            unavailable={isDestinationAvailable ? !isDestinationAvailable(tab.href) : false}
            onUnavailable={setUnavailableNotice}
          />
        ))}

        <li className="min-w-0 flex-1 pb-0 pt-4">
          <MadBuddyOrb isActive={homeActive} onHomeReselect={onHomeReselect} />
        </li>

        {rightTabs.map((tab) => (
          <MobileNavTab
            key={tab.href}
            tab={tab}
            pathname={pathname}
            messageUnreadCount={tab.href === "/messages" ? messageUnreadCount : 0}
            muddyRequestCount={tab.href === "/friends" ? muddyRequestCount : 0}
            unavailable={isDestinationAvailable ? !isDestinationAvailable(tab.href) : false}
            onUnavailable={setUnavailableNotice}
          />
        ))}
      </ul>

      {/* Sits ABOVE the bar rather than over it, so it never covers the tabs
          the person is looking at. role="status" (not "alert") because this
          answers a deliberate tap -- it is confirmation, not an interruption.
          aria-live announces it for anyone who cannot see the dimming, which
          is also why the state is in each tab's accessible name. */}
      {unavailableNotice ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2",
            "rounded-full bg-foreground/90 px-3.5 py-1.5 text-xs font-medium text-background shadow-lg",
            "animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
          )}
        >
          {unavailableNotice} is coming soon on Android
        </div>
      ) : null}
    </nav>
  );
}

function MobileNavTab({
  tab,
  pathname,
  messageUnreadCount = 0,
  muddyRequestCount = 0,
  unavailable = false,
  onUnavailable
}: {
  tab: MobileTab;
  pathname: string;
  messageUnreadCount?: number;
  muddyRequestCount?: number;
  /**
   * The destination exists on web but not in the native app yet (Linkr,
   * Meetups). The tab KEEPS ITS SLOT so the layout is identical on both
   * platforms and the feature reads as "coming", not "gone" -- but it must
   * not navigate, because the route would land on the unavailable screen and
   * look like a fault. Always false on web.
   */
  unavailable?: boolean;
  onUnavailable?: (label: string) => void;
}) {
  const isActive = isNavigationItemActive({ href: tab.href }, pathname);
  const availability = useFeatureAvailability();
  const feature = featureForHref(tab.href);
  const locked = unavailable || Boolean(feature && availability && !availability[feature]);
  const lockBadge = locked ? (
    <span className="pointer-events-none absolute bottom-0 right-0 grid h-[14px] w-[14px] place-items-center rounded-full bg-background text-muted-foreground dark:bg-[#151517]" aria-hidden="true">
      <LockKeyhole className="h-[10px] w-[10px]" strokeWidth={2} />
    </span>
  ) : null;

  /* Shared by both branches so a disabled tab is visually identical to an
     enabled one apart from its dimming -- same 40px target, same 56px row,
     same min-w-0 shrink behaviour (MB-GOD-047). */
  const iconWrapperClass = cn(
    "relative grid h-[40px] w-[40px] shrink-0 place-items-center rounded-full transition-colors duration-200 ease-out motion-reduce:transition-none",
    isActive ? "bg-primary/12 text-primary" : "text-muted-foreground"
  );

  const glyph: NavigationGlyphName = tab.href === "/messages" ? "messages"
    : tab.href === "/friends" ? "muddies" : tab.href === "/linkr" ? "linkr" : "meetups";
  const iconNode = <NavigationGlyph name={glyph} className="h-[28px] w-[28px]" />;

  if (unavailable) {
    return (
      <li className="min-w-0 flex-1 pb-0 pt-4">
        {/* A BUTTON, not a disabled Link.
            `aria-disabled` on an anchor still lets it be followed, and a real
            `disabled` attribute does not exist on <a>. A button cannot
            navigate at all, and it is the honest element for a control whose
            only job is to explain itself. It stays focusable so a keyboard or
            screen-reader user can discover the feature and hear why it is
            unavailable -- removing it from the tab order would hide that. */}
        <button
          type="button"
          data-tour-id={`nav-${tab.href.slice(1)}`}
          // The accessible name carries the reason: "dimmed" is not
          // perceivable to a screen reader, so the state must be in the name.
          aria-label={`${tab.label}. Coming soon on Android.`}
          aria-disabled="true"
          onClick={() => onUnavailable?.(tab.label)}
          className={cn(
            "safe-motion flex min-h-[56px] w-full flex-col items-center justify-center gap-1 rounded-2xl",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            // Dimmed rather than hidden: the slot is kept deliberately.
            "opacity-40",
            // No active:scale -- a press that cannot navigate should not
            // animate as though it did.
            "cursor-default"
          )}
        >
          <span className={iconWrapperClass}>{iconNode}{lockBadge}</span>
          <span className="mobile-nav-label max-w-full truncate">{tab.label}</span>
        </button>
      </li>
    );
  }

  /* `min-w-0` matters (MB-GOD-047).
   *
   * A flex item defaults to `min-width: auto`, which refuses to shrink below
   * its content -- so at 200% text the five tabs demanded 390px inside a 360px
   * bar and "UpFor" sat thirty pixels past the edge of a nav that does not
   * scroll. Capping the <ul> did nothing because the OVERFLOW IS IN THE
   * CHILDREN. `min-w-0` lets each tab shrink; the label truncates and the icon
   * target is unaffected. */
  return (
    <li className="min-w-0 flex-1 pb-0 pt-4">
      <Link
        href={tab.href}
        featureLockIndicator={false}
        prefetch={false}
        // Stable targeting contract for guided tours. Derived from the route,
        // so a tour step never depends on a fragile positional selector.
        data-tour-id={`nav-${tab.href.slice(1)}`}
        aria-label={locked ? `${tab.label}. Coming soon.` : tab.label}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "safe-motion flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          "active:scale-95 motion-reduce:active:scale-100"
        )}
      >
        {/* A FIXED 40px TARGET, not 2.5rem (MB-GOD-047).
            `h-10 w-10` is rem-based, so at 200% text this circle became 80px
            and five of them demanded 390px inside a 360px bar -- pushing
            "UpFor" off a nav that does not scroll. An icon is not text:
            scaling text up should not scale the chrome around it, and 40px
            keeps the row's proportions identical at every text size while the
            56px row height preserves the touch target. */}
        <span className={iconWrapperClass}>
          {iconNode}
          {lockBadge}
          {tab.href === "/messages" && messageUnreadCount > 0 ? <UnreadBadge count={messageUnreadCount} /> : null}
          {tab.href === "/friends" && muddyRequestCount > 0 ? <UnreadBadge count={muddyRequestCount} /> : null}
        </span>
        {/* Truncate only at enlarged text sizes; the accessible name stays complete. */}
          <span className="mobile-nav-label max-w-full truncate">
            {tab.label}
          </span>
      </Link>
    </li>
  );
}

function UnreadBadge({ count }: { count: number }) {
  // Canonical badge (components/ui/count-badge.tsx). Position nudged to
  // -right-1/-top-1 here (vs. the shared -right-0.5/-top-0.5 default) because
  // this badge sits on a smaller icon pill than the header's, and needs a
  // touch more clearance to avoid the pill's own edge.
  return <CountBadge count={count} className="-right-1 -top-1" />;
}
