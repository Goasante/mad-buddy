"use client";

import type { Route } from "next";
import Link from "next/link";
import { Bell, ChevronLeft, Menu, MoreHorizontal, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useHasScrolled } from "@/hooks/use-has-scrolled";
import { cameFromInsideApp, resolveBack } from "@/lib/navigation/entry-origin";
import { cn } from "@/lib/utils";

/**
 * The canonical mobile page header, shared by every primary screen.
 *
 * Layout is a real three-column grid (auto / 1fr / auto), not flex with
 * guessed margins: the title is centred against the header itself, so it
 * cannot drift when the right-hand cluster changes width — when the badge
 * appears, or goes from "1" to "9+".
 *
 * Four affordances, each with exactly one job:
 *   - Menu           opens the account/menu sheet (slide transition)
 *   - Notifications  goes to the notifications stream
 *   - Add Muddy      goes to Muddy requests; badge = pending INCOMING only
 *   - Quick Controls opens the quick-controls sheet (spring transition)
 *
 * No profile avatar: the bottom bar's Me tab is the canonical identity
 * destination, and a second entry point to it would be clutter.
 *
 * Mobile only (md:hidden). Desktop screens render their own in-content
 * heading; the persistent sidebar already carries navigation there.
 */
export function MobilePageHeader({
  title,
  leadingAction = "menu",
  backHref,
  onBack,
  onOpenMenu,
  onOpenQuickControls,
  showNotifications = true,
  showAddMuddy = true,
  showQuickControls = true,
  incomingRequestCount = 0,
  unreadNotificationCount = 0,
  quickControlsTourId
}: {
  title: string;
  /**
   * What sits in the leading slot.
   *
   *   menu — root screens: opens the account/menu sheet
   *   back — nested/detail screens, where an obvious way back matters more
   *          than access to the menu
   *   none — screens with neither
   */
  leadingAction?: "menu" | "back" | "none";
  /** Back destination. Preferred over onBack: a real link survives a cold load. */
  backHref?: Route;
  /** Back handler, for in-page views that have no route of their own. */
  onBack?: () => void;
  onOpenMenu?: () => void;
  onOpenQuickControls?: () => void;
  /**
   * Trailing actions. Default on so root screens need no configuration, but
   * secondary screens turn off what does not apply to them — Quick Controls
   * in particular opens a Home-specific sheet (visibility, ghost mode,
   * refresh Nearby) that other screens have no equivalent for.
   */
  showNotifications?: boolean;
  showAddMuddy?: boolean;
  showQuickControls?: boolean;
  /**
   * Pending INCOMING Muddy requests. Never a notification count — those are
   * a different stream with their own surface. Zero hides the badge.
   */
  incomingRequestCount?: number;
  /**
   * Unread app notifications, from the canonical unread source the shell
   * already polls. Deliberately SEPARATE from incomingRequestCount: the two
   * badges count different things and must never be merged or summed.
   */
  unreadNotificationCount?: number;
  /** Optional guided-tour target for the Quick Controls trigger. */
  quickControlsTourId?: string;
}) {
  const hasRequests = incomingRequestCount > 0;
  const hasUnread = unreadNotificationCount > 0;
  const scrolled = useHasScrolled();
  const router = useRouter();

  /**
   * Entry context, read ONCE on mount.
   *
   * history.length grows as the person moves around this screen, so asking at
   * click time answers a different question than "how did I get here".
   */
  const [fromInsideApp] = useState(() => cameFromInsideApp());

  const goBack = useCallback(() => {
    const decision = resolveBack({ fromInsideApp, fallbackHref: backHref ?? "/dashboard" });
    if (decision.kind === "history") router.back();
    else router.push(decision.href as Route);
  }, [fromInsideApp, backHref, router]);

  return (
    <header
      className={cn(
        // FIXED to the viewport, not sticky inside the page.
        //
        // Sticky put the header inside the Home scroll container, which had
        // two consequences: pull-to-refresh's transform on that container
        // became a transformed ANCESTOR (which re-bases sticky onto itself
        // rather than the viewport, so the header rode down with the pull and
        // appeared to float), and any flow height added above it pushed the
        // header down. Fixed positioning resolves against the viewport
        // regardless of ancestor transforms, so neither can move it.
        //
        // The corresponding content offset is --mobile-header-height, applied
        // once by AppShell — never as a spacer element.
        "fixed inset-x-0 top-0 z-40 grid grid-cols-[auto_1fr_auto] items-center gap-2 px-4 pb-3 sm:px-6 md:hidden",
        // The safe-area inset lives HERE and nowhere else in the chain, so the
        // notch clearance is reserved exactly once.
        "pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]",
        // OPAQUE, not translucent. Content scrolls underneath a fixed header,
        // so a see-through surface would show it passing behind the title.
        "bg-background dark:bg-[#111112]",
        // Divider only once content is actually passing underneath.
        "border-b transition-colors duration-200 motion-reduce:transition-none",
        scrolled
          ? "border-border/60 shadow-[0_1px_12px_hsl(var(--shadow)/0.08)] dark:border-white/10"
          : "border-transparent shadow-none"
      )}
    >
      {/* Leading slot. Always occupied — an empty span when there is no
          action — so the three-column grid keeps the title centred against
          the header rather than letting it drift. */}
      {leadingAction === "menu" && onOpenMenu ? (
        <HeaderButton label="Menu" onClick={onOpenMenu}>
          <Menu className={ICON} strokeWidth={STROKE} aria-hidden="true" />
        </HeaderButton>
      ) : leadingAction === "back" && backHref ? (
        /* BACK MEANS BACK -- but it stays a real <Link>.
           This was a plain link to `backHref`, so every screen returned to an
           assumed parent no matter where the person came from: UpFor -> Linkr
           -> Back went Home, and Profile -> Settings -> Privacy -> Back
           skipped Settings.

           The anchor is KEPT rather than swapped for a button, because it is
           load-bearing for the reason the guard test gives: an <a href> works
           before hydration, survives a cold load, and still supports
           middle-click and "open in new tab". The click is intercepted only
           when there is real in-app history to unwind; `backHref` remains the
           href, and becomes the genuine destination on a cold entry.
           See lib/navigation/entry-origin.ts. */
        <HeaderLink href={backHref} label="Back" onNavigate={goBack}>
          <ChevronLeft className={ICON} strokeWidth={STROKE} aria-hidden="true" />
        </HeaderLink>
      ) : leadingAction === "back" && onBack ? (
        <HeaderButton label="Back" onClick={onBack}>
          <ChevronLeft className={ICON} strokeWidth={STROKE} aria-hidden="true" />
        </HeaderButton>
      ) : (
        <span className="h-[44px] w-[44px] shrink-0" aria-hidden="true" />
      )}

      <h1 className="truncate text-center text-[1.125rem] font-semibold tracking-tight">{title}</h1>

      <div className="flex items-center gap-2.5">
        {/* Bell badge = unread app notifications. The UserPlus badge below is
            pending incoming Muddy requests. Two streams, two counts, never
            combined. */}
        {showNotifications ? (
          <HeaderLink
            href="/notifications"
            label={
              hasUnread
                ? `Notifications, ${unreadNotificationCount} unread ${unreadNotificationCount === 1 ? "notification" : "notifications"}`
                : "Notifications"
            }
            title="Notifications"
          >
            {/* Two-tone only when there is something to notice. An idle bell
                that animates anyway becomes wallpaper. */}
            <span className={hasUnread ? "bell-two-tone" : undefined}>
              <Bell className={ICON} strokeWidth={STROKE} aria-hidden="true" />
            </span>
            {hasUnread ? <HeaderBadge count={unreadNotificationCount} /> : null}
          </HeaderLink>
        ) : null}

        {/* Add Muddy → the Requests tab, which already owns accept/decline
            plus the Add panel for search, send and invite. */}
        {showAddMuddy ? (
          <Link
            href="/friends?tab=requests"
            aria-label={
              hasRequests
                ? `Add Muddy, ${incomingRequestCount} pending ${incomingRequestCount === 1 ? "request" : "requests"}`
                : "Add Muddy"
            }
            title="Add Muddy"
            className={cn(
              HIT_TARGET,
              "relative bg-primary text-primary-foreground transition-transform hover:bg-primary/90 active:scale-95 motion-reduce:active:scale-100"
            )}
          >
            {/* Slightly heavier stroke so the glyph holds its weight against a
                filled background at the same optical size as its neighbours. */}
            <UserPlus className="h-[21px] w-[21px]" strokeWidth={2} aria-hidden="true" />
            {hasRequests ? <HeaderBadge count={incomingRequestCount} /> : null}
          </Link>
        ) : null}

        {showQuickControls && onOpenQuickControls ? (
          <HeaderButton label="Quick controls" onClick={onOpenQuickControls} tourId={quickControlsTourId}>
            <MoreHorizontal className={ICON} strokeWidth={STROKE} aria-hidden="true" />
          </HeaderButton>
        ) : null}
      </div>
    </header>
  );
}

