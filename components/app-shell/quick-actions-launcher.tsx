"use client";

import { ChevronUp, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import "@/app/quick-actions-replica.css";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { haptic } from "@/lib/device/haptics";
import { QUICK_ACTIONS, showsQuickActions } from "@/lib/navigation/quick-actions";
import { cn } from "@/lib/utils";

/**
 * The Quick Actions launcher.
 *
 * Mounted ONCE in AppShell and visually styled as the approved floating action
 * system: a circular orange launcher with a vertical stack of pill actions.
 * Route destinations, visibility rules, dismissal behaviour, haptics and
 * accessibility remain independent of the visual treatment.
 */
export function QuickActionsLauncher() {
  const pathname = usePathname();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  // DERIVED, not mirrored into state by an effect. The launcher is open only
  // while the route it was opened on is still the current route, so navigating
  // closes it by construction -- no effect, no cascading render, and no frame
  // where a stale menu is visible over the new page.
  const open = openedOn !== null && openedOn === pathname;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  const close = useCallback(
    (withHaptic = true) => {
      setOpenedOn((wasOpenedOn) => {
        if (wasOpenedOn !== null && withHaptic) haptic("close");
        return null;
      });
    },
    []
  );

  // Escape closes and returns focus to the trigger, so a keyboard user is not
  // dropped at the top of the document.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // Tapping anywhere else dismisses. Pointerdown rather than click, so the
  // menu is gone before the tap lands on whatever is underneath.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  if (!showsQuickActions(pathname)) return null;

  function toggle() {
    if (open) {
      close();
      return;
    }
    haptic("tick");
    setOpenedOn(pathname);
  }

  function selectAction(href: string) {
    haptic("select");
    // Closed BEFORE navigating, so the menu is never seen collapsing over the
    // page it just opened.
    setOpenedOn(null);
    router.push(href as never);
  }

  return (
    <div
      ref={containerRef}
      data-open={open ? "true" : "false"}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      className="quick-actions"
    >
      {/* Downward swipe closes, matching the direction the menu collapses. */}
      <div
        className="quick-actions-stack"
        onTouchStart={(event) => {
          const startY = event.touches[0]?.clientY ?? 0;
          const onTouchEnd = (endEvent: TouchEvent) => {
            const endY = endEvent.changedTouches[0]?.clientY ?? startY;
            if (endY - startY > 48) close();
            document.removeEventListener("touchend", onTouchEnd);
          };
          document.addEventListener("touchend", onTouchEnd);
        }}
      >
        {/* Rendered whether open or not, so the expansion animates from real
            layout rather than from elements appearing mid-transition. The
            container's data-open drives visibility and hit-testing. */}
        <ul id={panelId} className="quick-actions-list" role="menu" aria-label="Quick actions">
          {QUICK_ACTIONS.map((action, index) => (
            <li
              key={action.id}
              className={cn("quick-actions-item", action.toneClass)}
              // Sequential reveal upward. Nearest the trigger moves first, so
              // the column reads as growing out of the button rather than as a
              // separate panel arriving.
              style={{ "--qa-index": QUICK_ACTIONS.length - 1 - index } as React.CSSProperties}
            >
              <Link
                href={action.href}
                prefetch={false}
                role="menuitem"
                tabIndex={open ? 0 : -1}
                aria-hidden={!open}
                className="quick-actions-action focus-ring"
                onClick={(event) => {
                  event.preventDefault();
                  selectAction(action.href);
                }}
              >
                <span className="quick-actions-label">{action.label}</span>
                <span className="quick-actions-glyph" aria-hidden="true">
                  <FeatureIcon feature={action.featureIcon} size={20} decorative />
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Close quick actions" : "Open quick actions"}
          className="quick-actions-trigger focus-ring"
        >
          <span className="quick-actions-trigger-icon" aria-hidden="true">
            {open ? (
              <X className="h-[18px] w-[18px]" />
            ) : (
              <ChevronUp className="quick-actions-chevron h-[18px] w-[18px]" />
            )}
          </span>
        </button>
      </div>

      {/* Announced on expand, so a screen-reader user hears that a menu opened
          rather than only that a button toggled. */}
      <span role="status" aria-live="polite" className="sr-only">
        {open ? `Quick actions expanded, ${QUICK_ACTIONS.length} actions` : ""}
      </span>
    </div>
  );
}
