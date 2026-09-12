"use client";

import { Home } from "lucide-react";
import { Link } from "@/lib/platform";
import { cn } from "@/lib/utils";

/**
 * Home's centre control in the mobile bottom navigation.
 *
 * The export name is kept for compatibility with the existing shell and tour
 * tests, but the visual is intentionally no longer the large glowing Orb. The
 * selected Mad Buddy treatment is a compact deep-maroon rounded square with a
 * clean cream outline house; inactive Home falls back to the same quiet
 * outline language as the neighbouring tabs.
 *
 * Behaviour is unchanged: this remains a real Link to /dashboard, and tapping
 * Home while already on Home keeps the existing reselect action.
 */
export const ORB_HOME_HREF = "/dashboard";

export function MadBuddyOrb({
  isActive,
  /** Small non-counting activity accent. Never becomes a notification badge. */
  hasActivity = false,
  onHomeReselect,
  className
}: {
  isActive: boolean;
  hasActivity?: boolean;
  onHomeReselect?: () => void;
  className?: string;
}) {
  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    // Let the browser handle modified clicks (new tab, new window) normally.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (!isActive) return;

    // Route-state reselect, not a timing-based double tap.
    event.preventDefault();
    onHomeReselect?.();
  }

  return (
    <Link
      href={ORB_HOME_HREF}
      prefetch={false}
      onClick={handleClick}
      data-tour-id="nav-dashboard"
      aria-label="Home"
      aria-current={isActive ? "page" : undefined}
      className="safe-motion flex min-h-[56px] w-full items-center justify-center rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-95 motion-reduce:active:scale-100"
    >
      <span
        className={cn(
          "relative grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[14px] transition-[background-color,color,box-shadow,transform] duration-200 ease-out motion-reduce:transition-none",
          isActive
            ? "bg-[#4E0401] text-[#FEFBF3] shadow-[0_6px_18px_rgba(78,4,1,0.24),0_0_0_1px_rgba(232,140,43,0.14)]"
            : "bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground dark:hover:bg-white/[0.05]",
          className
        )}
        aria-hidden="true"
      >
        <Home
          className="h-[23px] w-[23px]"
          strokeWidth={isActive ? 1.9 : 1.75}
        />
        {hasActivity ? (
          <span className="absolute right-[3px] top-[3px] h-2 w-2 rounded-full bg-[#E88C2B] ring-2 ring-background" />
        ) : null}
      </span>
    </Link>
  );
}
