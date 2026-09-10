"use client";

import { LayoutGrid } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import "@/app/quick-actions-replica.css";
import { Modal } from "@/components/ui/modal";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { haptic } from "@/lib/device/haptics";
import { QUICK_ACTIONS, showsQuickActions } from "@/lib/navigation/quick-actions";
import {
  loadQuickActionsPosition,
  saveQuickActionsPosition,
  type QuickActionsEdge
} from "@/lib/navigation/quick-actions-position";
import { cn } from "@/lib/utils";

/** Visible control size, kept in sync with --quick-actions-size in CSS. */
const CONTROL_SIZE_PX = 46;
const EDGE_MARGIN_PX = 14;
/** How far a press has to travel before it counts as a drag rather than a
 * tap -- small enough that a real drag begins responding immediately, large
 * enough that a finger's natural wobble during a tap never opens a drag. */
const DRAG_THRESHOLD_PX = 6;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * env(safe-area-inset-*) exists only in CSS, so a probe element measures it
 * into real pixels once per session. Cached at module scope: the device
 * safe area cannot change without a reload.
 */
let cachedInsets: { top: number; right: number; bottom: number; left: number } | null = null;

function safeAreaInsets() {
  if (cachedInsets) return cachedInsets;
  if (typeof document === "undefined") return { top: 0, right: 0, bottom: 0, left: 0 };
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.top = "0";
  probe.style.left = "0";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.paddingTop = "env(safe-area-inset-top, 0px)";
  probe.style.paddingRight = "env(safe-area-inset-right, 0px)";
  probe.style.paddingBottom = "env(safe-area-inset-bottom, 0px)";
  probe.style.paddingLeft = "env(safe-area-inset-left, 0px)";
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe);
  cachedInsets = {
    top: Number.parseFloat(computed.paddingTop) || 0,
    right: Number.parseFloat(computed.paddingRight) || 0,
    bottom: Number.parseFloat(computed.paddingBottom) || 0,
    left: Number.parseFloat(computed.paddingLeft) || 0
  };
  probe.remove();
  return cachedInsets;
}

/** The vertical band the launcher is allowed to rest in: below the header,
 * above the floating bottom navigation and its safe-area inset. */
function verticalBounds() {
  const nav = getComputedStyle(document.documentElement).getPropertyValue("--mobile-nav-height");
  const navHeight = Number.parseFloat(nav) * 16 || 80; // rem -> px, with a sane fallback
  const insets = safeAreaInsets();
  const top = 88 + insets.top + EDGE_MARGIN_PX; // clears the fixed header on every surface that carries one
  const bottom = window.innerHeight - navHeight - insets.bottom - CONTROL_SIZE_PX - EDGE_MARGIN_PX;
  return { top, bottom: Math.max(top, bottom) };
}

function resolveLeft(edge: QuickActionsEdge) {
  const insets = safeAreaInsets();
  return edge === "right"
    ? window.innerWidth - CONTROL_SIZE_PX - EDGE_MARGIN_PX - insets.right
    : EDGE_MARGIN_PX + insets.left;
}

/**
 * The Quick Actions launcher.
 *
 * Mounted ONCE in AppShell. A small edge-docked utility control, not a
 * primary call to action: default position is the safe right edge, the user
 * can drag it to either edge and that choice is remembered locally. Tapping
 * it opens the same four destinations as before, now in a bottom sheet
 * instead of a stack of pills growing out of the trigger.
 */
