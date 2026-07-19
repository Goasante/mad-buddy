"use client";

import { cn } from "@/lib/utils";

type SwitchTrackProps = {
  checked: boolean;
  disabled?: boolean;
  className?: string;
};

export function SwitchTrack({ checked, disabled = false, className }: SwitchTrackProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative isolate block h-7 w-12 shrink-0 overflow-hidden rounded-full border shadow-inner",
        "transition-[background-color,border-color,box-shadow] duration-300 ease-in-out motion-reduce:transition-none",
        checked
          ? "border-primary bg-primary shadow-[inset_0_1px_2px_hsl(var(--shadow)/0.16)]"
          : "border-border bg-muted shadow-[inset_0_1px_3px_hsl(var(--shadow)/0.18)]",
        disabled && "opacity-55",
        className
      )}
    >
      <span
        className={cn(
          "absolute left-1 top-1 block h-5 w-5 rounded-full bg-white shadow-[0_2px_7px_rgba(0,0,0,0.28)]",
          "transition-transform duration-300 ease-in-out motion-reduce:transition-none",
          checked ? "translate-x-5" : "translate-x-0"
        )}
      />
    </span>
  );
}

type AppSwitchProps = SwitchTrackProps & {
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

export function AppSwitch({ checked, disabled = false, label, onCheckedChange, className }: AppSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "focus-ring inline-flex min-h-11 min-w-12 shrink-0 items-center justify-center rounded-full",
        "transition-transform duration-300 ease-in-out active:scale-[0.98] motion-reduce:transition-none",
        disabled && "cursor-not-allowed",
        className
      )}
    >
      <SwitchTrack checked={checked} disabled={disabled} />
    </button>
  );
}
