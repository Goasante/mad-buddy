"use client";

import { Check, Laptop, Moon, Sun } from "lucide-react";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { useTheme, type AccentColor, type ThemePreference } from "@/components/theme/theme-provider";
import { cn } from "@/lib/utils";

const themeOptions: Array<{ id: ThemePreference; label: string; icon: typeof Sun }> = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Laptop }
];

const accentOptions: Array<{ id: AccentColor; label: string; swatch: string }> = [
  { id: "orange", label: "Orange", swatch: "#f97316" },
  { id: "blue", label: "Blue", swatch: "#3b82f6" },
  { id: "violet", label: "Violet", swatch: "#8b5cf6" },
  { id: "green", label: "Green", swatch: "#22c55e" },
  { id: "red", label: "Red", swatch: "#ef4444" },
  { id: "teal", label: "Teal", swatch: "#14b8a6" }
];

export function AppearanceSettingsPage() {
  const { preference, setPreference, accentColor, setAccentColor } = useTheme();

  return (
    <div className="mr-auto max-w-[720px] space-y-6 pt-6">
      <SettingsSubHeader title="Appearance" description="Make Mad Buddy yours." />

      <section>
        <h2 className="text-sm font-semibold">Theme</h2>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {themeOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setPreference(option.id)}
              aria-pressed={preference === option.id}
              className={cn(
                "focus-ring safe-motion flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium",
                preference === option.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary"
              )}
            >
              <option.icon className="h-5 w-5" aria-hidden="true" />
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Accent color</h2>
        <p className="mt-1 text-xs text-muted-foreground">Pick your favorite accent.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {accentOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setAccentColor(option.id)}
              aria-pressed={accentColor === option.id}
              aria-label={option.label}
              title={option.label}
              className="focus-ring safe-motion grid h-11 w-11 place-items-center rounded-full border-2 transition-colors"
              style={{ borderColor: accentColor === option.id ? option.swatch : "transparent" }}
            >
              <span
                className="grid h-8 w-8 place-items-center rounded-full"
                style={{ backgroundColor: option.swatch }}
              >
                {accentColor === option.id ? <Check className="h-4 w-4 text-white" aria-hidden="true" /> : null}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Preview</h2>
        <div className="mt-3 space-y-2 rounded-xl border border-border/70 bg-card/50 p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-primary text-xs font-bold">N</span>
            <div>
              <p className="text-sm font-medium">Nana</p>
              <p className="text-xs text-muted-foreground">Hey! Are we still on for dinner tomorrow?</p>
            </div>
          </div>
          <button type="button" className="focus-ring safe-motion rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            Sample button
          </button>
        </div>
      </section>
    </div>
  );
}
