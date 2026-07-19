"use client";

import { Bell, CalendarDays, Medal, Moon, Ribbon, type LucideIcon } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import {
  endExamModeAction,
  startExamModeAction,
  updateEngagementSettingsAction,
  type EngagementSettings
} from "@/app/(app)/engagement-actions";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/app-dropdown";
import { AppSwitch } from "@/components/ui/app-switch";
import { DEFAULT_DAILY_NOTIFICATION_BUDGET } from "@/lib/engagement/rules";
import { cn } from "@/lib/utils";

type FocusDuration = "2h" | "until_tonight" | "1w";
type BudgetValue = "0" | "2" | "4" | "6" | "8";

const focusDurations: Array<{ value: FocusDuration; label: string }> = [
  { value: "2h", label: "2 hours" },
  { value: "until_tonight", label: "Until tonight" },
  { value: "1w", label: "1 week" }
];

const budgetOptions = [0, 2, 4, 6, DEFAULT_DAILY_NOTIFICATION_BUDGET].map((value) => ({
  value: String(value) as BudgetValue,
  label: value === 0 ? "None" : `${value} notifications`
}));

function formatFocusEnd(value: string | null) {
  if (!value) return "Active until you turn it off";
  return `Ends ${new Date(value).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  })}`;
}

export function EngagementPage({ initialSettings }: { initialSettings: EngagementSettings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [focusDuration, setFocusDuration] = useState<FocusDuration>("until_tonight");
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  function save(next: EngagementSettings) {
    const previous = settings;
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
      if (!result.ok) setSettings(previous);
    });
  }

  function enableFocus(duration: FocusDuration) {
    startTransition(async () => {
      const result = await startExamModeAction({
        duration,
        allowCloseFriends: settings.examModeAllowCloseFriends
      });
      setFeedback(result.message);
      if (result.ok) {
        setSettings((current) => ({
          ...current,
          examModeActive: true,
          examModeUntil: result.endsAt ?? current.examModeUntil
        }));
      }
    });
  }

  function disableFocus() {
    startTransition(async () => {
      const result = await endExamModeAction();
      setFeedback(result.message);
      if (result.ok) {
        setSettings((current) => ({ ...current, examModeActive: false, examModeUntil: null }));
      }
    });
  }

  return (
    <div className="space-y-5">
      {feedback ? <p className="text-sm text-muted-foreground" role="status">{feedback}</p> : null}

      <section className="rounded-2xl border border-border/70 bg-card/50 p-4 sm:p-5" aria-labelledby="focus-mode-title">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <SettingIcon icon={Moon} active={settings.examModeActive} />
            <div>
              <h2 id="focus-mode-title" className="text-sm font-semibold">Focus Mode</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Reduce non-essential notifications while you focus. Close Friends and urgent updates can still reach you.
              </p>
            </div>
          </div>
          <AppSwitch
            label="Focus Mode"
            checked={settings.examModeActive}
            disabled={isPending}
            onCheckedChange={(checked) => checked ? enableFocus(focusDuration) : disableFocus()}
          />
        </div>

        <div className="mt-4 max-w-xs">
          <AppSelect
            id="focus-duration"
            label="Duration"
            value={focusDuration}
            options={focusDurations}
            size="compact"
            disabled={isPending}
            onChange={(duration) => {
              setFocusDuration(duration);
              if (settings.examModeActive) enableFocus(duration);
            }}
          />
        </div>

        {settings.examModeActive ? (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/[0.07] p-3 sm:flex-row sm:items-center">
            <Moon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Focus Mode active</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{formatFocusEnd(settings.examModeUntil)}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={disableFocus} disabled={isPending}>Resume now</Button>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border/70 bg-card/50 p-4" aria-labelledby="notification-limit-title">
        <div className="flex gap-3">
          <SettingIcon icon={Bell} />
          <div className="min-w-0 flex-1">
            <h2 id="notification-limit-title" className="text-sm font-semibold">Daily notification limit</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Limit low-priority notifications. Messages, Pings, plan changes, and security alerts still come through.
            </p>
            <AppSelect
              id="daily-notification-limit"
              value={String(settings.dailyNotificationBudget) as BudgetValue}
              options={budgetOptions}
              size="compact"
              className="mt-3 max-w-xs"
              disabled={isPending}
              onChange={(value) => save({ ...settings, dailyNotificationBudget: Number(value) })}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3" aria-label="Personal engagement preferences">
        <ToggleCard
          icon={CalendarDays}
          label="Monthly recap"
          hint="Receive a private summary of your month. Only you can see it."
          checked={settings.recapsEnabled}
          disabled={isPending}
          onChange={(value) => save({ ...settings, recapsEnabled: value })}
        >
          <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-xs">
            <span className="text-muted-foreground">Frequency</span>
            <span className="font-medium">Monthly</span>
          </div>
        </ToggleCard>
        <ToggleCard
          icon={Ribbon}
          label="Friendship milestones"
          hint="Private milestones shared only with that Muddy. No rankings or leaderboards."
          checked={settings.streaksEnabled}
          disabled={isPending}
          onChange={(value) => save({
            ...settings,
            streaksEnabled: value,
            streakNotificationsEnabled: value ? settings.streakNotificationsEnabled : false
          })}
        />
        <ToggleCard
          icon={Bell}
          label="Milestone reminders"
          hint="Receive an occasional reminder when a connection milestone is close."
          checked={settings.streakNotificationsEnabled}
          disabled={isPending || !settings.streaksEnabled}
          onChange={(value) => save({ ...settings, streakNotificationsEnabled: value })}
        />
        <ToggleCard
          icon={Medal}
          label="Personal achievements"
          hint="Private progress markers that are never ranked against anyone else."
          checked={settings.achievementsEnabled}
          disabled={isPending}
          onChange={(value) => save({ ...settings, achievementsEnabled: value })}
        />
      </section>
    </div>
  );
}

function SettingIcon({ icon: Icon, active = false }: { icon: LucideIcon; active?: boolean }) {
  return (
    <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", active ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground")}>
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}

function ToggleCard({ icon, label, hint, checked, disabled, onChange, children }: {
  icon: LucideIcon;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className={cn("rounded-2xl border border-border/70 bg-card/50 p-4", disabled && !checked && "opacity-65")}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <SettingIcon icon={icon} active={checked} />
          <div>
            <p className="text-sm font-semibold">{label}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p>
          </div>
        </div>
        <AppSwitch label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      </div>
      {children}
    </div>
  );
}
