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
  Home,
  LogOut,
  MessagesSquare,
  MoreHorizontal,
  PartyPopper,
  Sparkles,
  Plus,
  Settings,
  UserPlus,
  UserRound,
  Users2,
  UsersRound
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { logoutAction } from "@/app/(auth)/actions";
import { LocationSignalSync } from "@/components/app-shell/location-signal-sync";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand/brand-mark";

// Order matters for MobileNav, which just takes the first five (minus
// admin/billing). Primary destinations are listed first so the bottom bar's
// slice keeps showing the same four the desktop sidebar treats as primary.
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
}> = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/friends", label: "Friends", icon: UsersRound },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/messages", label: "Messages", icon: MessagesSquare },
  { href: "/plans", label: "Plans", icon: CalendarCheck2 },
  { href: "/moments", label: "Moments", icon: Sparkles },
  { href: "/events", label: "Events", icon: PartyPopper },
  { href: "/groups", label: "Groups", icon: Users2 },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/billing", label: "Plan and billing", icon: CircleDollarSign }
];

const PRIMARY_HREFS = ["/dashboard", "/friends", "/notifications", "/messages"] as const;
const SECONDARY_HREFS = ["/plans", "/moments", "/events", "/groups", "/discover"] as const;

export type AppShellProps = {
  children: ReactNode;
  showAdminLink?: boolean;
  initialUnreadCount?: number;
  locationSyncEnabled?: boolean;
  currentUsername?: string | null;
};

