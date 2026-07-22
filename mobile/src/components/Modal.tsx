import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useOverlayDismiss } from "../lib/overlay";

/**
 * Shared mobile modal. Ties into the global overlay stack, so tapping the
 * backdrop, pressing Escape, and the Android hardware back button all close it
 * (single source of truth — see lib/overlay + useAndroidBack). Background scroll
 * is locked only while open, per the overlay directive.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useOverlayDismiss(open, () => onOpenChange(false));

  // Lock background scroll only while the modal is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      {/* Dimmed, dismissible backdrop (modal — opaque is fine, unlike compact dropdowns). */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => onOpenChange(false)} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute left-1/2 top-3 flex max-h-[calc(100svh-1.5rem)] w-[calc(100%-1.5rem)] max-w-[32rem] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card p-4 shadow-[0_18px_60px_rgba(0,0,0,0.5)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{title}</h2>
            {description ? <p className="text-sm leading-5 text-muted-foreground">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {/* Only the middle scrolls; header + footer stay put so actions never hide. */}
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">{children}</div>
        {footer ? <div className="mt-4 flex shrink-0 flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}
