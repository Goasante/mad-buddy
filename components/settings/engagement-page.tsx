"use client";

import { BookOpen, Bell } from "lucide-react";
import { useState, useTransition } from "react";
import {
  endExamModeAction,
  startExamModeAction,
  updateEngagementSettingsAction,
  type EngagementSettings
} from "@/app/(app)/engagement-actions";
import { Button } from "@/components/ui/button";
import { DEFAULT_DAILY_NOTIFICATION_BUDGET } from "@/lib/engagement/rules";
import { cn } from "@/lib/utils";

const examDurations: Array<{ id: "2h" | "until_tonight" | "1w"; label: string }> = [
  { id: "2h", label: "2 hours" },
  { id: "until_tonight", label: "Until tonight" },
  { id: "1w", label: "1 week" }
];

// Only ever at or below the default, a stricter budget, never a looser one.
const budgetOptions = [0, 2, 4, 6, DEFAULT_DAILY_NOTIFICATION_BUDGET];

/**
 * Engagement controls (spec §41). Every feature here can be switched off, and
 * nothing on this page pressures the user to keep it on.
 */
export function EngagementPage({ initialSettings }: { initialSettings: EngagementSettings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  function save(next: EngagementSettings) {
    setSettings(next);
    startTransition(async () => {
      const result = await updateEngagementSettingsAction({
        recapsEnabled: next.recapsEnabled,
        streaksEnabled: next.streaksEnabled,
        achievementsEnabled: next.achievementsEnabled,
        streakNotificationsEnabled: next.streakNotificationsEnabled,
        dailyNotificationBudget: next.dailyNotificationBudget
      });
      setFeedback(result.message);
    });
  }

  function startExam(duration: "2h" | "until_tonight" | "1w") {
    startTransition(async () => {
      const result = await startExamModeAction({ duration, allowCloseFriends: settings.examModeAllowCloseFriends });
      setFeedback(result.message);
      if (result.ok) setSettings((current) => ({ ...current, examModeActive: true }));
    });
  }

  function endExam() {
    startTransition(async () => {
      const result = await endExamModeAction();
      setFeedback(result.message);
      if (result.ok) setSettings((current) => ({ ...current, examModeActive: false, examModeUntil: null }));
    });
  }

  return (
    <div className="space-y-6">
      {feedback ? (
        <p className="text-sm text-muted-foreground" role="status">
          {feedback}
        </p>
      ) : null}

      <section className="rounded-xl border border-border/70 bg-card/50 p-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <BookOpen className="h-4 w-4 text-primary" aria-hidden="true" />
          Exam Mode
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Quietens social notifications while you focus. Close Friends can still reach you, and anything urgent
          still comes through.
        </p>
        {settings.examModeActive ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-primary">
              On{settings.examModeUntil ? ` until ${new Date(settings.examModeUntil).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={endExam} disabled={isPending}>
              Turn off
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {examDurations.map((option) => (
              <Button
                key={option.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => startExam(option.id)}
                disabled={isPending}
              >
                {option.label}
              </Button>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border/70 bg-card/50 p-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Bell className="h-4 w-4 text-primary" aria-hidden="true" />
          Daily notification limit
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          How many low-priority pushes a day. Messages, Pings, plan changes and security alerts always come through.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {budgetOptions.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => save({ ...settings, dailyNotificationBudget: option })}
              aria-pressed={settings.dailyNotificationBudget === option}
              className={cn(
                "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
                settings.dailyNotificationBudget === option
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary"
              )}
            >
              {option === 0 ? "None" : option}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <Toggle
          label="Monthly recap"
          hint="A private summary of your month. Only you can see it."
          checked={settings.recapsEnabled}
          onChange={(value) => save({ ...settings, recapsEnabled: value })}
        />
        <Toggle
          label="Friendship streaks"
          hint="Private to you and that Muddy. Never ranked or shared."
          checked={settings.streaksEnabled}
          onChange={(value) => save({ ...settings, streaksEnabled: value })}
        />
        <Toggle
          label="Streak reminders"
          hint="One gentle nudge at most. No countdowns."
          checked={settings.streakNotificationsEnabled}
          onChange={(value) => save({ ...settings, streakNotificationsEnabled: value })}
        />
        <Toggle
          label="Achievements"
          hint="Private milestones. No leaderboards."
          checked={settings.achievementsEnabled}
          onChange={(value) => save({ ...settings, achievementsEnabled: value })}
        />
      </section>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/50 p-3">
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-muted")}
      >
        <span
          className={cn(
            "absolute top-1 h-4 w-4 rounded-full bg-white transition-transform",
            checked ? "translate-x-6" : "translate-x-1"
          )}
        />
      </button>
    </label>
  );
}
