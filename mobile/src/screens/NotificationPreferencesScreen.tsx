import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizePreferences,
  type CategorySetting,
  type NotificationCategory,
  type NotificationPreferences
} from "@/lib/notifications/preferences";
import { cn } from "@/lib/utils";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";

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

export function NotificationPreferencesScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("user_preferences")
      .select("notification_preferences")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const raw = (data?.notification_preferences ?? {}) as { smart?: unknown };
        setPrefs(normalizePreferences(raw.smart));
      });
  }, [user]);

  function setCategory(category: NotificationCategory, setting: CategorySetting) {
    setPrefs((current) => ({ ...current, categories: { ...current.categories, [category]: setting } }));
  }

  async function save() {
    setBusy(true);
    setFeedback("");
    const result = await api.post<{ ok: boolean; message: string }>("/api/settings/notification-preferences", prefs);
    setBusy(false);
    setFeedback(result.ok ? "Notification settings saved." : result.error);
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 pt-6">
      <header className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border/70 text-muted-foreground hover:bg-secondary"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Notification preferences</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Decide what's worth interrupting you for.</p>
        </div>
      </header>

      <section className="space-y-3">
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
                      : "border-border text-muted-foreground"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="mt-4 rounded-xl border border-border/70 bg-card/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Quiet hours</span>
            <span className="block text-xs text-muted-foreground">Pause pushes overnight. Critical account alerts still come through.</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.quietHoursEnabled}
            aria-label="Quiet hours"
            onClick={() => setPrefs((current) => ({ ...current, quietHoursEnabled: !current.quietHoursEnabled }))}
            className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", prefs.quietHoursEnabled ? "bg-primary" : "bg-secondary")}
          >
            <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-white transition-transform", prefs.quietHoursEnabled ? "translate-x-6" : "translate-x-1")} />
          </button>
        </div>
        {prefs.quietHoursEnabled ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              From
              <input
                type="time"
                value={minuteToTimeInput(prefs.quietHoursStartMinute)}
                onChange={(event) => setPrefs((current) => ({ ...current, quietHoursStartMinute: timeInputToMinute(event.target.value) }))}
                className="focus-ring h-9 rounded-md border border-border bg-card/70 px-2"
              />
            </label>
            <label className="flex items-center gap-2">
              to
              <input
                type="time"
                value={minuteToTimeInput(prefs.quietHoursEndMinute)}
                onChange={(event) => setPrefs((current) => ({ ...current, quietHoursEndMinute: timeInputToMinute(event.target.value) }))}
                className="focus-ring h-9 rounded-md border border-border bg-card/70 px-2"
              />
            </label>
          </div>
        ) : null}
      </section>

      {feedback ? <p className="mt-4 text-sm text-muted-foreground" role="status">{feedback}</p> : null}

      <Button type="button" className="mt-4 w-full" onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save preferences"}
      </Button>
    </div>
  );
}