export function AppShell({
  children,
  showAdminLink = false,
  initialUnreadCount = 0,
  locationSyncEnabled = true,
  currentUsername = null
}: AppShellProps) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const refreshUnreadCount = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", {
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) return;
      const data = (await response.json()) as { notifications: Array<{ is_read: boolean }> };
      setUnreadCount(data.notifications.filter((notification) => !notification.is_read).length);
    } catch {
      // Keep the last known count when the notification service is unavailable.
    }
  }, []);

  useEffect(() => {
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
    // 60s background cadence, paused while the tab is hidden — the focus and
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

  const visibleNavigationItems = showAdminLink
    ? [...navigationItems, { href: "/admin" as const, label: "Admin", icon: Gauge }]
    : navigationItems;

  return (
    <div className="min-h-screen bg-secondary/25 pb-24 dark:bg-[#353537] md:p-4 md:pb-4">
      <a
        href="#app-main-content"
        className="focus-ring sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:shadow-lg"
      >
        Skip to content
      </a>
      <LocationSignalSync initiallyEnabled={locationSyncEnabled} />
      <div className="md:grid md:h-[calc(100vh-2rem)] md:grid-cols-[4.75rem_minmax(0,1fr)] md:overflow-hidden md:rounded-[1.35rem] md:border md:border-border/80 md:bg-background md:shadow-[0_28px_90px_hsl(var(--shadow)/0.24)] dark:md:border-white/10 dark:md:bg-[#101011]">
      <DesktopSidebar
        navigationItems={visibleNavigationItems}
        unreadCount={unreadCount}
        currentUsername={currentUsername}
      />
        <div className="flex min-w-0 flex-col bg-background dark:bg-[#111112] md:min-h-0">
        <AppHeader
          navigationItems={visibleNavigationItems}
          currentUsername={currentUsername}
        />
          <main id="app-main-content" className="mx-auto w-full max-w-[1200px] px-4 pb-5 sm:px-6 lg:px-8 lg:pb-6 md:min-h-0 md:flex-1 md:overflow-y-auto">
          {children}
        </main>
        </div>
      </div>
      <MobileNav navigationItems={visibleNavigationItems} unreadCount={unreadCount} />
    </div>
  );
}

type NavigationItem = (typeof navigationItems)[number];

function isNavigationItemActive(item: NavigationItem, pathname: string) {
  return pathname === item.href ||
    (item.href === "/settings" && ["/settings", "/upgrade"].includes(pathname));
}

function DesktopSidebar({
  navigationItems,
  unreadCount,
  currentUsername
}: {
  navigationItems: NavigationItem[];
  unreadCount: number;
  currentUsername: string | null;
}) {
  const pathname = usePathname();
  const primaryItems = navigationItems.filter((item) => (PRIMARY_HREFS as readonly string[]).includes(item.href));
  const secondaryItems = navigationItems.filter((item) => (SECONDARY_HREFS as readonly string[]).includes(item.href));
  const adminItem = navigationItems.find((item) => item.href === "/admin");
  // Both flyouts share this so opening one always closes the other — two
  // independent open states would let both sit open simultaneously.
  const [openFlyout, setOpenFlyout] = useState<"more" | "account" | null>(null);

  return (
    <aside
      className="hidden border-r border-border/80 bg-card/70 dark:border-white/10 dark:bg-[#09090a] md:flex md:min-h-0 md:flex-col"
      aria-label="Main navigation"
    >
      <Link
        href="/dashboard"
        aria-label="Mad Buddy home"
        title="Mad Buddy home"
        className="focus-ring grid h-14 shrink-0 place-items-center border-b border-border/70 dark:border-white/10"
      >
        <BrandMark className="h-9 w-9" priority />
      </Link>

      {/* More lives in the same list as the primary items (not a separate
          group behind a divider) so all five icons share identical spacing —
          a divider here was reading as uneven gaps between Messages and
          More. The empty space this nav's flex-1 leaves before the account
          area at the bottom is the only separator now, by design. */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="Primary navigation">
        <ul className="flex flex-col items-center gap-3">
          {primaryItems.map((item) => {
            const isActive = isNavigationItemActive(item, pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={item.label}
                  title={item.label}
                  className="focus-ring grid h-11 w-11 place-items-center rounded-xl"
                >
                  <NavIconPill isActive={isActive}>
                    <item.icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
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
 * 12-16px radius, restrained shadow — not the heavier glass-panel used by
 * centred modals — 8px internal padding, 40-44px rows). */
const FLYOUT_CONTENT_CLASSNAME =
  "sidebar-flyout z-40 w-60 rounded-xl border border-border/80 bg-card p-2 shadow-lg outline-none dark:border-white/10 dark:bg-[#161617]";

function flyoutItemClassName(isActive: boolean) {
  return cn(
    "flex h-11 cursor-pointer select-none items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors",
    isActive
      ? "bg-primary/10 text-primary"
      : "text-foreground data-[highlighted]:bg-secondary dark:data-[highlighted]:bg-white/[0.06]"
  );
}

/**
 * Every sidebar trigger shares this: a 44px hit area (outer, unstyled) around
 * a slightly smaller pill (inner, this component) that actually carries the
 * hover/active colour. Sizing the visible state below the hit area — rather
 * than filling it edge to edge — is what keeps the active item from reading
 * as "bigger" than its neighbours, and a tinted bg-primary/12 rather than a
 * solid fill plus shadow is the "subtle, not a glow" active treatment.
 */
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
                <Link href={item.href} aria-current={isActive ? "page" : undefined}>
                  <item.icon className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
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
  adminItem,
  pathname,
  open,
  onOpenChange
}: {
  currentUsername: string | null;
  adminItem: NavigationItem | undefined;
  pathname: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const initial = currentUsername?.[0]?.toUpperCase() ?? "?";
  const logoutFormRef = useRef<HTMLFormElement>(null);
  const isCurrentRoute =
    pathname === "/profile" || pathname === "/settings" || pathname === "/billing" || pathname === "/admin";
  // The menu opening is itself a state worth showing, not just which route
  // you're on — otherwise clicking the avatar gives no visible feedback.
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
              "grid h-9 w-9 place-items-center rounded-full text-sm font-semibold transition-colors",
              isActive
                ? "bg-primary/12 text-primary"
                : "bg-secondary text-foreground hover:bg-secondary/80 dark:bg-white/[0.06]"
            )}
          >
            {initial}
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
          <AccountMenuItem href="/settings" label="Settings" icon={Settings} isActive={pathname === "/settings"} />
          <AccountMenuItem
            href="/billing"
            label="Plan and billing"
            icon={CircleDollarSign}
            isActive={pathname === "/billing"}
          />
          {adminItem ? (
            <AccountMenuItem href="/admin" label="Admin" icon={Gauge} isActive={pathname === "/admin"} />
          ) : null}
          <DropdownMenu.Separator className="my-2 h-px bg-border/70 dark:bg-white/10" />
          <DropdownMenu.Item
            className={cn(flyoutItemClassName(false), "text-destructive")}
            onSelect={() => logoutFormRef.current?.requestSubmit()}
          >
            <LogOut className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            Log out
          </DropdownMenu.Item>
          <form ref={logoutFormRef} action={logoutAction} className="hidden" />
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
  href: NavigationItem["href"];
  label: string;
  icon: LucideIcon;
  isActive: boolean;
}) {
  return (
    <DropdownMenu.Item asChild className={flyoutItemClassName(isActive)}>
      <Link href={href} aria-current={isActive ? "page" : undefined}>
        <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        {label}
      </Link>
    </DropdownMenu.Item>
  );
}

function AppHeader({
  navigationItems,
  currentUsername
}: {
  navigationItems: NavigationItem[];
  currentUsername: string | null;
}) {
  const pathname = usePathname();
  const activeItem = navigationItems.find((item) => item.href === pathname);
  const pageLabel = activeItem?.label ?? "App";
  const [createOpen, setCreateOpen] = useState(false);

  if (
    pathname === "/notifications" ||
    pathname === "/profile" ||
    pathname === "/settings" ||
    pathname === "/plans" ||
    pathname === "/messages" ||
    pathname === "/events" ||
    pathname === "/groups" ||
    pathname === "/discover" ||
    pathname === "/meeting-pings"
  ) {
    return null;
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/90 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-[#111112]/90">
      <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <BrandMark className="h-10 w-10 md:hidden" priority />
        <div className="mr-auto min-w-0">
          {pathname !== "/dashboard" && pathname !== "/friends" ? (
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {pageLabel}
            </p>
          ) : null}
          <h1 className="truncate text-lg font-semibold sm:text-xl">
            {pathname === "/dashboard" ? "Home" : pathname === "/friends" ? "Friends" : "Mad Buddy"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setCreateOpen(true)}
            aria-label="Create"
            title="Create"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </Button>
          {currentUsername ? (
            // Visible only in the sm-md gap, where the desktop sidebar (md+)
            // isn't rendered yet but the header still is — below sm the
            // mobile bottom nav covers it; at md+ the sidebar's own account
            // menu already goes here, so showing both would be a duplicate
            // destination in the same viewport.
            <Link
              href="/profile"
              className="focus-ring hidden h-10 w-10 place-items-center rounded-full border border-border/70 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:grid md:hidden"
              aria-label={`Signed in as @${currentUsername}`}
              title={`Signed in as @${currentUsername}`}
            >
              <UserRound className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
          <form action={logoutAction} className="md:hidden">
            <Button type="submit" variant="ghost" size="sm" aria-label="Log out" title="Log out">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Log out</span>
            </Button>
          </form>
        </div>
      </div>
      <CreateMenu open={createOpen} onOpenChange={setCreateOpen} />
    </header>
  );
}

function CreateMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Create" compact>
      <div className="grid gap-2">
        <Button asChild variant="outline" className="h-auto justify-start gap-3 py-3" onClick={() => onOpenChange(false)}>
          <Link href="/plans?create=1">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <CalendarCheck2 className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-left">
              <span className="block text-sm font-semibold">New Plan</span>
              <span className="block text-xs text-muted-foreground">Create a hangout and invite Muddies</span>
            </span>
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-auto justify-start gap-3 py-3" onClick={() => onOpenChange(false)}>
          <Link href="/friends?tab=add">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-left">
              <span className="block text-sm font-semibold">Add a Muddy</span>
              <span className="block text-xs text-muted-foreground">Search by username and send a request</span>
            </span>
          </Link>
        </Button>
      </div>
    </Modal>
  );
}

function MobileNav({ navigationItems, unreadCount }: { navigationItems: NavigationItem[]; unreadCount: number }) {
  const pathname = usePathname();
  const mobileItems = navigationItems
    .filter((item) => item.href !== "/admin" && item.href !== "/billing")
    .slice(0, 5);

  return (
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 px-3 md:hidden"
      aria-label="Mobile navigation"
    >
      <div className="pointer-events-auto mx-auto flex w-full max-w-[34rem] items-center justify-center gap-1.5 rounded-full border border-white/10 bg-black/95 p-2 text-white shadow-[0_22px_65px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:gap-2 sm:p-2.5">
        {mobileItems.map((item) => {
          const isActive = isNavigationItemActive(item, pathname);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              title={item.label}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "safe-motion relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80",
                "flex h-11 min-w-0 items-center justify-center rounded-full text-sm font-medium sm:h-12 sm:text-base",
                isActive
                  ? "flex-1 gap-2 border border-white/5 bg-[#292929] px-3 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:px-5"
                  : "w-11 shrink-0 text-white/85 hover:bg-white/[0.08] hover:text-white sm:w-12"
              )}
            >
              <span
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-xl",
                  isActive && "bg-white text-black"
                )}
              >
                <item.icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
                {item.href === "/notifications" ? <UnreadBadge count={unreadCount} /> : null}
              </span>
              {isActive ? <span className="truncate">{item.label}</span> : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-background bg-red-500 px-1 text-[10px] font-bold leading-none text-white" aria-hidden="true">
      {count > 99 ? "99+" : count}
    </span>
  );
}
