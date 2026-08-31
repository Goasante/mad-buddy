"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { Route } from "next";
import dynamic from "next/dynamic";
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
  MessageCircle,
  Plus,
  Settings,
  UserRound,
  Users,
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
import { MadBuddyOrb, ORB_HOME_HREF } from "@/components/app-shell/mad-buddy-orb";
import { QuickActionsLauncher } from "@/components/app-shell/quick-actions-launcher";
import { showsQuickActions } from "@/lib/navigation/quick-actions";
import { ImmersiveModeProvider, useImmersiveMode } from "@/components/app-shell/immersive-mode";
import { bindCachesToSession } from "@/lib/cache/session-binding";
import type { FeatureIconKey } from "@/lib/icons/feature-icons";
import type { ResolvedWallpaper } from "@/lib/wallpapers/catalog";
import { BrandMark } from "@/components/brand/brand-mark";
import { BrandNavigationIcon } from "@/components/brand/brand-navigation-icon";
import type { BrandNavigationIconName } from "@/lib/brand/assets";
import { useUnreadNotificationCount } from "@/hooks/use-unread-notification-count";
import { useIncomingRequestCount } from "@/hooks/use-incoming-request-count";
import { useUnreadMessageCount } from "@/hooks/use-unread-message-count";
import { UnreadNotificationProvider } from "@/hooks/unread-notification-context";
import { AppMenuProvider } from "@/hooks/app-menu-context";
import { HomeSettingsSheet } from "@/components/dashboard/home-settings-sheet";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import { NavigationWatchdog } from "@/components/navigation/navigation-watchdog";

// Camera code is intentionally absent from the normal Home bundle. The chunk
// is requested only after an already-active Home control is deliberately
// selected, and the fallback covers the viewport immediately while it loads.
const LazyCameraComposer = dynamic(
  () => import("@/components/camera/camera-composer").then((module) => module.CameraComposer),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-[120] grid h-[100dvh] place-items-center bg-[#080706] text-sm text-[#FEFBF3]" role="status">
        Opening camera
      </div>
    )
  }
);

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
  /** Approved state-specific raster artwork for the supplied nav destinations. */
  brandIcon?: BrandNavigationIconName;
}> = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/friends", label: "Muddies", icon: UsersRound },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/messages", label: "Messages", icon: MessagesSquare },
  { href: "/plans", label: "Plans", icon: CalendarCheck2, featureIcon: "plans" },
  { href: "/moments", label: "Moments", icon: Sparkles, featureIcon: "moments" },
  { href: "/events", label: "Events", icon: PartyPopper, featureIcon: "events" },
  { href: "/groups", label: "Circles", icon: Users2, featureIcon: "groups" },
  { href: "/discover", label: "Linkr", icon: Compass, brandIcon: "linkr" },
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
// Routes that render the canonical MobilePageHeader themselves. The global
// AppHeader must stand down for each, or the route would carry two headers.
const PAGES_WITH_OWN_HEADER = [
  "/dashboard",
  "/friends",
  "/notifications",
  "/profile",
  "/settings",
  "/plans",
  "/messages",
  "/events",
  "/groups",
  "/discover",
  "/meeting-pings",
  "/moments",
  "/billing",
  "/buddy-score",
  "/reminders",
  "/invites",
  "/drops",
  "/scan",
  "/safe-arrival",
  // Migrated to the canonical header in the Stage 2 header pass. Each of these
  // renders <PageHeader> itself, so the global AppHeader must stand down or
  // the screen would show two bars.
  "/badges",
  "/help",
  "/invite",
  "/safety-center",
  "/hangout-mode"
] as const;

/**
 * Immersive routes draw their own header INLINE (not fixed), directly over a
 * full-bleed background.
 *
 * They still stand the global AppHeader down — they are in the list above —
 * but <main> must NOT reserve --mobile-header-height for them: there is no
 * fixed header to reserve space for, so the reservation would render as an
 * empty band above the page's own title. These pages clear the safe area
 * themselves, exactly once.
 */
// Pages that draw their own header INLINE rather than taking the fixed
// canonical bar. They belong here as well as in the list above: reserving
// --mobile-header-height for a header the page draws itself renders as an
// empty band under the notch, because the inset is then paid for twice — once
// by this offset and once by the page's own header.
//
// Each of these clears the safe area itself, exactly once.
//
// /hangout-mode joined when UpFor took an inline header carrying a subtitle
// and its own actions. It was already in PAGES_WITH_OWN_HEADER but not here,
// which is precisely the gap that produced the blank band above the title.
const IMMERSIVE_HEADER_PAGES: readonly string[] = ["/discover", "/hangout-mode"];

