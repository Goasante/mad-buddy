"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
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
};

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  compact = false,
  widthClassName = "max-w-md"
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-drop-overlay fixed inset-0 bg-black/25 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "modal-drop-panel fixed left-1/2 top-3 flex max-h-[calc(100svh-1.5rem)] w-[calc(100%-1.5rem)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl sm:top-16 sm:max-h-[calc(100svh-5rem)]",
            widthClassName,
            "max-w-[32rem]",
            compact ? "p-3" : "p-4",
            "border border-border/80 bg-card/95 shadow-[0_18px_60px_hsl(var(--shadow)/0.24)] outline-none supports-[backdrop-filter]:bg-card/90"
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
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Close" title="Close">
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
