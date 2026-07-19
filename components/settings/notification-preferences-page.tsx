"use client";

import { useState, useTransition } from "react";
import { updateSmartNotificationPreferencesAction } from "@/app/(app)/settings-actions";
import { Button } from "@/components/ui/button";
import { AppSwitch } from "@/components/ui/app-switch";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import {
  type CategorySetting,
  type NotificationCategory,
  type NotificationPreferences
} from "@/lib/notifications/preferences";
import { cn } from "@/lib/utils";

const categoryMeta: Array<{ id: NotificationCategory; label: string; description: string }> = [
  { id: "waves", label: "Waves", description: "When a Muddy waves at you." },
  { id: "pings", label: "Meeting Pings", description: "When someone wants to meet." },
  { id: "proximity", label: "Nearby Muddies", description: "When friends become nearby." },
  { id: "plans", label: "Plans", description: "Invites, changes, and reminders." },
  { id: "status", label: "Status updates", description: "When friends set a status." }
];

const settingOptions: Array<{ id: CategorySetting; label: string }> = [
  { id: "all", label: "All" },
  { id: "close_friends", label: "Close Friends" },
  { id: "in_app_only", label: "In-app only" },
  { id: "off", label: "Off" }
];

function minuteToTimeInput(minute: number): string {
  const h = Math.floor(minute / 60).toString().padStart(2, "0");
  const m = (minute % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function timeInputToMinute(value: string): number {
  const [h, m] = value.split(":").map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export function NotificationPreferencesPage({
  initialPreferences
}: {
  initialPreferences: NotificationPreferences;
}) {
  const [prefs, setPrefs] = useState(initialPreferences);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  function setCategory(category: NotificationCategory, setting: CategorySetting) {
    setPrefs((current) => ({
      ...current,
      categories: { ...current.categories, [category]: setting }
    }));
  }

  function save() {
    startTransition(async () => {
      const result = await updateSmartNotificationPreferencesAction(prefs);
      setFeedback(result.message);
    });
  }

  return (
    <div className="mr-auto max-w-[640px] space-y-6 pt-6">
      <SettingsSubHeader title="Notification preferences" description="Decide what's worth interrupting you for." />

      <section className="space-y-4">
        {categoryMeta.map((category) => (
          <div key={category.id} className="rounded-xl border border-border/70 bg-card/50 p-3">
            <p className="text-sm font-semibold">{category.label}</p>
            <p className="mb-2 text-xs text-muted-foreground">{category.description}</p>
            <div className="flex flex-wrap gap-1.5">
              {settingOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setCategory(category.id, option.id)}
                  aria-pressed={prefs.categories[category.id] === option.id}
                  className={cn(
                    "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
                    prefs.categories[category.id] === option.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-border/70 bg-card/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold">Quiet hours</span>
            <span className="block text-xs text-muted-foreground">Pause pushes overnight. Critical account alerts still come through.</span>
          </span>
          <AppSwitch
            label="Quiet hours"
            checked={prefs.quietHoursEnabled}
            onCheckedChange={(checked) => setPrefs((current) => ({ ...current, quietHoursEnabled: checked }))}
          />
        </div>
        {prefs.quietHoursEnabled ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              From
              <input
                type="time"
                value={minuteToTimeInput(prefs.quietHoursStartMinute)}
                onChange={(event) => setPrefs((current) => ({ ...current, quietHoursStartMinute: timeInputToMinute(event.target.value) }))}
                className="focus-ring safe-motion h-9 rounded-md border border-border bg-card/70 px-2"
              />
            </label>
            <label className="flex items-center gap-2">
              to
              <input
                type="time"
                value={minuteToTimeInput(prefs.quietHoursEndMinute)}
                onChange={(event) => setPrefs((current) => ({ ...current, quietHoursEndMinute: timeInputToMinute(event.target.value) }))}
                className="focus-ring safe-motion h-9 rounded-md border border-border bg-card/70 px-2"
              />
            </label>
          </div>
        ) : null}
      </section>

      {feedback ? <p className="text-sm text-muted-foreground" role="status">{feedback}</p> : null}

      <Button type="button" onClick={save} disabled={isPending}>
        Save preferences
      </Button>
    </div>
  );
}