function hasOwnHeader(pathname: string): boolean {
  return PAGES_WITH_OWN_HEADER.some((href) => pathname === href || pathname.startsWith(`${href}/`));
}

/**
 * Where the branded wallpaper appears.
 *
 * Messages only. A conversation is the one place the backdrop reads as the
 * room the chat happens in; everywhere else it sits behind cards and numbers
 * that need a plain ground to be legible.
 */
const WALLPAPER_PAGES: readonly string[] = ["/messages"];

function hasWallpaper(pathname: string): boolean {
  return WALLPAPER_PAGES.some((href) => pathname === href || pathname.startsWith(`${href}/`));
}

function hasImmersiveHeader(pathname: string): boolean {
  return IMMERSIVE_HEADER_PAGES.some((href) => pathname === href || pathname.startsWith(`${href}/`));
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
   * Mad Cam (paused). Resolved server-side by the layout; when false the
   * camera launcher and its lazy chunk never mount. The camera implementation
   * itself is untouched and returns as soon as the flag is on.
   */
  madCamEnabled?: boolean;
  /**
   * Identity for the app-wide menu sheet, resolved once by the layout.
   *
   * The sheet is mounted here rather than per screen, so any page's header
   * can open it through AppMenuProvider without receiving these props itself.
   */
  currentDisplayName?: string;
  subscriptionPlan?: SubscriptionPlan | null;
  buddyScoreLevelLabel?: string | null;
  profileCompletionPercent?: number;
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

/**
 * Wraps the shell in ImmersiveModeProvider so the bottom navigation and the
 * screens that hide it read the same flag. Kept as a thin wrapper rather than
 * moving the provider higher, so the flag cannot outlive the shell.
 */
export function AppShell(props: AppShellProps) {
  return (
    <ImmersiveModeProvider>
      <AppShellInner {...props} />
    </ImmersiveModeProvider>
  );
}

function AppShellInner({
  children,
  showAdminLink = false,
  initialUnreadCount = 0,
  locationSyncEnabled = true,
  currentUsername = null,
  currentAvatarUrl = null,
  currentUserId = null,
  hiddenNavigationHrefs = [],
  madCamEnabled = false,
  currentDisplayName = "",
  subscriptionPlan = null,
  buddyScoreLevelLabel = null,
  profileCompletionPercent = 0,
  wallpaperPromise = resolvedDefaultWallpaper
}: AppShellProps) {
  // One menu sheet for the whole authenticated app.
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const { immersive } = useImmersiveMode();

  // Clear the client caches whenever the session ends — in this tab or any
  // other. Mounted once here rather than per screen, so no surface can be left
  // rendering a previous account's metadata.
  useEffect(() => bindCachesToSession(), []);
  const pathname = usePathname();
  const openCameraFromHome = useCallback(() => {
    // Mad Cam paused: the home-tab reselect gesture does nothing rather than
    // opening a feature that is switched off.
    if (!madCamEnabled) return;
    if (pathname === ORB_HOME_HREF) setCameraOpen(true);
  }, [madCamEnabled, pathname]);
  const closeCamera = useCallback(() => setCameraOpen(false), []);

  useEffect(() => {
    if (!cameraOpen || pathname === ORB_HOME_HREF) return;
    const frame = window.requestAnimationFrame(() => setCameraOpen(false));
    return () => window.cancelAnimationFrame(frame);
  }, [cameraOpen, pathname]);
  const immersiveHeader = hasImmersiveHeader(pathname);
  const showsWallpaper = hasWallpaper(pathname);
  /* Reserve space for the launcher only where the launcher actually is.
   *
   * The SAME predicate the launcher renders itself from, so the space and the
   * pill can never disagree: Safe Arrival and open conversations exclude it
   * deliberately, and reserving its footprint there would leave a dead strip
   * under a page that has no pill above it. */
  const reservesQuickActions = !immersive && showsQuickActions(pathname);
  // Canonical unread count, shared with the mobile header via the same hook —
  // one fetch/poll/broadcast implementation, so the sidebar badge and the
  // header Bell badge can never disagree.
  const { unreadCount, refresh: refreshUnreadCount } = useUnreadNotificationCount(initialUnreadCount);
  const { unreadCount: messageUnreadCount } = useUnreadMessageCount(currentUserId);
  const { requestCount: muddyRequestCount } = useIncomingRequestCount(currentUserId);
  const hasCompletedInitialRender = useRef(false);

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

  const enabledNavigationItems = navigationItems.filter((item) => !hiddenNavigationHrefs.includes(item.href));
  const visibleNavigationItems = showAdminLink
    ? [...enabledNavigationItems, { href: "/admin" as const, label: "Admin", icon: Gauge }]
    : enabledNavigationItems;
  /**
   * The Create menu obeys the same pause list as the navigation.
   *
   * A paused feature was removed from the nav but kept its entry here, so with
   * Moments off the Create menu still offered "Share a Moment" -- a CTA whose
   * only outcome is /moments redirecting straight back out. Filtering both
   * from one list means pausing a feature closes every door to it, not just
   * the one in the sidebar.
   */
  const visibleCreateActions = createActionDefinitions.filter(
    (action) => !hiddenNavigationHrefs.some((href) => String(action.href).startsWith(href))
  );
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
    // Bottom padding reserves the fixed nav's real footprint so the last
    // section of any page stays fully reachable. --mobile-nav-height is the
    // bar's own height (content only); the safe-area inset is added here
    // because the bar pads itself by that same amount internally.
    <div
      className={cn(
        "flex min-h-[100svh] min-h-[100dvh] flex-col bg-background dark:bg-[#111112] md:block md:bg-secondary/25 md:p-4 md:pb-4 dark:md:bg-[#353537]",
        // Immersive (a conversation is open): the bar is gone, so the page
        // must not keep reserving its height or a dead strip is left behind.
        immersive
          ? "pb-0"
          : "pb-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px))]",
        "md:pb-4"
      )}
    >
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
        messageUnreadCount={messageUnreadCount}
        muddyRequestCount={muddyRequestCount}
        currentUsername={currentUsername}
        currentAvatarUrl={currentAvatarUrl}
        onHomeReselect={openCameraFromHome}
      />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background dark:bg-[#111112]">
        {/* Branded wallpaper — MESSAGES ONLY.
            It was mounted shell-wide, so every screen carried a decorative
            backdrop. A conversation is the one surface where a wallpaper is
            the content's own setting rather than noise behind unrelated data:
            Home, Linkr and UpFor are dense with cards, counts and controls,
            and a patterned ground competes with all of it.

            Still mounted at THIS level rather than inside <main>, so the
            header's translucent background shows the same wallpaper instead
            of sitting on it as a flat, non-blending bar. Purely decorative. */}
        {showsWallpaper ? (
          <Suspense fallback={<WallpaperLayer wallpaper={null} />}>
            <WallpaperLayerAsync wallpaperPromise={wallpaperPromise} />
          </Suspense>
        ) : null}
        <AppHeader
          currentUsername={currentUsername}
          currentAvatarUrl={currentAvatarUrl}
          showAdminLink={showAdminLink}
          createActions={visibleCreateActions}
        />
          <main
          id="app-main-content"
          className={cn(
            /* The bottom inset belongs HERE, on the element that scrolls.
             *
             * The outer shell already reserves the bar's footprint, but <main>
             * is flex-1 and owns the scroll on mobile -- so that reservation
             * sits outside the scrolling box and the final card still slides
             * under the fixed bar. `pb-5` alone was 1.25rem against a 5rem bar
             * plus the device inset.
             *
             * Computed from the same canonical variables the bar itself uses,
             * never a per-device magic number: --mobile-nav-height is the bar's
             * own height and the safe-area inset is what it pads itself by.
             * Desktop has no bottom bar, so md: returns to ordinary spacing.
             *
             * THE FLOATING LAUNCHER IS RESERVED FOR HERE TOO.
             *
             * The bar's height was cleared but the Quick Actions pill above it
             * was not, so the last 3.25rem of every scrolling page ended
             * underneath a fixed control -- a primary CTA could come to rest
             * beneath it and be unreadable, or swallow the tap outright. This
             * is the one place a page's bottom inset is decided, so the fix
             * belongs here rather than as a margin on whichever screen the
             * collision was noticed. --quick-actions-reserve carries the
             * pill's own geometry, and collapses to ordinary spacing on
             * desktop where the pill sits clear of the content column. */
            "relative flex-1 px-4 sm:px-6 lg:px-8 lg:pb-6 md:min-h-0 md:overflow-y-auto md:pt-0",
            immersive
              ? // The bar has stepped aside, so reserving its height would
                // leave a dead strip under an open conversation. The launcher
                // is hidden while immersive, so its reserve goes too.
                "pb-5"
              : reservesQuickActions
                ? "pb-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px)+var(--quick-actions-reserve))] md:pb-5"
                : "pb-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px)+1.25rem)] md:pb-5",
            // Both mobile headers are FIXED (out of normal flow), so <main>
            // reserves the matching footprint here — the one place either
            // offset is computed, so no page needs its own top-padding guess
            // and no spacer element is ever required.
            //
            //   - global AppHeader  -> --app-header-height
            //   - MobilePageHeader  -> --mobile-header-height (md:pt-0, since
            //     that header is mobile-only and desktop shows its own title)
            //
            // Each variable already includes the safe-area inset, and the
            // header itself pads by that same inset internally — so the notch
            // is cleared once by the header and reserved once here, never
            // doubled into a visible gap.
            hasGlobalHeader
              ? "pt-[var(--app-header-height)]"
              : immersiveHeader
                // The page's own inline header clears the notch itself, so
                // reserving a fixed header's footprint here would be a second,
                // visible gap above the title.
                ? "pt-0"
                : "pt-[var(--mobile-header-height)] md:pt-0"
          )}
        >
          {/* One pull-to-refresh for the whole authenticated app, mounted here
              rather than repeated per page. It re-runs the server render and
              notifies any page that keeps canonical data in client state. */}
          <PullToRefresh>
            {/* Pages read the shell's already-resolved unread count from here
                rather than starting their own poller. */}
            <UnreadNotificationProvider count={unreadCount}>
              {/* Any screen's header Menu button opens the one sheet mounted
                  below, so no page needs its own copy or its identity props. */}
              <AppMenuProvider openMenu={() => setAppMenuOpen(true)}>
                <div className="mx-auto w-full max-w-[1200px]">{children}</div>
              </AppMenuProvider>
            </UnreadNotificationProvider>
          </PullToRefresh>
        </main>
        </div>
      </div>
      <MobileNav
        immersive={immersive}
        onHomeReselect={openCameraFromHome}
        messageUnreadCount={messageUnreadCount}
        muddyRequestCount={muddyRequestCount}
      />

      {/* Quick Actions — mounted ONCE, here, for the whole app.
          Route visibility is decided inside the component by the single rule
          in lib/navigation/quick-actions, so no page mounts its own copy and
          there can never be two launchers on screen. Hidden while immersive
          (a conversation is open), where the composer owns the lower right. */}
      {immersive ? null : <QuickActionsLauncher />}

      {/* The app-wide menu sheet. Mounted once here — every screen's header
          Menu opens this same instance through AppMenuProvider. */}
      <HomeSettingsSheet
        open={appMenuOpen}
        onOpenChange={setAppMenuOpen}
        displayName={currentDisplayName}
        currentUsername={currentUsername}
        currentAvatarUrl={currentAvatarUrl}
        subscriptionPlan={subscriptionPlan}
        buddyScoreLevelLabel={buddyScoreLevelLabel}
        profileCompletionPercent={profileCompletionPercent}
        // Same server-resolved flag the sidebar's Admin item already uses, so
        // the two entry points can never disagree about who is staff.
        showAdminLink={showAdminLink}
      />
      {madCamEnabled && cameraOpen ? <LazyCameraComposer onClose={closeCamera} /> : null}
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

function isModifiedNavigationClick(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
}) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

function notificationAriaLabel(label: string, unreadCount: number) {
  return unreadCount > 0 ? `${label}, ${unreadCount} unread` : label;
}

function DesktopSidebar({
  navigationItems,
  unreadCount,
  messageUnreadCount,
  muddyRequestCount,
  currentUsername,
  currentAvatarUrl,
  onHomeReselect
}: {
  navigationItems: NavigationItem[];
  unreadCount: number;
  messageUnreadCount: number;
  muddyRequestCount: number;
  currentUsername: string | null;
  currentAvatarUrl: string | null;
  onHomeReselect: () => void;
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
        onClick={(event) => {
          if (pathname !== ORB_HOME_HREF || isModifiedNavigationClick(event)) return;
          event.preventDefault();
          onHomeReselect();
        }}
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
                : item.href === "/messages"
                  ? notificationAriaLabel(item.label, messageUnreadCount)
                  : // A count nobody can hear is a count only sighted users get.
                    item.href === "/friends"
                    ? notificationAriaLabel(item.label, muddyRequestCount)
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
                  onClick={(event) => {
                    if (item.href !== ORB_HOME_HREF || !isActive || isModifiedNavigationClick(event)) return;
                    event.preventDefault();
                    onHomeReselect();
                  }}
                >
                  <NavIconPill isActive={isActive}>
                    <NavItemIcon item={item} lucideClass="h-5 w-5" size={20} isActive={isActive} />
                    {item.href === "/notifications" ? <UnreadBadge count={unreadCount} /> : null}
                    {item.href === "/messages" ? <UnreadBadge count={messageUnreadCount} /> : null}
                    {/* Pending Muddy requests. Clears when each is accepted or
                        declined -- the same badge language as Messages, so one
                        tab does not behave unlike the other. */}
                    {item.href === "/friends" ? <UnreadBadge count={muddyRequestCount} /> : null}
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
  if (item.brandIcon) {
    return <BrandNavigationIcon name={item.brandIcon} active={isActive} size={size} className={lucideClass} />;
  }
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
  showAdminLink,
  createActions: visibleCreateActions
}: {
  currentUsername: string | null;
  currentAvatarUrl: string | null;
  showAdminLink: boolean;
  /**
   * Already filtered by the shell's pause list, so a paused feature cannot be
   * offered here. Passed in rather than read from the module constant: the
   * flags live on the shell, and a second copy of that logic in this component
   * is exactly how the nav and the Create menu drifted apart in the first
   * place.
   */
  createActions: typeof createActionDefinitions;
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
                {visibleCreateActions.map((action) => (
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

export function MobileAccountMenu({
  currentUsername,
  currentAvatarUrl,
  showAdminLink,
  pathname,
  trigger,
  align = "end"
}: {
  currentUsername: string | null;
  currentAvatarUrl: string | null;
  showAdminLink: boolean;
  pathname: string;
  /** Overrides the default avatar-circle trigger (e.g. a hamburger icon). */
  trigger?: ReactNode;
  align?: "start" | "end";
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
        {trigger ?? (
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
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          align={align}
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

const createActionDefinitions: Array<{
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

/**
 * The app's single mobile bottom bar. Five fixed slots, identical for every
 * user — Messages, Muddies, the Mad Buddy Orb, Plans, Me:
 *
 *  - One nav, no variants. There used to be a separate "first-time" bar with
 *    a different tab set, which meant the bar a user learned on day one was
 *    not the bar they had on day thirty. Position is now stable for life.
 *  - The centre is the Mad Buddy Orb, and the Orb IS Home. It replaced the
 *    raised Create button: a "+" that opened a menu duplicated actions that
 *    already have homes (a plan starts on /plans, a Moment on /moments, a
 *    ping in a conversation), so the menu was a second route to places the
 *    app already had. Home moved into it because Home is the centre of the
 *    experience, not one tab among five.
 *  - Messages takes the left-most slot. It is where a conversation actually
 *    continues, and it is the destination people return to most.
 *  - "Me" is the personal hub entry. It points at the existing /profile
 *    route; no new or unsupported destination is introduced here.
 *
 * Lucide icons only, one size (26px) and one stroke weight, so the bar reads
 * as a single system. The active tab gets a filled pill plus its label; the
 * rest stay icon-only, which keeps the bar quiet and the current location
 * unmistakable. The Orb carries no glyph at all — see MadBuddyOrb.
 */
/**
 * The four bottom-bar destinations, split two either side of the Orb.
 *
 * Plans and Profile were removed rather than demoted: Plans already has a
 * section on Home, and Profile is reachable from the account sheet the header
 * menu opens — so both were paying for a permanent tab they did not need.
 * Linkr and UpFor have no other persistent entry point, which is what earns
 * them the slot.
 *
 * Typed to accept a custom brand mark alongside a Lucide icon: both honour the
 * same props contract, so the tab renderer needs no branch.
 */
/** A Lucide icon or a brand mark: both take className and render an svg. */
type MobileTab = {
  href: Route;
  label: string;
  icon: LucideIcon;
  brandIcon?: BrandNavigationIconName;
};

const MOBILE_TABS: MobileTab[] = [
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/friends", label: "Muddies", icon: Users },
  { href: "/discover", label: "Linkr", icon: Compass, brandIcon: "linkr" },
  { href: "/hangout-mode", label: "UpFor", icon: Hand, brandIcon: "upfor" }
];

function MobileNav({
  immersive = false,
  onHomeReselect,
  messageUnreadCount = 0,
  muddyRequestCount = 0
}: {
  immersive?: boolean;
  onHomeReselect: () => void;
  messageUnreadCount?: number;
  muddyRequestCount?: number;
}) {
  const pathname = usePathname();

  // The Orb sits in the middle; the four destinations split around it.
  const leftTabs = MOBILE_TABS.slice(0, 2);
  const rightTabs = MOBILE_TABS.slice(2);
  const homeActive = isNavigationItemActive(
    { href: ORB_HOME_HREF, label: "Home", icon: Home } as NavigationItem,
    pathname
  );

  return (
    // Attached to the bottom of the app, not floating above it: full width,
    // no outer horizontal padding, no bottom gap, and the safe-area inset
    // applied as padding INSIDE the bar so its surface reaches the screen
    // edge on a device with a home indicator rather than leaving a strip of
    // page showing beneath it.
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-background/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl dark:border-white/10 dark:bg-[#151517]/95 md:hidden",
        // Immersive: slide down and fade rather than disappearing, so opening
        // a conversation reads as the bar stepping aside. Hidden from
        // assistive tech and taken out of the tab order at the same time —
        // an off-screen bar must not be focusable.
        "transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none",
        immersive ? "pointer-events-none translate-y-full opacity-0" : "translate-y-0 opacity-100"
      )}
      // Genuinely gone while immersive, not merely invisible.
      aria-hidden={immersive || undefined}
      inert={immersive || undefined}
      aria-label="Mobile navigation"
    >
      <ul className="mx-auto flex w-full max-w-[30rem] items-stretch justify-between px-1.5">
        {leftTabs.map((tab) => (
          <MobileNavTab
            key={tab.href}
            tab={tab}
            pathname={pathname}
            messageUnreadCount={tab.href === "/messages" ? messageUnreadCount : 0}
            muddyRequestCount={tab.href === "/friends" ? muddyRequestCount : 0}
          />
        ))}

        <li className="flex-1 py-2">
          <MadBuddyOrb
            isActive={homeActive}
            onHomeReselect={onHomeReselect}
          />
        </li>

        {rightTabs.map((tab) => (
          <MobileNavTab
            key={tab.href}
            tab={tab}
            pathname={pathname}
            messageUnreadCount={tab.href === "/messages" ? messageUnreadCount : 0}
            muddyRequestCount={tab.href === "/friends" ? muddyRequestCount : 0}
          />
        ))}
      </ul>
    </nav>
  );
}

function MobileNavTab({
  tab,
  pathname,
  messageUnreadCount = 0,
  muddyRequestCount = 0
}: {
  tab: MobileTab;
  pathname: string;
  messageUnreadCount?: number;
  muddyRequestCount?: number;
}) {
  // Reuses the shared route-matching rule so a tab stays lit on nested
  // routes (/friends/someone, /plans/123) exactly like the desktop sidebar.
  const isActive = isNavigationItemActive({ href: tab.href, label: tab.label, icon: tab.icon } as NavigationItem, pathname);
  const Icon = tab.icon;

  return (
    <li className="flex-1 py-2">
      <Link
        href={tab.href}
        prefetch={false}
        // Stable targeting contract for guided tours. Derived from the route,
        // so a tour step never depends on a fragile positional selector.
        data-tour-id={`nav-${tab.href.slice(1)}`}
        aria-label={tab.label}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "safe-motion flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          "active:scale-95 motion-reduce:active:scale-100"
        )}
      >
        <span
          className={cn(
            "relative grid h-10 w-10 place-items-center rounded-full transition-colors duration-200 ease-out motion-reduce:transition-none",
            isActive ? "bg-primary/12 text-primary" : "text-muted-foreground"
          )}
        >
          {tab.brandIcon ? (
            <BrandNavigationIcon name={tab.brandIcon} active={isActive} size={26} />
          ) : (
            <Icon
              className="h-[26px] w-[26px]"
              strokeWidth={isActive ? 2.25 : 1.75}
              aria-hidden="true"
            />
          )}
          {tab.href === "/messages" && messageUnreadCount > 0 ? <UnreadBadge count={messageUnreadCount} /> : null}
          {tab.href === "/friends" && muddyRequestCount > 0 ? <UnreadBadge count={muddyRequestCount} /> : null}
        </span>
        {isActive ? (
          <span className="text-[10px] font-medium leading-none tracking-wide text-primary">{tab.label}</span>
        ) : null}
      </Link>
    </li>
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
