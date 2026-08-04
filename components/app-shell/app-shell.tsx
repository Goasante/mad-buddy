"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  CalendarCheck2,
  CircleDollarSign,
  Compass,
  Gauge,
  Hand,
  HelpCircle,
  Home,
  LogOut,
  MessagesSquare,
  MoreHorizontal,
  PartyPopper,
  Sparkles,
  Plus,
  Settings,
  UserRound,
  Users2,
  UsersRound
} from "lucide-react";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { Suspense, use, useCallback, useEffect, useRef, useState } from "react";
import { LocationSignalSync } from "@/components/app-shell/location-signal-sync";
import { SessionBoundary } from "@/components/auth/session-boundary";
import { useSecureLogout } from "@/components/auth/use-secure-logout";
import { LiveSignalToast } from "@/components/notifications/live-signal-toast";
import { Button } from "@/components/ui/button";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { UserAvatar } from "@/components/ui/user-avatar";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { cn } from "@/lib/utils";
import type { FeatureIconKey } from "@/lib/icons/feature-icons";
import type { ResolvedWallpaper } from "@/lib/wallpapers/catalog";
import { BrandMark } from "@/components/brand/brand-mark";
import { fetchWithTimeout } from "@/lib/network/resilience";
import { NavigationWatchdog } from "@/components/navigation/navigation-watchdog";

// Order matters for MobileNav, which just takes the first five (minus
// admin/billing). Primary destinations are listed first so the bottom bar's
// slice keeps showing the same four the desktop sidebar treats as primary.
//
// PREFETCH IS DISABLED on every shell nav/menu Link below (`prefetch={false}`).
// This is deliberate and load-bearing — do not remove it without re-measuring.
// Every destination here lives under app/(app)/layout.tsx, which is
// `force-dynamic`, so a prefetch cannot be cached and instead executes a FULL
// server render: middleware auth round trip + layout auth round trip + the
// notifications/profile/feature-flag/subscription queries. With ~17 shell
// links, default prefetch turned a single page view into a burst of a dozen
// such renders — production logs showed 8 dynamic route renders inside 1.4s,
// with /dashboard, /friends and /plans each rendered twice, which no human
// click pattern can produce. Opening the account dropdown was the worst case:
// it mounts five Links at once, firing five full renders, and then the user's
// actual click had to queue behind the five prefetches their own tap had just
// started — which is exactly the reported "open profile menu, navigate, stall"
// symptom, and why a Retry (by then the burst had drained) worked.
// For a force-dynamic route prefetch buys almost nothing anyway: it can only
// reach the loading.tsx boundary, so the real render still happens on click.
// Near-zero benefit, very high cost.
const navigationItems: Array<{
  href:
    | "/dashboard"
    | "/friends"
    | "/notifications"
    | "/messages"
    | "/plans"
    | "/moments"
    | "/events"
    | "/groups"
    | "/discover"
    | "/profile"
    | "/settings"
    | "/billing"
    | "/admin";
  label: string;
  icon: LucideIcon;
  /** Owner-selected feature icon; overrides the lucide fallback when present. */
  featureIcon?: FeatureIconKey;
}> = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/friends", label: "Muddies", icon: UsersRound },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/messages", label: "Messages", icon: MessagesSquare },
  { href: "/plans", label: "Plans", icon: CalendarCheck2, featureIcon: "plans" },
  { href: "/moments", label: "Moments", icon: Sparkles, featureIcon: "moments" },
  { href: "/events", label: "Events", icon: PartyPopper, featureIcon: "events" },
  { href: "/groups", label: "Groups", icon: Users2, featureIcon: "groups" },
  { href: "/discover", label: "Socialize", icon: Compass, featureIcon: "socialize" },
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/billing", label: "Membership", icon: CircleDollarSign }
];

const PRIMARY_HREFS = ["/dashboard", "/friends", "/notifications", "/messages"] as const;
const SECONDARY_HREFS = ["/plans", "/moments", "/events", "/groups", "/discover"] as const;

/**
 * Routes that render their own in-page title instead of the shared AppHeader
 * (AppHeader returns null for them). Shared between AppShell — which needs it
 * to decide how much top offset <main> reserves — and AppHeader — which needs
 * it to decide whether to render at all — so the two can never drift apart.
 */