export function QuickActionsLauncher() {
  const pathname = usePathname();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn !== null && openedOn === pathname;

  const [placement, setPlacement] = useState<{ edge: QuickActionsEdge; top: number; left: number } | null>(
    null
  );
  const edge = placement?.edge ?? "right";
  const top = placement?.top ?? null;
  const left = placement?.left ?? null;
  const [dragging, setDragging] = useState(false);
  const positionedRef = useRef(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originTop: number;
    isDrag: boolean;
  } | null>(null);

  const settleIntoBounds = useCallback((nextEdge: QuickActionsEdge, desiredTop: number) => {
    const { top: minTop, bottom: maxTop } = verticalBounds();
    const clampedTop = clamp(desiredTop, minTop, maxTop);
    const resolved = { edge: nextEdge, top: clampedTop, left: resolveLeft(nextEdge) };
    setPlacement(resolved);
    return clampedTop;
  }, []);

  // Resolve a starting position once on mount: the stored edge/fraction if
  // one exists and is still sane for this viewport, otherwise the default
  // safe right edge at a comfortable lower-middle height. window/localStorage
  // are client-only, so this cannot run during the server render -- it is a
  // one-time synchronisation with the platform, the documented reason an
  // effect is the right tool rather than a lazy useState initialiser.
  useEffect(() => {
    if (positionedRef.current) return;
    positionedRef.current = true;
    const stored = loadQuickActionsPosition();
    const { top: minTop, bottom: maxTop } = verticalBounds();
    // Defaults near the FOOT of the safe band, deliberately: this is where
    // the launcher lived before (just above the bottom navigation), and a
    // dense scrolling list can put a card's action row at almost any height,
    // so there is no fraction that is guaranteed clear of every surface's
    // content. Sitting low keeps the common case out of the way; dragging
    // it to either edge remains how a user resolves the rest.
    const fraction = stored ? stored.verticalFraction : 0.94;
    const nextEdge = stored ? stored.edge : "right";
    const desiredTop = minTop + (maxTop - minTop) * fraction;
    const clampedTop = clamp(desiredTop, minTop, maxTop);
    setPlacement({ edge: nextEdge, top: clampedTop, left: resolveLeft(nextEdge) });
  }, []);

  // A later viewport change (rotation, resize, keyboard) must never leave a
  // previously-valid position stranded off-screen or behind the nav.
  useEffect(() => {
    function onResize() {
      if (top === null) return;
      settleIntoBounds(edge, top);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [edge, top, settleIntoBounds]);

  const close = useCallback((withHaptic = true) => {
    setOpenedOn((wasOpenedOn) => {
      if (wasOpenedOn !== null && withHaptic) haptic("close");
      return null;
    });
  }, []);

  if (!showsQuickActions(pathname)) return null;

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== undefined && event.button !== 0) return;
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originTop: top ?? 0,
      isDrag: false
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.isDrag && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      drag.isDrag = true;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (!drag.isDrag) return;
    const { top: minTop, bottom: maxTop } = verticalBounds();
    const nextTop = clamp(drag.originTop + dy, minTop, maxTop);
    // While dragging, follow the pointer horizontally too, so the control
    // visibly leaves its edge -- it snaps back to a safe edge on release.
    const nextLeft = clamp(
      (left ?? 0) + (event.movementX || 0),
      0,
      window.innerWidth - CONTROL_SIZE_PX
    );
    setPlacement((current) => ({ edge: current?.edge ?? "right", top: nextTop, left: nextLeft }));
  }

  function onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragState.current;
    dragState.current = null;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.isDrag) {
      setDragging(false);
      toggle();
      return;
    }
    // Snap to whichever edge the control is now closer to.
    const center = (left ?? 0) + CONTROL_SIZE_PX / 2;
    const nextEdge: QuickActionsEdge = center < window.innerWidth / 2 ? "left" : "right";
    const settledTop = settleIntoBounds(nextEdge, top ?? drag.originTop);
    const { top: minTop, bottom: maxTop } = verticalBounds();
    const fraction = maxTop > minTop ? (settledTop - minTop) / (maxTop - minTop) : 0;
    saveQuickActionsPosition({ edge: nextEdge, verticalFraction: fraction });
    haptic("tick");
    setDragging(false);
  }

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
    setOpenedOn(null);
    router.push(href as never);
  }

  const style: React.CSSProperties =
    top !== null && left !== null
      ? { top: `${top}px`, left: `${left}px`, right: "auto", bottom: "auto" }
      : {};

  return (
    <>
      <div
        ref={containerRef}
        data-open={open ? "true" : "false"}
        data-dragging={dragging ? "true" : "false"}
        data-reduced-motion={reducedMotion ? "true" : "false"}
        data-edge={edge}
        className={cn("quick-actions", top === null && "quick-actions--unpositioned")}
        style={style}
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={(event) => {
            // The real open/close decision happens in onPointerUp so a drag
            // never also fires a click; this guards non-pointer activation
            // (keyboard Enter/Space, which dispatches click with no pointer
            // sequence at all).
            if (dragState.current?.isDrag) {
              event.preventDefault();
              return;
            }
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragState.current = null;
            setDragging(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggle();
            }
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label="Quick actions"
          className="quick-actions-trigger focus-ring"
        >
          <span className="quick-actions-trigger-icon" aria-hidden="true">
            <LayoutGrid className="h-[18px] w-[18px]" />
          </span>
        </button>
      </div>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) close(false);
        }}
        title="Quick actions"
        variant="sheet"
        owner="quick-actions-launcher"
      >
        <ul id={panelId} className="quick-actions-sheet-list" role="menu" aria-label="Quick actions">
          {QUICK_ACTIONS.map((action) => (
            <li key={action.id} className={cn("quick-actions-sheet-item", action.toneClass)}>
              <Link
                href={action.href}
                prefetch={false}
                role="menuitem"
                className="quick-actions-sheet-action focus-ring"
                onClick={(event) => {
                  event.preventDefault();
                  selectAction(action.href);
                }}
              >
                <span className="quick-actions-sheet-glyph" aria-hidden="true">
                  <FeatureIcon feature={action.featureIcon} size={22} decorative />
                </span>
                <span className="quick-actions-sheet-label">{action.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
