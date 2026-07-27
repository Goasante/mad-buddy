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
  variant = "center"
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
          className={cn(
            "flex flex-col overflow-hidden border border-border/80 bg-card/95 outline-none supports-[backdrop-filter]:bg-card/90",
            compact ? "p-3" : "p-4",
            isSheet
              ? // Phone: pinned to the bottom, full width, safe-area padded,
                // slide-up entrance. From sm up it becomes the centred panel.
                "modal-sheet-panel fixed inset-x-0 bottom-0 max-h-[88svh] w-full rounded-t-2xl border-x-0 border-b-0 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-18px_60px_hsl(var(--shadow)/0.28)] sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-16 sm:max-h-[calc(100svh-5rem)] sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:pb-4 sm:shadow-[0_18px_60px_hsl(var(--shadow)/0.24)]"
              : "modal-drop-panel fixed left-1/2 top-3 max-h-[calc(100svh-1.5rem)] w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-2xl shadow-[0_18px_60px_hsl(var(--shadow)/0.24)] sm:top-16 sm:max-h-[calc(100svh-5rem)]",
            widthClassName,
            "max-w-[32rem]",
            isSheet && "sm:w-[calc(100%-1.5rem)]"
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-3">
            <div className="space-y-1">
              <Dialog.Title className="text-base font-semibold sm:text-lg">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-xs leading-5 text-muted-foreground sm:text-sm">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label="Close" title="Close">
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          {/* Only this middle section scrolls, header and footer stay put,
              so a tall form never hides its own action buttons or clips the
              last invitee row behind them. */}
          <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", compact ? "mt-2.5" : "mt-4")}>
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
