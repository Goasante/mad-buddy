"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Bell,
  CalendarCheck2,
  CircleDollarSign,
  Gauge,
  Hand,
  HelpCircle,
  LogOut,
  Plus,
  Settings,
  UserRound,
  type LucideIcon
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { UserAvatar } from "@/components/ui/user-avatar";
import type { FeatureIconKey } from "@/lib/icons/feature-icons";
import { Link, usePathname, type LinkProps } from "@/lib/platform";
import { cn } from "@/lib/utils";

/**
 * The app header, shared by the web app and the Capacitor SPA.
 *
 * Extracted from app-shell.tsx for the same reason the bottom bar was: the
 * native app had its own hand-written header -- its own Create dropdown, bell
 * and account menu -- and nothing kept the two in step.
 *
 * WHAT STAYS OUT, deliberately: the desktop sidebar (web-only by nature), the
 * guided-tour wiring, and every native lifecycle concern. This file is layout
 * and menus; anything platform-specific arrives as a prop.
 */

/* Same derivation as mobile-nav.tsx: web resolves this to Next's typed-route
   union (so `next build` still rejects a path that does not exist) and mobile
   to a plain string. Hardcoding `string` breaks the web build. */
type PlatformHref = Extract<LinkProps<string>["href"], string>;

export type CreateAction = {
  href: PlatformHref;
  title: string;
  description: string;
  icon: LucideIcon;
  featureIcon: FeatureIconKey;
};

/**
 * The Create menu's destinations.
 *
 * "Share a Moment" is deliberately absent. Moments is paused on web --
 * app/(app)/moments/page.tsx redirects to /dashboard when isMomentsEnabled is
 * false -- so the shortcut promised a destination that bounced the person
 * straight back to Home. The native app carried its own copy of that item;
 * sharing this list removes it there too, which is the intended outcome: one
 * menu, not two that disagree.
 */
export const CREATE_ACTIONS = [
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
  }
] satisfies CreateAction[];

export type AccountMenuEntry = {
  href: PlatformHref;
  label: string;
  icon: LucideIcon;
  /** Owner-only. Hidden unless the shell says this account may see it. */
  adminOnly?: boolean;
};

/**
 * The account menu's destinations.
 *
 * "Mad Buddy Access" resolves an inconsistency that predates this work rather
 * than inventing one: the MONETIZATION RESET moved the canonical destination
 * to /settings/access and the desktop sidebar followed, but the account menu
 * was left pointing at /billing (labelled "Membership") -- the old three-tier
 * upgrade UI that is no longer how anyone reaches their access state. The
 * native app pointed at its own /subscription screen, a third answer.
 * Sharing one menu forces one destination; this is the one the product
 * already chose.
 */
export const ACCOUNT_MENU_ENTRIES = [
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/settings/access", label: "Mad Buddy Access", icon: CircleDollarSign },
  { href: "/help", label: "Help and support", icon: HelpCircle },
  { href: "/admin", label: "Admin", icon: Gauge, adminOnly: true }
] satisfies AccountMenuEntry[];

/* The canonical flyout surface, matching every other anchored menu in the
   shell. Copied verbatim from app-shell.tsx rather than restyled, so the
   header keeps the exact look it has today. */
const FLYOUT_CONTENT_CLASSNAME = "app-dropdown-content sidebar-flyout w-60";

