"use client";

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
  PartyPopper,
  Plus,
  Settings,
  UserPlus,
  UserRound,
  Users2,
  UsersRound
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { logoutAction } from "@/app/(auth)/actions";
import { LocationSignalSync } from "@/components/app-shell/location-signal-sync";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand/brand-mark";

const navigationItems: Array<{
  href:
    | "/dashboard"
    | "/friends"
    | "/notifications"
    | "/plans"
    | "/profile"
    | "/messages"
    | "/events"
    | "/groups"
    | "/discover"
    | "/settings"
    | "/billing"
    | "/admin";
  label: string;
  icon: LucideIcon;
}> = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/friends", label: "Muddies", icon: UsersRound },
  { href: "/notifications", label: "Pulse", icon: Bell },
  { href: "/plans", label: "Plans", icon: CalendarCheck2 },
  { href: "/profile", label: "You", icon: UserRound },
  { href: "/messages", label: "Messages", icon: MessagesSquare },
  { href: "/events", label: "Events", icon: PartyPopper },
  { href: "/groups", label: "Groups", icon: Users2 },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/billing", label: "Billing", icon: CircleDollarSign }
];

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
    const interval = window.setInterval(refreshUnreadCount, 10_000);
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
      <div className="md:grid md:min-h-[calc(100vh-2rem)] md:grid-cols-[5.25rem_minmax(0,1fr)] md:overflow-hidden md:rounded-[1.35rem] md:border md:border-border/80 md:bg-background md:shadow-[0_28px_90px_hsl(var(--shadow)/0.24)] dark:md:border-white/10 dark:md:bg-[#101011]">
      <DesktopSidebar
        navigationItems={visibleNavigationItems}
        unreadCount={unreadCount}
        currentUsername={currentUsername}
      />
        <div className="min-w-0 bg-background dark:bg-[#111112]">
        <AppHeader
          navigationItems={visibleNavigationItems}
          unreadCount={unreadCount}
          currentUsername={currentUsername}
        />
          <main id="app-main-content" className="mx-auto w-full max-w-[1200px] px-4 pb-5 sm:px-6 lg:px-8 lg:pb-6">
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
  const socialItems = navigationItems.filter((item) =>
    [
      "/dashboard",
      "/friends",
      "/notifications",
      "/plans",
      "/profile",
      "/messages",
      "/events",
      "/groups",
      "/discover",
      "/settings"
    ].includes(item.href)
  );
  const adminItem = navigationItems.find((item) => item.href === "/admin");

  return (
    <aside className="hidden border-r border-border/80 bg-card/70 dark:border-white/10 dark:bg-[#09090a] md:flex md:min-h-0 md:flex-col" aria-label="Main navigation">
      <Link
        href="/dashboard"
        aria-label="Mad Buddy dashboard"
        className="focus-ring grid h-20 place-items-center border-b border-border/70 dark:border-white/10"
      >
        <BrandMark className="h-11 w-11" priority />
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="Social navigation">
            <ul className="space-y-2">
              {socialItems.map((item) => {
                const isActive = isNavigationItemActive(item, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      aria-label={item.label}
                      title={
                        item.href === "/profile" && currentUsername
                          ? `Profile, signed in as @${currentUsername}`
                          : item.label
                      }
                      className={cn(
                        "focus-ring relative grid h-11 w-11 place-items-center rounded-xl transition-colors motion-reduce:transition-none",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-[0_8px_24px_hsl(var(--primary)/0.28)]"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground dark:hover:bg-white/[0.05]"
                      )}
                    >
                      <item.icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
                      {item.href === "/notifications" ? <UnreadBadge count={unreadCount} /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
      </nav>

      <div className="space-y-2 border-t border-border/70 p-3 dark:border-white/10">
        <div id="sidebar-subscription-status" />
        {adminItem ? (
          <Link
            href="/admin"
            aria-label="Admin"
            title="Admin"
            className={cn(
              "focus-ring grid h-11 w-11 place-items-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground",
              pathname === "/admin" && "bg-primary text-primary-foreground"
            )}
          >
            <Gauge className="h-5 w-5" aria-hidden="true" />
          </Link>
        ) : null}
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="icon" className="h-11 w-11" aria-label="Log out" title="Log out">
            <LogOut className="h-5 w-5" aria-hidden="true" />
          </Button>
        </form>
      </div>
    </aside>
  );
}

function AppHeader({
  navigationItems,
  unreadCount,
  currentUsername
}: {
  navigationItems: NavigationItem[];
  unreadCount: number;
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
    pathname === "/discover"
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
            {pathname === "/dashboard" ? "Home" : pathname === "/friends" ? "Muddies" : "Mad Buddy"}
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
            <Link
              href="/profile"
              className="focus-ring hidden h-10 w-10 place-items-center rounded-full border border-border/70 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:grid"
              aria-label={`Signed in as @${currentUsername}`}
              title={`Signed in as @${currentUsername}`}
            >
              <UserRound className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
          <Button type="button" variant="outline" size="sm" asChild>
            <Link className="relative" href="/notifications" aria-label={unreadCount > 0 ? `Pulse, ${unreadCount} unread` : "Pulse"} title="Pulse">
              <Bell className="h-4 w-4" aria-hidden="true" />
              <UnreadBadge count={unreadCount} />
            </Link>
          </Button>
          <form action={logoutAction} className="md:hidden">
            <Button type="submit" variant="ghost" size="sm">
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
                <item.icon className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
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
