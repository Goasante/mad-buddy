"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useDismissOnBack } from "@/hooks/use-dismiss-on-back";
import { cn } from "@/lib/utils";

export type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  compact?: boolean;
  /** Requests a narrower content width. Drop panels are globally capped so
   * they never turn into oversized desktop overlays. */
  widthClassName?: string;
  /**
   * "center" (default) is the top-anchored drop panel. "sheet" makes it a
   * bottom-anchored, safe-area-aware sheet on phones (a Back press dismisses
   * it) while staying a centred dialog from `sm` up.
   */
  variant?: "center" | "sheet";
  /**
   * Hides the title bar VISUALLY while keeping it for assistive technology.
   *
   * For panels whose content is its own headline -- an Event detail sheet opens
   * on a full-bleed hero carrying the Event name, so a second text title above
   * it is a duplicate. The Dialog.Title still renders (sr-only), because Radix
   * requires one and a dialog announced with no name is worse than a redundant
   * heading. The close button stays visible and keeps its position.
   */
  hideTitle?: boolean;
  /** Stable runtime ownership marker for dialog invariant diagnostics. */
  owner?: string;
};

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  compact = false,
  widthClassName = "max-w-md",
  variant = "center",
  hideTitle = false,
  owner
}: ModalProps) {
  /* A scrim is allowed only when there is a foreground payload to put above
   * it. Several resource-driven call sites intentionally render `null` while
   * their record is unavailable; treating `open` alone as sufficient lets a
   * stale flag turn that transient into a dimmed, unusable page. Fail closed:
   * the caller's state may remain open while data arrives, but Radix does not
   * mount either overlay or panel until a body exists. */
  const hasForeground = children !== null && children !== undefined && children !== false;
  const rootOpen = open && hasForeground;

  // Sheets are dismissible with the hardware/browser Back button, like a native
  // mobile sheet. No-op for the centred variant.
  useDismissOnBack(variant === "sheet" && rootOpen, () => onOpenChange(false));

  /* FOCUS RESTORATION, OWNED BY THE PRIMITIVE (MB-GOD-042).
   *
   * Radix restores focus to the trigger during its close sequence. Every call
   * site in this app passes `open={Boolean(someResource)}` and clears that
   * resource on close, so `open` goes false AND the whole Dialog subtree
   * unmounts in the SAME commit -- leaving Radix's restore step with nothing to
   * run from. Focus landed on <body>, and a keyboard user was returned to the
   * top of the document after every dialog.
   *
   * Eleven call sites share that shape, so this is fixed here rather than in
   * each: the element that had focus when the dialog opened is remembered, and
   * refocused when it closes. Guarded so it only acts when focus actually fell
   * to the body -- if Radix or the caller already moved focus somewhere
   * deliberate, that choice is left alone.
   */
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (rootOpen && !wasOpenRef.current) {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
      wasOpenRef.current = true;
      return;
    }
    if (!rootOpen && wasOpenRef.current) {
      wasOpenRef.current = false;
      const opener = openerRef.current;
      openerRef.current = null;
      if (!opener) return;
      /* After the close commit, so this cannot race Radix's own restore. If
         focus already went somewhere real, leave it there. */
      requestAnimationFrame(() => {
        if (document.activeElement !== document.body) return;
        if (!opener.isConnected) return;
        opener.focus({ preventScroll: true });
      });
    }
  }, [rootOpen]);

  const isSheet = variant === "sheet";
  return (
    <Dialog.Root open={rootOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "modal-drop-overlay fixed inset-0 backdrop-blur-[2px]",
            isSheet ? "bg-black/45" : "bg-black/25"
          )}
        />
        <Dialog.Content
          data-modal-owner={owner}
          /* THE RING WAS FOCUS, NOT DECORATION.
           *
           * Radix focuses the first focusable element on open, which is the
           * close button -- so every sheet opened with a bright focus ring
           * around its exit, reading as the loudest thing on screen. The
           * indicator is correct and stays; what was wrong is that leaving is
           * the first thing offered.
           *
           * Focus moves to the panel instead: the dialog is still announced,
           * Escape still closes, Tab still reaches the close button first, and
           * a keyboard user still gets a visible ring the moment they move.
           * Focus is not suppressed anywhere -- only redirected off the exit. */
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
          }}
          className={cn(
            "flex flex-col overflow-hidden border border-border/80 bg-card/95 outline-none supports-[backdrop-filter]:bg-card/90",
            compact ? "p-3" : "p-4",
            isSheet
              ? // Phone: pinned to the bottom, full width, safe-area padded,
                // slide-up entrance. From sm up it becomes the centred panel.
                "modal-sheet-panel fixed inset-x-0 bottom-0 max-h-[calc(88svh-env(safe-area-inset-top,0px))] w-full rounded-t-2xl border-x-0 border-b-0 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-18px_60px_hsl(var(--shadow)/0.28)] sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-16 sm:max-h-[calc(100svh-5rem)] sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:pb-4 sm:shadow-[0_18px_60px_hsl(var(--shadow)/0.24)]"
              : "modal-drop-panel fixed left-1/2 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] max-h-[calc(100svh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-1.5rem)] w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-2xl shadow-[0_18px_60px_hsl(var(--shadow)/0.24)] sm:top-16 sm:max-h-[calc(100svh-5rem)]",
            widthClassName,
            "max-w-[32rem]",
            isSheet && "sm:w-[calc(100%-1.5rem)]",
            // A hidden-title panel is a content surface, so it may be wider
            // than the 32rem form cap. Do not append `relative` here: fixed
            // positioning already establishes the containing block required
            // by the floated close button. tailwind-merge treats `relative`
            // and `fixed` as conflicting position utilities, so the later
            // `relative` removed `fixed` and placed the whole panel in normal
            // flow below the page while its overlay remained fixed on screen.
            hideTitle && "max-w-[36rem]"
          )}
        >
          {/* THE SHEET SHELL MARKER (§13).
              A bottom-anchored panel with no grabber reads as the page having
              slid up rather than as a dismissible sheet -- which is why a
              phone user reaches for the form and expects the whole surface to
              move. This is deliberately decorative: the sheet dismisses via
              the close button, Back and the overlay, and it does NOT drag, so
              a control implying a drag gesture would promise something that
              does not happen. Phone only; from sm up this is a centred panel. */}
          {isSheet ? (
            <div className="modal-sheet-grabber sm:hidden" aria-hidden="true" />
          ) : null}
          <div
            className={cn(
              "flex min-w-0 shrink-0 items-start justify-between gap-3",
              // Floated over the content it is hiding for, so the panel body
              // can run edge-to-edge underneath the close button.
              hideTitle && "pointer-events-none absolute inset-x-0 top-0 z-10 p-3"
            )}
          >
            {/* min-w-0 for the same reason as the body below: without it a long
                unbroken title grows this flex child past the panel and pushes
                the close button out of reach. */}
            <div className="min-w-0 space-y-1">
              <Dialog.Title className={cn("text-base font-semibold sm:text-lg", hideTitle && "sr-only")}>
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description
                  className={cn(
                    "text-xs leading-5 text-muted-foreground sm:text-sm",
                    hideTitle && "sr-only"
                  )}
                >
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "pointer-events-auto shrink-0",
                  // Over artwork the ghost button has no contrast, so it gets
                  // its own scrim rather than relying on the image behind it.
                  hideTitle && "bg-black/40 text-white hover:bg-black/60"
                )}
                aria-label="Close"
                title="Close"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          {/* Only this middle section scrolls, header and footer stay put,
              so a tall form never hides its own action buttons or clips the
              last invitee row behind them. */}
          <div
            data-modal-body="true"
            className={cn(
              /* This is a vertical scroller only. Explicitly hiding X overflow
                 matters because overflow-y:auto can otherwise make overflow-x
                 compute to auto as well, which lets touch/trackpad gestures pan
                 the modal body sideways even though the panel itself is fixed. */
              "min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto overscroll-contain touch-pan-y",
              hideTitle ? "mt-0" : compact ? "mt-2.5" : "mt-4"
            )}
          >
            {children}
          </div>
          {footer ? (
            <div className={cn("flex shrink-0 flex-wrap justify-end gap-2", compact ? "mt-3" : "mt-4")}>{footer}</div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