export function AppHeader({
  currentUsername,
  currentAvatarUrl,
  showAdminLink = false,
  createActions = CREATE_ACTIONS,
  onLogout,
  logoutPending = false,
  isDestinationAvailable,
  hidden = false,
  homeHref = "/dashboard" as PlatformHref,
  showNotificationsBell = false,
  notificationsHref = "/notifications" as PlatformHref,
  useAvatarSource,
  useOverlayDismiss
}: {
  currentUsername: string | null;
  currentAvatarUrl: string | null;
  showAdminLink?: boolean;
  createActions?: readonly CreateAction[];
  /**
   * Logging out is PLATFORM-SPECIFIC, and injected rather than shared.
   *
   * Web passes useSecureLogout().logout, which clears the session through a
   * Server Action. Android passes AuthProvider.signOut, which removes the
   * device's push token before clearing the Supabase session -- native
   * lifecycle this component has no business knowing about. Routing either
   * through the other's mechanism would be strictly worse.
   */
  onLogout: () => void;
  logoutPending?: boolean;
  /**
   * Whether a destination exists on this platform. Omitted on web, where all
   * of them do. The native shell passes isBuiltForMobile so an entry pointing
   * at something the app does not have yet is not offered at all -- the menu
   * has room to simply omit it, unlike the bottom bar's fixed slots.
   */
  isDestinationAvailable?: (href: string) => boolean;
  /** Routes that render their own header (web). */
  hidden?: boolean;
  homeHref?: PlatformHref;
  /**
   * Whether to show a notifications bell.
   *
   * OFF BY DEFAULT, which is what keeps web unchanged: on web every page
   * renders its own MobilePageHeader and that already carries a bell, so one
   * here would show it twice. The native app has no per-page header, so this
   * is its only route to notifications from the chrome -- it opts in.
   *
   * Deliberately unbadged either way: the bell and the notifications
   * destination read the same unread source, so badging both would show one
   * count twice.
   */
  showNotificationsBell?: boolean;
  notificationsHref?: PlatformHref;
  /** See AvatarSourceHook. Web injects its resolver; mobile omits it. */
  useAvatarSource?: AvatarSourceHook;
  /** See OverlayDismissHook. Mobile injects it so Back closes the menu. */
  useOverlayDismiss?: OverlayDismissHook;
}) {
  const pathname = usePathname();
  /* NO useDismissOnBack: this menu's items are Links, so closing it is part of
     starting a navigation, and that hook's history.back() cleanup would cancel
     the in-flight transition. */
  const [createOpen, setCreateOpen] = useState(false);

  /* Identity is fixed for the app's lifetime (web never passes one, mobile
     always does), so calling it through a prop keeps a stable hook order. */
  (useOverlayDismiss ?? useNoOverlayRegistration)(createOpen, () => setCreateOpen(false));

  if (hidden) return null;

  const available = (href: string) => (isDestinationAvailable ? isDestinationAvailable(href) : true);
  const visibleCreateActions = createActions.filter((action) => available(action.href));

  return (
    <header className="fixed inset-x-0 top-0 z-30 border-b border-border/70 bg-background/90 pt-[env(safe-area-inset-top,0px)] backdrop-blur-xl dark:border-white/10 dark:bg-[#111112]/90 md:static md:pt-0">
      <div className="mx-auto flex h-[var(--app-header-content-height)] w-full max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        {/* Mobile: logo only. The greeting below establishes the page, so no
            "Home" title competes with it. */}
        <Link
          href={homeHref}
          prefetch={false}
          aria-label="Mad Buddy home"
          title="Mad Buddy home"
          className="focus-ring shrink-0 md:hidden"
        >
          <BrandMark className="h-9 w-9" priority />
        </Link>

        {/* Home and Friends get a header title; every other page carries its
            own H1, so a generic fallback is omitted rather than duplicated. */}
        <div className="mr-auto hidden min-w-0 md:block">
          {pathname === "/dashboard" || pathname === "/friends" ? (
            <h1 className="truncate text-lg font-semibold sm:text-xl">
              {pathname === "/dashboard" ? "Home" : "Friends"}
            </h1>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {visibleCreateActions.length > 0 ? (
            <DropdownMenu.Root open={createOpen} onOpenChange={setCreateOpen}>
              <DropdownMenu.Trigger asChild>
                <Button type="button" variant="outline" size="icon" aria-label="Create" title="Create">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  side="bottom"
                  align="end"
                  sideOffset={8}
                  collisionPadding={8}
                  className={FLYOUT_CONTENT_CLASSNAME}
                >
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
          ) : null}

          {showNotificationsBell && available(notificationsHref) ? (
            <Link
              href={notificationsHref}
              prefetch={false}
              aria-label="Notifications"
              title="Notifications"
              className="focus-ring grid h-11 w-11 place-items-center rounded-full border border-border/70 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden"
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}

          {/* Mobile-only: on desktop the sidebar already provides both, so
              surfacing them here would duplicate destinations in one viewport. */}
          <div className="md:hidden">
            <AccountMenu
              currentUsername={currentUsername}
              currentAvatarUrl={currentAvatarUrl}
              showAdminLink={showAdminLink}
              onLogout={onLogout}
              logoutPending={logoutPending}
              isDestinationAvailable={isDestinationAvailable}
              useAvatarSource={useAvatarSource}
              useOverlayDismiss={useOverlayDismiss}
            />
          </div>
        </div>
      </div>
    </header>
  );
}

export function AccountMenu({
  currentUsername,
  currentAvatarUrl,
  showAdminLink = false,
  onLogout,
  logoutPending = false,
  isDestinationAvailable,
  useAvatarSource,
  useOverlayDismiss,
  trigger,
  align = "end"
}: {
  currentUsername: string | null;
  currentAvatarUrl: string | null;
  showAdminLink?: boolean;
  onLogout: () => void;
  logoutPending?: boolean;
  isDestinationAvailable?: (href: string) => boolean;
  useAvatarSource?: AvatarSourceHook;
  useOverlayDismiss?: OverlayDismissHook;
  /** Overrides the default avatar-circle trigger (e.g. a hamburger). */
  trigger?: ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  (useOverlayDismiss ?? useNoOverlayRegistration)(open, () => setOpen(false));
  const initial = currentUsername?.[0]?.toUpperCase() ?? "?";

  const entries = ACCOUNT_MENU_ENTRIES.filter((entry) => {
    if (entry.adminOnly && !showAdminLink) return false;
    return isDestinationAvailable ? isDestinationAvailable(entry.href) : true;
  });

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
            <AccountAvatar src={currentAvatarUrl} initial={initial} useAvatarSource={useAvatarSource} />
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

          {entries.map((entry) => (
            <DropdownMenu.Item
              key={entry.href}
              asChild
              className="focus-ring safe-motion flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2.5 text-left outline-none data-[highlighted]:bg-secondary"
            >
              <Link href={entry.href} prefetch={false}>
                <entry.icon className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span className="text-sm">{entry.label}</span>
              </Link>
            </DropdownMenu.Item>
          ))}

          <div className="my-2 h-px bg-border/70" />

          <DropdownMenu.Item
            disabled={logoutPending}
            onSelect={onLogout}
            className="focus-ring safe-motion flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-destructive outline-none data-[highlighted]:bg-secondary data-[disabled]:opacity-60"
          >
            <LogOut className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span className="text-sm">{logoutPending ? "Logging out…" : "Log out"}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function AccountAvatar({
  src,
  initial,
  useAvatarSource
}: {
  src: string | null;
  initial: string;
  useAvatarSource?: AvatarSourceHook;
}) {
  /* Calling a hook through a prop is safe HERE and only here: the identity is
     fixed for the lifetime of the app (web always passes its resolver, mobile
     always passes none), so the hook order never changes between renders.
     The fallback is a stable module-level function for the same reason. */
  const resolvedSrc = (useAvatarSource ?? usePassthroughAvatarSource)(src);

  return (
    <span className={cn("grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-secondary")}>
      {resolvedSrc ? (
        <UserAvatar src={resolvedSrc} name={initial} size="sm" decorative />
      ) : (
        <span className="text-sm font-semibold">{initial}</span>
      )}
    </span>
  );
}

/**
 * How the header turns a stored avatar URL into the one it should display.
 *
 * Web needs more than the raw URL: a Mad Buddy upload is served through
 * /api/profile/avatar (a web-only endpoint), and the header listens for a
 * `madbuddy:avatar-updated` event so a newly saved photo appears immediately
 * rather than staying stale until the next navigation. Sharing the header
 * naively dropped both, so a changed avatar could keep showing the old image.
 *
 * Android has no such endpoint and its avatar URL is already canonical, so it
 * passes nothing and the raw value is used.
 */
export type AvatarSourceHook = (src: string | null) => string | null;

const usePassthroughAvatarSource: AvatarSourceHook = (src) => src;

/**
 * Registers an open menu with the platform's dismissal stack.
 *
 * Android needs this: the hardware Back button should CLOSE an open menu, not
 * navigate away from the screen. The native app's overlay registry
 * (mobile/src/lib/overlay.ts) already drives back, Escape and outside-press
 * through one handler; these Radix menus have to join it.
 *
 * Injected rather than shared, and that is not incidental. Web deliberately
 * does NOT register these menus: its equivalent hook's cleanup calls
 * history.back(), which cancels the in-flight App Router navigation a menu
 * item starts -- the exact bug lib/performance/navigation-cancellation.test.ts
 * exists to prevent. So web passes nothing and keeps Radix's own Escape and
 * outside-press handling.
 */
export type OverlayDismissHook = (open: boolean, dismiss: () => void) => void;

const useNoOverlayRegistration: OverlayDismissHook = () => {};