const PAGES_WITH_OWN_HEADER = [
  "/notifications",
  "/profile",
  "/settings",
  "/plans",
  "/messages",
  "/events",
  "/groups",
  "/discover",
  "/meeting-pings",
  "/moments"
] as const;

function hasOwnHeader(pathname: string): boolean {
  return PAGES_WITH_OWN_HEADER.some((href) => pathname === href || pathname.startsWith(`${href}/`));
}

export type AppShellProps = {
  children: ReactNode;
  showAdminLink?: boolean;
  initialUnreadCount?: number;
  locationSyncEnabled?: boolean;
  currentUsername?: string | null;
  currentAvatarUrl?: string | null;
  currentUserId?: string | null;
  hiddenNavigationHrefs?: string[];
  /**
   * Server-resolved wallpaper (entitlement-checked, always safe), as a
   * PROMISE rather than an already-awaited value — the layout never awaits
   * this itself, so a slow resolve (including the live Storage signed-URL
   * call a custom wallpaper needs) can never delay the route committing.
   * Unwrapped with use() inside its own Suspense boundary below, so only the
   * wallpaper visual is pending while the rest of the shell and the actual
   * destination content render immediately.
   */
  wallpaperPromise?: Promise<ResolvedWallpaper | null>;
};

const resolvedDefaultWallpaper = Promise.resolve<ResolvedWallpaper | null>(null);

