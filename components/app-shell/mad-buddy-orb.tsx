"use client";

import { NavigationGlyph } from "@/components/app-shell/navigation-glyph";
import { Link } from "@/lib/platform";
import { cn } from "@/lib/utils";

/**
 * Home's centre control in the mobile bottom navigation.
 *
 * The export name is kept for compatibility with the existing shell and tour
 * tests, but the visual is intentionally no longer the large glowing Orb. The
 * approved treatment is a solid house above its label. The shared floating
 * pill stylesheet gives Home the same inset selected state as every tab.
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
      className="safe-motion flex min-h-[56px] w-full flex-col items-center justify-center gap-1 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-95 motion-reduce:active:scale-100"
    >
      <span
        className={cn(
          "relative grid h-[28px] w-[28px] shrink-0 place-items-center transition-colors duration-200 ease-out motion-reduce:transition-none",
          isActive
            ? "text-primary"
            : "text-foreground",
          className
        )}
        aria-hidden="true"
      >
        <NavigationGlyph name="home" className="h-[28px] w-[28px]" />
        {hasActivity ? (
          <span className="absolute right-[3px] top-[3px] h-2 w-2 rounded-full bg-[#E88C2B] ring-2 ring-background" />
        ) : null}
      </span>
      <span className="mobile-nav-label max-w-full truncate">Home</span>
    </Link>
  );
}
