"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { X } from "lucide-react";
import { useId, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const desktopQuery = "(min-width: 768px)";

function subscribeToDesktop(callback: () => void) {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getDesktopSnapshot() {
  return window.matchMedia(desktopQuery).matches;
}

function getServerDesktopSnapshot() {
  return false;
}

export type ResponsiveFormPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  title: string;
  description?: string;
  closeLabel: string;
  children: ReactNode;
  footer: ReactNode;
  align?: "start" | "center" | "end";
  widthClassName?: string;
  compact?: boolean;
  /** Keep the form anchored to its trigger on every viewport size. */
  alwaysPopover?: boolean;
};

export function ResponsiveFormPopover({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  closeLabel,
  children,
  footer,
  align = "start",
  widthClassName = "w-[420px]",
  compact = false,
  alwaysPopover = false
}: ResponsiveFormPopoverProps) {
  const isDesktop = useSyncExternalStore(subscribeToDesktop, getDesktopSnapshot, getServerDesktopSnapshot);
  const generatedId = useId();
  const titleId = `${generatedId}-title`;
  const descriptionId = description ? `${generatedId}-description` : undefined;

  if (isDesktop || alwaysPopover) {
    return (
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <Popover.Trigger asChild>{trigger}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            align={align}
            side="bottom"
            sideOffset={8}
            collisionPadding={16}
            avoidCollisions
            className={cn(
              "responsive-form-popover flex max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-[0_20px_60px_hsl(var(--shadow)/0.3)] outline-none",
              widthClassName
            )}
            style={{
              maxHeight: "min(calc(100dvh - 32px), var(--radix-popover-content-available-height))"
            }}
          >
            <FormHeader
              title={title}
              description={description}
              titleId={titleId}
              descriptionId={descriptionId}
              closeLabel={closeLabel}
              onClose={() => onOpenChange(false)}
              compact={compact}
            />
            <FormBody compact={compact}>{children}</FormBody>
            <FormFooter compact={compact}>{footer}</FormFooter>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="responsive-form-sheet-overlay fixed inset-0 bg-black/45" />
        <Dialog.Content
          aria-describedby={descriptionId}
          className="responsive-form-sheet fixed inset-x-0 bottom-0 flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl border-x border-t border-border bg-card text-foreground shadow-[0_-18px_60px_hsl(var(--shadow)/0.3)] outline-none"
        >
          <div
            className={cn(
              "sticky top-0 z-[1] flex shrink-0 items-start justify-between gap-4 border-b border-border bg-card px-4",
              compact ? "py-3" : "py-3.5"
            )}
          >
            <div className="min-w-0 pt-1">
              <Dialog.Title id={titleId} className="text-base font-semibold leading-6">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description id={descriptionId} className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <CloseButton label={closeLabel} />
            </Dialog.Close>
          </div>
          <FormBody compact={compact}>{children}</FormBody>
          <FormFooter compact={compact}>{footer}</FormFooter>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FormHeader({
  title,
  description,
  titleId,
  descriptionId,
  closeLabel,
  onClose,
  compact
}: {
  title: string;
  description?: string;
  titleId: string;
  descriptionId?: string;
  closeLabel: string;
  onClose: () => void;
  compact: boolean;
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-[1] flex shrink-0 items-start justify-between gap-4 border-b border-border bg-card",
        compact ? "px-4 py-3" : "px-5 py-4"
      )}
    >
      <div className="min-w-0">
        <h2 id={titleId} className="text-base font-semibold leading-6">
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <CloseButton label={closeLabel} onClick={onClose} />
    </div>
  );
}

function CloseButton({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="focus-ring safe-motion grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function FormBody({ children, compact }: { children: ReactNode; compact: boolean }) {
  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5",
        compact ? "space-y-3 py-3" : "space-y-4 py-4"
      )}
    >
      {children}
    </div>
  );
}

function FormFooter({ children, compact }: { children: ReactNode; compact: boolean }) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-[1] flex shrink-0 items-center justify-between gap-3 border-t border-border bg-card px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5",
        compact ? "pt-3 sm:py-3" : "pt-3 sm:py-4"
      )}
    >
      {children}
    </div>
  );
}
