"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type PrivacyToggleProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
};

export function PrivacyToggle({
  icon: Icon,
  title,
  description,
  checked,
  onCheckedChange,
  disabled = false
}: PrivacyToggleProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "focus-ring safe-motion flex min-h-[4.25rem] w-full items-center justify-between gap-4 px-2 py-3 text-left",
        disabled ? "cursor-not-allowed opacity-50" : "hover:bg-secondary/40"
      )}
      onClick={() => {
        if (!disabled) onCheckedChange(!checked);
      }}
      aria-pressed={checked}
      aria-label={title}
      title={title}
    >
      <div className="flex gap-3">
        <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", checked ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors motion-reduce:transition-none",
          checked ? "bg-accent" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "absolute top-1 h-4 w-4 rounded-full bg-white transition-transform motion-reduce:transition-none",
            checked ? "translate-x-6" : "translate-x-1"
          )}
        />
      </span>
    </button>
  );
}