export function AppShell({
  children,
  showAdminLink = false,
  initialUnreadCount = 0,
  locationSyncEnabled = true,
  currentUsername = null,
  currentAvatarUrl = null,
  currentUserId = null,
  hiddenNavigationHrefs = [],
  wallpaperPromise = resolvedDefaultWallpaper
}: AppShellProps) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const hasCompletedInitialRender = useRef(false);
  const unreadRefreshRef = useRef<Promise<void> | null>(null);
  const refreshUnreadCount = useCallback(async () => {
    if (unreadRefreshRef.current) return unreadRefreshRef.current;

    const refresh = (async () => {
      try {
        const response = await fetchWithTimeout("/api/notifications/unread-count", {
          credentials: "include",
          cache: "no-store"
        }, 12_000, "refresh unread notifications");
        if (!response.ok) return;
        const data = (await response.json()) as { unreadCount: number };
        setUnreadCount(data.unreadCount);
      } catch {
        // Keep the last known count when the notification service is unavailable.
      } finally {
        unreadRefreshRef.current = null;
      }
    })();

    unreadRefreshRef.current = refresh;
    return refresh;
  }, []);

  useEffect(() => {
    if (!hasCompletedInitialRender.current) {
      hasCompletedInitialRender.current = true;
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      void refreshUnreadCount();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname, refreshUnreadCount]);

  useEffect(() => {
    const handleFocus = () => refreshUnreadCount();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshUnreadCount();
    };
    const handleUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ unreadCount?: number }>).detail;
      if (typeof detail?.unreadCount === "number") setUnreadCount(detail.unreadCount);
      else refreshUnreadCount();
    };
    // 60s background cadence, paused while the tab is hidden, the focus and
    // visibilitychange handlers above refresh immediately on return, so a
    // slower idle poll costs no freshness the user can see (battery/audit).
    const interval = window.setInterval(() => {
      if (!document.hidden) void refreshUnreadCount();
    }, 60_000);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("mad-buddy:notifications-updated", handleUpdated);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("mad-buddy:notifications-updated", handleUpdated);
    };
  }, [refreshUnreadCount]);

  const enabledNavigationItems = navigationItems.filter((item) => !hiddenNavigationHrefs.includes(item.href));
  const visibleNavigationItems = showAdminLink
    ? [...enabledNavigationItems, { href: "/admin" as const, label: "Admin", icon: Gauge }]
    : enabledNavigationItems;
  // Whether the shared AppHeader renders for this route — decides how much
  // top offset <main> reserves below. Kept in sync with AppHeader's own check
  // via the shared PAGES_WITH_OWN_HEADER list (see hasOwnHeader above), so the
  // two can never disagree about whether a header is actually on screen.
  const hasGlobalHeader = !hasOwnHeader(pathname);

  return (
    // The safe-area top inset is no longer padded here: it's reserved exactly
    // once, either by the fixed AppHeader (which pages using it get via
    // --app-header-height on <main> below) or, for pages with their own
    // in-page header, by <main>'s own env(safe-area-inset-top) padding — never
    // both, and never as a blanket guess applied regardless of route.
    <div className="flex min-h-[100svh] min-h-[100dvh] flex-col bg-background pb-[calc(88px+env(safe-area-inset-bottom))] dark:bg-[#111112] md:block md:bg-secondary/25 md:p-4 md:pb-4 dark:md:bg-[#353537]">
      <a
        href="#app-main-content"
        className="focus-ring sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:shadow-lg"
      >
        Skip to content
      </a>
      <LocationSignalSync initiallyEnabled={locationSyncEnabled} />
      <SessionBoundary currentUserId={currentUserId} />
      <NavigationWatchdog />
      {/* Waves and achievement unlocks animate over whatever page the user is
          on, so this lives in the shell rather than on any one screen. */}
      <LiveSignalToast currentUserId={currentUserId} />
      <div className="flex min-h-0 flex-1 flex-col bg-background dark:bg-[#111112] md:grid md:h-[calc(100vh-2rem)] md:grid-cols-[4.75rem_minmax(0,1fr)] md:overflow-hidden md:rounded-[1.35rem] md:border md:border-border/80 md:bg-background md:shadow-[0_28px_90px_hsl(var(--shadow)/0.24)] dark:md:border-white/10 dark:md:bg-[#101011]">
      <DesktopSidebar
        navigationItems={visibleNavigationItems}
        unreadCount={unreadCount}
        currentUsername={currentUsername}
        currentAvatarUrl={currentAvatarUrl}
      />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background dark:bg-[#111112]">
        {/* Branded wallpaper, painted behind the header AND the content (chrome
            here means bottom nav / modals, which keep their own opaque
            surfaces). Mounted at this level — not inside <main> — so the
            header's translucent/blurred background shows the same wallpaper
            rather than sitting on top of it as a flat, non-blending bar.
            Purely decorative. */}
        <Suspense fallback={<WallpaperLayer wallpaper={null} />}>
          <WallpaperLayerAsync wallpaperPromise={wallpaperPromise} />
        </Suspense>
        <AppHeader
          currentUsername={currentUsername}
          currentAvatarUrl={currentAvatarUrl}
          showAdminLink={showAdminLink}
        />
          <main
          id="app-main-content"
          className={cn(
            "relative flex-1 px-4 pb-5 sm:px-6 lg:px-8 lg:pb-6 md:min-h-0 md:overflow-y-auto md:pt-0",
            // The fixed AppHeader is out of normal flow, so <main> reserves its
            // exact footprint here — the one place this offset is computed, so
            // no page ever needs its own top-padding guess. Pages with their
            // own in-page header (AppHeader renders nothing for them) still
            // need the bare safe-area inset so their own title clears the notch.
            hasGlobalHeader ? "pt-[var(--app-header-height)]" : "pt-[env(safe-area-inset-top,0px)]"
          )}
        >
          {/* One pull-to-refresh for the whole authenticated app, mounted here
              rather than repeated per page. It re-runs the server render and
              notifies any page that keeps canonical data in client state. */}
          <PullToRefresh>
            <div className="mx-auto w-full max-w-[1200px]">{children}</div>
          </PullToRefresh>
        </main>
        </div>
      </div>
      <MobileNav navigationItems={visibleNavigationItems} unreadCount={unreadCount} />
    </div>
  );
}

type NavigationItem = (typeof navigationItems)[number];

function isNavigationItemActive(item: NavigationItem, pathname: string) {
  return (
    pathname === item.href ||
    pathname.startsWith(`${item.href}/`) ||
    (item.href === "/settings" && pathname === "/upgrade")
  );
}

function notificationAriaLabel(label: string, unreadCount: number) {
  return unreadCount > 0 ? `${label}, ${unreadCount} unread` : label;
}

