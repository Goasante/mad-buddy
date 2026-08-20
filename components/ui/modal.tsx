"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
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
  hideTitle = false
}: ModalProps) {
  // Sheets are dismissible with the hardware/browser Back button, like a native
  // mobile sheet. No-op for the centred variant.
  useDismissOnBack(variant === "sheet" && open, () => onOpenChange(false));

  const isSheet = variant === "sheet";
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "modal-drop-overlay fixed inset-0 backdrop-blur-[2px]",
            isSheet ? "bg-black/45" : "bg-black/25"
          )}
        />
        <Dialog.Content
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
            // than the 32rem form cap, and needs relative positioning for the
            // floated close button.
            hideTitle && "relative max-w-[36rem]"
          )}
        >
          <div
            className={cn(
              "flex shrink-0 items-start justify-between gap-3",
              // Floated over the content it is hiding for, so the panel body
              // can run edge-to-edge underneath the close button.
              hideTitle && "pointer-events-none absolute inset-x-0 top-0 z-10 p-3"
            )}
          >
            <div className="space-y-1">
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
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overscroll-contain",
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