/** One optical size and one stroke weight across every header icon. */
const ICON = "h-[22px] w-[22px]";
const STROKE = 1.75;

/** Shared 44px hit target and press feedback, so every control matches. */
const HIT_TARGET =
  /* A FIXED 44px TARGET, not 2.75rem (MB-GOD-047).
   *
   * `h-11 w-11` is rem-based, so at 200% text each header button became 88px
   * and three of them plus the title outgrew the grid -- "Quick controls" and
   * "Linkr settings" left the viewport entirely, on a header that does not
   * scroll. The ICON constant beside this is already fixed-pixel
   * (`h-[22px]`) for the same reason; the button had been missed.
   *
   * 44px is the touch minimum and does not need to grow with text: scaling
   * text should enlarge what is READ, not the chrome around it. */
  "focus-ring safe-motion grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full transition-transform active:scale-95 motion-reduce:active:scale-100";

function HeaderButton({
  label,
  onClick,
  tourId,
  children
}: {
  label: string;
  onClick: () => void;
  tourId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-tour-id={tourId}
      className={cn(HIT_TARGET, "text-foreground hover:bg-secondary dark:hover:bg-white/[0.06]")}
    >
      {children}
    </button>
  );
}

function HeaderLink({
  href,
  label,
  title,
  onNavigate,
  children
}: {
  href: Route;
  label: string;
  /** Tooltip text. Defaults to `label`, which the badge makes too verbose. */
  title?: string;
  /**
   * Handles an ordinary click instead of following `href`.
   *
   * Used by Back to prefer real history over its fallback parent. Modified
   * clicks (new tab, new window) and non-primary buttons are left alone, so
   * the anchor keeps behaving like an anchor.
   */
  onNavigate?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={title ?? label}
      onClick={
        onNavigate
          ? (event) => {
              if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              ) {
                return;
              }
              event.preventDefault();
              onNavigate();
            }
          : undefined
      }
      className={cn(HIT_TARGET, "relative text-foreground hover:bg-secondary dark:hover:bg-white/[0.06]")}
    >
      {children}
    </Link>
  );
}

/**
 * The shared count badge for both header streams.
 *
 * `-right-0.5 -top-0.5` keeps it inside the 44px hit target's padding box, so
 * it cannot clip against the header edge or the screen edge at 320px. Caps at
 * 9+ because two glyphs is all that fits without deforming the circle.
 *
 * aria-hidden: the count is already in the parent control's aria-label, so
 * exposing it here too would make a screen reader announce it twice.
 */
function HeaderBadge({ count }: { count: number }) {
  return (
    <span
      className="absolute -right-0.5 -top-0.5 grid min-h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-background bg-red-500 px-1 text-[10px] font-bold leading-none text-white dark:border-[#111112]"
      aria-hidden="true"
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