function DesktopSidebar({
  navigationItems,
  unreadCount,
  currentUsername,
  currentAvatarUrl
}: {
  navigationItems: NavigationItem[];
  unreadCount: number;
  currentUsername: string | null;
  currentAvatarUrl: string | null;
}) {
  const pathname = usePathname();
  const primaryItems = navigationItems.filter((item) => (PRIMARY_HREFS as readonly string[]).includes(item.href));
  const secondaryItems = navigationItems.filter((item) => (SECONDARY_HREFS as readonly string[]).includes(item.href));
  const adminItem = navigationItems.find((item) => item.href === "/admin");
  // Both flyouts share this so opening one always closes the other, two
  // independent open states would let both sit open simultaneously.
  const [openFlyout, setOpenFlyout] = useState<"more" | "account" | null>(null);

  return (
    <aside
      className="hidden border-r border-border/80 bg-card/70 dark:border-white/10 dark:bg-[#09090a] md:flex md:min-h-0 md:flex-col"
      aria-label="Main navigation"
    >
      <Link
        href="/dashboard"
        prefetch={false}
        aria-label="Mad Buddy home"
        title="Mad Buddy home"
        className="focus-ring grid h-14 shrink-0 place-items-center border-b border-border/70 dark:border-white/10"
      >
        <BrandMark className="h-9 w-9" priority />
      </Link>

      {/* More lives in the same list as the primary items (not a separate
          group behind a divider) so all five icons share identical spacing,
          a divider here was reading as uneven gaps between Messages and
          More. The empty space this nav's flex-1 leaves before the account
          area at the bottom is the only separator now, by design. */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="Primary navigation">
        <ul className="flex flex-col items-center gap-3">
          {primaryItems.map((item) => {
            const isActive = isNavigationItemActive(item, pathname);
            const ariaLabel =
              item.href === "/notifications"
                ? notificationAriaLabel(item.label, unreadCount)
                : item.label;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  prefetch={false}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={ariaLabel}
                  title={item.label}
                  className="focus-ring grid h-11 w-11 place-items-center rounded-xl"
                >
                  <NavIconPill isActive={isActive}>
                    <NavItemIcon item={item} lucideClass="h-5 w-5" size={20} isActive={isActive} />
                    {item.href === "/notifications" ? <UnreadBadge count={unreadCount} /> : null}
                  </NavIconPill>
                </Link>
              </li>
            );
          })}
          <li>
            <MoreMenu
              items={secondaryItems}
              pathname={pathname}
              open={openFlyout === "more"}
              onOpenChange={(next) => setOpenFlyout(next ? "more" : null)}
            />
          </li>
        </ul>
      </nav>

      <div className="shrink-0 border-t border-border/70 p-2 dark:border-white/10">
        <div id="sidebar-subscription-status" className="sr-only" />
        <AccountMenu
          currentUsername={currentUsername}
          currentAvatarUrl={currentAvatarUrl}
          adminItem={adminItem}
          pathname={pathname}
          open={openFlyout === "account"}
          onOpenChange={(next) => setOpenFlyout(next ? "account" : null)}
        />
      </div>
    </aside>
  );
}

/** Shared visual language for both sidebar flyouts (spec: 220-260px wide,
 * 12-16px radius, restrained shadow, not the heavier glass-panel used by
 * centred modals, 8px internal padding, 40-44px rows). */
const FLYOUT_CONTENT_CLASSNAME =
  "app-dropdown-content sidebar-flyout w-60";

function flyoutItemClassName(isActive: boolean) {
  return cn(
    "app-dropdown-option h-11 cursor-pointer text-sm font-medium",
    isActive
      ? "bg-primary/10 text-primary"
      : "text-foreground data-[highlighted]:bg-secondary dark:data-[highlighted]:bg-white/[0.06]"
  );
}

/**
 * Every sidebar trigger shares this: a 44px hit area (outer, unstyled) around
 * a slightly smaller pill (inner, this component) that actually carries the
 * hover/active colour. Sizing the visible state below the hit area, rather
 * than filling it edge to edge, is what keeps the active item from reading
 * as "bigger" than its neighbours, and a tinted bg-primary/12 rather than a
 * solid fill plus shadow is the "subtle, not a glow" active treatment.
 */
/** Renders a nav item's icon: the owner-selected feature asset when present,
 *  otherwise the lucide fallback (which keeps the currentColor/active-fill
 *  behaviour the monochrome chrome relies on). */
function NavItemIcon({
  item,
  lucideClass,
  size,
  isActive,
  fillActive = false
}: {
  item: NavigationItem;
  lucideClass: string;
  size: number;
  isActive: boolean;
  fillActive?: boolean;
}) {
  if (item.featureIcon) {
    return <FeatureIcon feature={item.featureIcon} size={size} active={isActive} decorative />;
  }
  const Icon = item.icon;
  return (
    <Icon
      className={lucideClass}
      strokeWidth={1.75}
      fill={fillActive && isActive ? "currentColor" : "none"}
      aria-hidden="true"
    />
  );
}

