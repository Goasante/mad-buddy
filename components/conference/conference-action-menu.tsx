"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";

export function ConferenceActionMenu({
  label,
  children
}: {
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const node = rootRef.current;
      if (node && !node.contains(event.target as Node)) setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="focus-ring grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-52 overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-xl"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function ConferenceDeleteMenuItem({
  label,
  close,
  onDelete
}: {
  label: string;
  close: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={() => setConfirming(true)}
        className="focus-ring flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="h-4 w-4" />
        {label}
      </button>
    );
  }

  return (
    <div className="rounded-lg bg-destructive/8 p-2">
      <p className="px-1 text-xs text-muted-foreground">Remove this from Conference?</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="focus-ring min-h-9 flex-1 rounded-lg bg-secondary px-2 text-xs font-semibold"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            close();
            onDelete();
          }}
          className="focus-ring min-h-9 flex-1 rounded-lg bg-destructive px-2 text-xs font-semibold text-destructive-foreground"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
