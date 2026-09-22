"use client";

import { cn } from "@/lib/utils";

export type MoodStatus = "open" | "busy" | "exploring" | "quiet";

export type MoodStatusSelectorProps = {
  value: MoodStatus | null;
  onChange: (value: MoodStatus) => void;
};

const moods: Array<{ value: MoodStatus; label: string; description: string }> = [
  { value: "open", label: "Open", description: "Ready to connect." },
  { value: "busy", label: "Busy", description: "Keeping it low-key." },
  { value: "exploring", label: "Exploring", description: "Open to plans." },
  { value: "quiet", label: "Quiet", description: "Fewer prompts." }
];

export function MoodStatusSelector({ value, onChange }: MoodStatusSelectorProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {moods.map((mood) => (
        <button
          key={mood.value}
          type="button"
          className={cn(
            "focus-ring safe-motion rounded-xl border p-3 text-left",
            value === mood.value
              ? "border-accent bg-emerald-300/10"
              : "border-white/15 bg-white/[0.04] hover:bg-white/[0.08]"
          )}
          onClick={() => onChange(mood.value)}
        >
          <span className="text-sm font-semibold">{mood.label}</span>
          <span className="mt-1 block text-[0.6875rem] leading-4 text-muted-foreground">
            {mood.description}
          </span>
        </button>
      ))}
    </div>
  );
}