function NavIconPill({ isActive, children }: { isActive: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "relative grid h-9 w-9 place-items-center rounded-xl transition-colors motion-reduce:transition-none",
        isActive
          ? "bg-primary/12 text-primary"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground dark:hover:bg-white/[0.05]"
      )}
    >
      {children}
    </span>
  );
}

function MoreMenu({
  items,
  pathname,
  open,
  onOpenChange
}: {
  items: NavigationItem[];
  pathname: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isAnyActive = open || items.some((item) => isNavigationItemActive(item, pathname));

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="More"
          title="More"
          className="focus-ring grid h-11 w-11 place-items-center rounded-xl"
        >
          <NavIconPill isActive={isAnyActive}>
            <MoreHorizontal className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </NavIconPill>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="right"
          align="start"
          sideOffset={10}
          collisionPadding={8}
          className={FLYOUT_CONTENT_CLASSNAME}
        >
          {items.map((item) => {
            const isActive = isNavigationItemActive(item, pathname);
            return (
              <DropdownMenu.Item key={item.href} asChild className={flyoutItemClassName(isActive)}>
                <Link href={item.href} prefetch={false} aria-current={isActive ? "page" : undefined}>
                  <NavItemIcon item={item} lucideClass="h-5 w-5 shrink-0" size={20} isActive={isActive} />
                  {item.label}
                </Link>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function AccountMenu({
  currentUsername,
  currentAvatarUrl,
  adminItem,
  pathname,
  open,
  onOpenChange
}: {
  currentUsername: string | null;
  currentAvatarUrl: string | null;
  adminItem: NavigationItem | undefined;
  pathname: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const initial = currentUsername?.[0]?.toUpperCase() ?? "?";
  const { logout, isPending: logoutPending } = useSecureLogout();
  const isCurrentRoute =
    pathname === "/profile" ||
    pathname === "/settings" ||
    pathname.startsWith("/settings/") ||
    pathname === "/billing" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/");
  // The menu opening is itself a state worth showing, not just which route
  // you're on, otherwise clicking the avatar gives no visible feedback.
  const isActive = open || isCurrentRoute;

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Account"
          title="Account"
          className="focus-ring mx-auto grid h-11 w-11 place-items-center rounded-full"
        >
          <span
            className={cn(
              "relative grid h-9 w-9 place-items-center overflow-hidden rounded-full text-sm font-semibold transition-colors",
              isActive
                ? "bg-primary/12 text-primary"
                : "bg-secondary text-foreground hover:bg-secondary/80 dark:bg-white/[0.06]"
            )}
          >
            <AccountAvatar src={currentAvatarUrl} initial={initial} />
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="right"
          align="end"
          sideOffset={10}
          collisionPadding={8}
          className={FLYOUT_CONTENT_CLASSNAME}
        >
          {currentUsername ? (
            <p className="truncate px-3 pb-1.5 pt-1 text-xs font-medium text-muted-foreground">
              @{currentUsername}
            </p>
          ) : null}
          <AccountMenuItem href="/profile" label="Profile" icon={UserRound} isActive={pathname === "/profile"} />
          <AccountMenuItem
            href="/settings"
            label="Settings"
            icon={Settings}
            isActive={pathname === "/settings" || pathname.startsWith("/settings/")}
          />
          <AccountMenuItem
            href="/billing"
            label="Membership"
            icon={CircleDollarSign}
            isActive={pathname === "/billing"}
          />
          {adminItem ? (
            <AccountMenuItem
              href="/admin"
              label="Admin"
              icon={Gauge}
              isActive={pathname === "/admin" || pathname.startsWith("/admin/")}
            />
          ) : null}
          <DropdownMenu.Separator className="my-2 h-px bg-border/70 dark:bg-white/10" />
          <DropdownMenu.Item
            className={cn(flyoutItemClassName(false), "text-destructive")}
            disabled={logoutPending}
            onSelect={logout}
          >
            <LogOut className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            Log out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function AccountMenuItem({
  href,
  label,
  icon: Icon,
  isActive
}: {
  href: ComponentProps<typeof Link>["href"];
  label: string;
  icon: LucideIcon;
  isActive: boolean;
}) {
  return (
    <DropdownMenu.Item asChild className={flyoutItemClassName(isActive)}>
      <Link href={href} prefetch={false} aria-current={isActive ? "page" : undefined}>
        <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        {label}
      </Link>
    </DropdownMenu.Item>
  );
}

function AppHeader({
  currentUsername,
  currentAvatarUrl,
  showAdminLink
}: {
  currentUsername: string | null;
  currentAvatarUrl: string | null;
  showAdminLink: boolean;
}) {
  const pathname = usePathname();
  // NO useDismissOnBack here either — same reason as MobileAccountMenu below:
  // this menu's actions are <Link>s, so closing it is itself part of starting
  // a navigation, and the hook's history.back() cleanup would cancel it.
  const [createOpen, setCreateOpen] = useState(false);

  if (hasOwnHeader(pathname)) {
    return null;
  }

  return (
    // `fixed`, not `sticky`: sticky's "stuck" offset depends on the nearest
    // scrolling ancestor and a definite `top` value — fragile in a deeply
    // nested flex shell, and any ancestor coupling overflow-x with an implicit
    // overflow-y (or a non-supporting env()) silently drops it back to static,
    // which is exactly how page content ends up scrolling up over the header.
    // Fixed positioning has no such dependency: it always anchors to the true
    // viewport and (with an explicit z-index) always paints above in-flow
    // content, on every browser. <main>'s top offset is the corresponding
    // --app-header-height (see globals.css) — one shared value instead of a
    // per-page padding guess. Desktop reverts to a normal in-flow row (the
    // header never needs to "float" there — it already sits permanently above
    // the independently-scrolling desktop panel).
    <header
      className="fixed inset-x-0 top-0 z-30 border-b border-border/70 bg-background/90 pt-[env(safe-area-inset-top,0px)] backdrop-blur-xl dark:border-white/10 dark:bg-[#111112]/90 md:static md:pt-0"
    >
      <div className="mx-auto flex h-[var(--app-header-content-height)] w-full max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        {/* Mobile: logo only, the greeting below establishes the page, so no
            "Home" title competes with it. Desktop keeps the in-panel page
            title (the sidebar carries the logo there). */}
        <Link
          href="/dashboard"
          prefetch={false}
          aria-label="Mad Buddy home"
          title="Mad Buddy home"
          className="focus-ring shrink-0 md:hidden"
        >
          <BrandMark className="h-9 w-9" priority />
        </Link>
        {/* Home and Friends get a header title here; every other page carries
            its own H1 in its content, so the generic "App / Mad Buddy" fallback
            is omitted rather than duplicated on top of the page's real title. */}
        <div className="mr-auto hidden min-w-0 md:block">
          {pathname === "/dashboard" || pathname === "/friends" ? (
            <h1 className="truncate text-lg font-semibold sm:text-xl">
              {pathname === "/dashboard" ? "Home" : "Friends"}
            </h1>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <DropdownMenu.Root open={createOpen} onOpenChange={setCreateOpen}>
            <DropdownMenu.Trigger asChild>
              <Button type="button" variant="outline" size="icon" aria-label="Create" title="Create">
                <Plus className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content side="bottom" align="end" sideOffset={8} collisionPadding={8} className={FLYOUT_CONTENT_CLASSNAME}>
                {createActions.map((action) => (
                  <DropdownMenu.Item
                    key={action.title}
                    asChild
                    className="focus-ring safe-motion flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2.5 text-left outline-none data-[highlighted]:bg-secondary"
                  >
                    <Link href={action.href} prefetch={false}>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                        <FeatureIcon feature={action.featureIcon} size={20} decorative />
                      </span>
                      <span className="text-left">
                        <span className="block text-sm font-semibold">{action.title}</span>
                        <span className="block text-xs text-muted-foreground">{action.description}</span>
                      </span>
                    </Link>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          {/* Notifications + account are mobile-only here (md:hidden); on
              desktop the sidebar already provides both, so surfacing them in
              the header too would duplicate destinations in one viewport. */}
          {/* No unread badge here on purpose: the bell and the Pulse tab both
              open /notifications from the same unread source, so badging both
              would show the same count twice. The badge stays on the Pulse
              tab (the labelled destination). */}
          <div className="md:hidden">
            <MobileAccountMenu
              currentUsername={currentUsername}
              currentAvatarUrl={currentAvatarUrl}
              showAdminLink={showAdminLink}
              pathname={pathname}
            />
          </div>
        </div>
      </div>
    </header>
  );
}

function MobileAccountMenu({
  currentUsername,
  currentAvatarUrl,
  showAdminLink,
  pathname
}: {
  currentUsername: string | null;
  currentAvatarUrl: string | null;
  showAdminLink: boolean;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  // NO useDismissOnBack here. This menu's items are <Link>s, and that hook's
  // cleanup calls history.back() when the menu closes — which, because the
  // menu closes as part of the click that starts the navigation, reverses the
  // in-flight App Router transition before it can commit. See the warning in
  // hooks/use-dismiss-on-back.ts. Radix still closes this on Escape and on
  // outside tap; Android Back leaving the page is the correct, expected
  // behaviour for a small anchored menu.
  const initial = currentUsername?.[0]?.toUpperCase() ?? "?";
  const { logout, isPending: logoutPending } = useSecureLogout();

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Account"
          title="Account"
          className="focus-ring grid h-11 w-11 place-items-center rounded-full border border-border/70"
        >
          <span className="relative grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-secondary text-sm font-semibold text-foreground dark:bg-white/[0.06]">
            <AccountAvatar src={currentAvatarUrl} initial={initial} />
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className={FLYOUT_CONTENT_CLASSNAME}
        >
          {currentUsername ? (
            <p className="truncate px-3 pb-1.5 pt-1 text-xs font-medium text-muted-foreground">
              @{currentUsername}
            </p>
          ) : null}
          <AccountMenuItem href="/profile" label="Profile" icon={UserRound} isActive={pathname === "/profile"} />
          <AccountMenuItem
            href="/settings"
            label="Settings"
            icon={Settings}
            isActive={pathname === "/settings" || pathname.startsWith("/settings/")}
          />
          <AccountMenuItem
            href="/billing"
            label="Membership"
            icon={CircleDollarSign}
            isActive={pathname === "/billing"}
          />
          <AccountMenuItem
            href="/help"
            label="Help and support"
            icon={HelpCircle}
            isActive={pathname === "/help"}
          />
          {showAdminLink ? (
            <AccountMenuItem
              href="/admin"
              label="Admin"
              icon={Gauge}
              isActive={pathname === "/admin" || pathname.startsWith("/admin/")}
            />
          ) : null}
          <DropdownMenu.Separator className="my-2 h-px bg-border/70 dark:bg-white/10" />
          <DropdownMenu.Item
            className={cn(flyoutItemClassName(false), "text-destructive")}
            disabled={logoutPending}
            onSelect={logout}
          >
            <LogOut className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            Log out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function AccountAvatar({ src, initial }: { src: string | null; initial: string }) {
  const [avatarRevision, setAvatarRevision] = useState(0);

  useEffect(() => {
    const handleAvatarUpdate = () => {
      setAvatarRevision(Date.now());
    };
    window.addEventListener("madbuddy:avatar-updated", handleAvatarUpdate);
    return () => window.removeEventListener("madbuddy:avatar-updated", handleAvatarUpdate);
  }, []);

  const isExternalAvatar = Boolean(src && !src.includes("/storage/v1/object/"));
  // The current-user endpoint is the canonical source for Mad Buddy uploads.
  // Trying it even when the layout's profile snapshot is missing keeps a
  // recently saved photo from falling back to "?" until another navigation.
  const resolvedSrc =
    isExternalAvatar && avatarRevision === 0
      ? src
      : `/api/profile/avatar${avatarRevision ? `?v=${avatarRevision}` : ""}`;

  return <UserAvatar src={resolvedSrc} name={initial} size="sm" decorative className="h-full w-full" />;
}

const createActions: Array<{
  href: ComponentProps<typeof Link>["href"];
  title: string;
  description: string;
  icon: LucideIcon;
  featureIcon: FeatureIconKey;
}> = [
  {
    href: "/plans?create=1",
    title: "New plan",
    description: "Create a hangout and invite Muddies",
    icon: CalendarCheck2,
    featureIcon: "plans"
  },
  {
    href: "/meeting-pings",
    title: "Meeting ping",
    description: "Ask a Muddy to meet up nearby",
    icon: Hand,
    featureIcon: "ping"
  },
  {
    href: "/moments",
    title: "Share a Moment",
    description: "Post a moment for your Muddies",
    icon: Sparkles,
    featureIcon: "moments"
  }
];

// Mobile-only labels for the five primary tabs. The desktop sidebar keeps the
// navigationItems labels (Friends, Notifications) for its tooltips; the
// product's mobile bottom bar uses the social-facing names.
const MOBILE_NAV_LABELS: Record<string, string> = {
  "/dashboard": "Home",
  "/friends": "Muddies",
  "/notifications": "Pulse",
  "/messages": "Messages",
  "/plans": "Plans"
};

function MobileNav({ navigationItems, unreadCount }: { navigationItems: NavigationItem[]; unreadCount: number }) {
  const pathname = usePathname();
  const mobileItems = navigationItems
    .filter((item) => item.href !== "/admin" && item.href !== "/billing")
    .slice(0, 5);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl dark:border-white/10 dark:bg-[#111112]/95 md:hidden"
      aria-label="Mobile navigation"
    >
      <ul className="mx-auto flex w-full max-w-[30rem] items-stretch justify-between px-1">
        {mobileItems.map((item) => {
          const isActive = isNavigationItemActive(item, pathname);
          const label = MOBILE_NAV_LABELS[item.href] ?? item.label;
          const ariaLabel =
            item.href === "/notifications"
              ? notificationAriaLabel(label, unreadCount)
              : label;

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                prefetch={false}
                // Stable targeting contract for guided tours. Derived from the
                // route, so a tour step never depends on a fragile positional
                // selector like :nth-child.
                data-tour-id={`nav-${item.href.slice(1)}`}
                aria-label={ariaLabel}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "safe-motion flex min-h-[56px] flex-col items-center justify-center gap-1 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="relative">
                  <NavItemIcon item={item} lucideClass="h-6 w-6" size={24} isActive={isActive} fillActive />
                  {item.href === "/notifications" ? <UnreadBadge count={unreadCount} /> : null}
                </span>
                <span className="text-[11px] font-medium leading-none">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Unwraps the wallpaper promise with use(), inside its own Suspense boundary
 * at the call site — so a slow/pending resolve suspends only this leaf, never
 * the header, <main>, or the destination page content around it.
 */
function WallpaperLayerAsync({ wallpaperPromise }: { wallpaperPromise: Promise<ResolvedWallpaper | null> }) {
  const wallpaper = use(wallpaperPromise);
  return <WallpaperLayer wallpaper={wallpaper} />;
}

/**
 * Renders the resolved wallpaper behind the content. Three modes:
 *  - ambient: the theme-adaptive masked SVG (default). Extremely subtle.
 *  - plain:   nothing — the raw design-system background.
 *  - image:   a bundled/managed/custom photo with a readability scrim so text,
 *             cards and glow stay legible above it. Light/dark variants switch
 *             via CSS. A failed image just shows the scrim over the base bg, so
 *             a broken URL never breaks the page.
 */
function WallpaperLayer({ wallpaper }: { wallpaper: ResolvedWallpaper | null }) {
  // Mounted as the first child of the header+main column (a sibling BEFORE
  // both), so normal DOM paint order already puts it behind them — no
  // z-index needed, and nothing here can end up painted behind the column's
  // own opaque background.
  //
  // On phones the document scrolls and <main> alone is only ~viewport tall, so
  // an absolute layer scoped to just <main> would end mid-page and leave a gap
  // when scrolling/overscrolling. Pin it to the viewport (`fixed`) on mobile so
  // it always fills the screen and stays put; on desktop the column is a fixed-
  // height panel (main scrolls internally), so keep it contained (`md:absolute`)
  // to that column — behind the header AND main, not the sidebar.
  const base = "fixed inset-0 md:absolute";
  const mode = wallpaper?.renderMode ?? "ambient";
  if (mode === "plain") return null;
  if (mode === "image") {
    const light = wallpaper?.lightUrl ?? wallpaper?.darkUrl ?? null;
    const dark = wallpaper?.darkUrl ?? wallpaper?.lightUrl ?? null;
    if (!light && !dark) return <div className={cn("app-wallpaper", base)} aria-hidden="true" />;
    return (
      <div className={cn(base, "overflow-hidden")} aria-hidden="true">
        <div
          className="app-wallpaper-image absolute inset-0"
          style={
            {
              "--wp-light": light ? `url("${light}")` : "none",
              "--wp-dark": dark ? `url("${dark}")` : "none"
            } as CSSProperties
          }
        />
        <div className="app-wallpaper-scrim absolute inset-0" />
      </div>
    );
  }
  return <div className={cn("app-wallpaper", base)} aria-hidden="true" />;
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-background bg-red-500 px-1 text-[10px] font-bold leading-none text-white" aria-hidden="true">
      {count > 99 ? "99+" : count}
    </span>
  );
}
