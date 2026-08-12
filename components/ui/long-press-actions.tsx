"use client";

import { useState } from "react";
import { AppMenu, type AppMenuItem } from "@/components/ui/app-dropdown";
import { useLongPress } from "@/hooks/use-long-press";
import { haptic } from "@/lib/device/haptics";
import { cn } from "@/lib/utils";

/**
 * Press-and-hold any object for its contextual actions.
 *
 * The one place the gesture is wired to the menu. Surfaces pass the actions
 * they have already authorized; this owns only the interaction, so hold
 * timing, movement cancellation, haptics, right-click parity and click
 * suppression stay identical everywhere rather than being re-derived per
 * feature.
 *
 * DOES NOT REPLACE A VISIBLE CONTROL. Every surface using this keeps its own
 * "More" button or equivalent: a hold is a shortcut for people who know it,
 * never the only route to an action. That is what keeps these actions
 * reachable by keyboard and screen reader.
 *
 * Renders children untouched when there are no actions -- a hold that opens
 * an empty menu is worse than a hold that does nothing.
 */
export function LongPressActions({
  items,
  label,
  className,
  children
}: {
  items: AppMenuItem[];
  /** Names the menu for assistive technology, e.g. "Actions for Ama". */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasActions = items.length > 0;

  const { pressing, handlers } = useLongPress(
    () => {
      // Acknowledge the hold under the finger before the menu paints.
      haptic("tick");
      setOpen(true);
    },
    { disabled: !hasActions }
  );

  if (!hasActions) return <>{children}</>;

  return (
    <span className={cn("relative block", className)}>
      <span
        // A span, not a button: these rows already contain their own links and
        // controls, and nesting those inside a button is invalid markup that
        // also steals their clicks.
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerLeave={handlers.onPointerLeave}
        onPointerCancel={handlers.onPointerCancel}
        onContextMenu={handlers.onContextMenu}
        onClick={handlers.onClick}
        className={cn("block", pressing && "scale-[0.98] transition-transform motion-reduce:transform-none")}
      >
        {children}
      </span>

      <AppMenu
        open={open}
        onOpenChange={setOpen}
        label={label}
        trigger={<span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 block h-0" />}
        items={items}
      />
    </span>
  );
}
