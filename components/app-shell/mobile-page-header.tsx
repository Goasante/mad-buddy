"use client";

import type { Route } from "next";
import Link from "next/link";
import { Bell, Menu, MoreHorizontal, UserPlus } from "lucide-react";
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
  onOpenMenu,
  onOpenQuickControls,
  incomingRequestCount = 0,
  quickControlsTourId
}: {
  title: string;
  onOpenMenu: () => void;
  onOpenQuickControls: () => void;
  /**
   * Pending INCOMING Muddy requests. Never a notification count — those are
   * a different stream with their own surface. Zero hides the badge.
   */
  incomingRequestCount?: number;
  /** Optional guided-tour target for the Quick Controls trigger. */
  quickControlsTourId?: string;
}) {
  const hasRequests = incomingRequestCount > 0;

  return (
    <header className="sticky top-0 z-20 -mx-4 mb-1 grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-border/60 bg-background/85 px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] backdrop-blur-xl dark:bg-[#111112]/85 sm:-mx-6 sm:px-6 md:hidden">
      <HeaderButton label="Menu" onClick={onOpenMenu}>
        <Menu className={ICON} strokeWidth={STROKE} aria-hidden="true" />
      </HeaderButton>

      <h1 className="text-center text-[1.125rem] font-semibold tracking-tight">{title}</h1>

      <div className="flex items-center gap-2.5">
        <HeaderLink href="/notifications" label="Notifications">
          <Bell className={ICON} strokeWidth={STROKE} aria-hidden="true" />
        </HeaderLink>

        {/* Add Muddy → the Requests tab, which already owns accept/decline
            plus the Add panel for search, send and invite. */}
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
          {hasRequests ? (
            // -top/-right keep the badge inside the header's padding box, so
            // it cannot clip against the screen edge at 320px.
            <span
              className="absolute -right-0.5 -top-0.5 grid min-h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-background bg-red-500 px-1 text-[10px] font-bold leading-none text-white"
              aria-hidden="true"
            >
              {incomingRequestCount > 9 ? "9+" : incomingRequestCount}
            </span>
          ) : null}
        </Link>

        <HeaderButton label="Quick controls" onClick={onOpenQuickControls} tourId={quickControlsTourId}>
          <MoreHorizontal className={ICON} strokeWidth={STROKE} aria-hidden="true" />
        </HeaderButton>
      </div>
    </header>
  );
}

/** One optical size and one stroke weight across every header icon. */
const ICON = "h-[22px] w-[22px]";
const STROKE = 1.75;

/** Shared 44px hit target and press feedback, so every control matches. */
const HIT_TARGET =
  "focus-ring safe-motion grid h-11 w-11 place-items-center rounded-full transition-transform active:scale-95 motion-reduce:active:scale-100";

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

function HeaderLink({ href, label, children }: { href: Route; label: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={cn(HIT_TARGET, "text-foreground hover:bg-secondary dark:hover:bg-white/[0.06]")}
    >
      {children}
    </Link>
  );
}
