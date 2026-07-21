import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Screen } from "../components/AppShell";
import { useAuth } from "../auth/AuthProvider";
import { api } from "../lib/api";

type Visibility = "visible" | "ghost" | "app_open_only";

const visibilityOptions: { value: Visibility; label: string; description: string }[] = [
  { value: "visible", label: "Visible", description: "Your glow can show to your chosen audience." },
  { value: "app_open_only", label: "App-open only", description: "Only visible while you have the app open." },
  { value: "ghost", label: "Ghost mode", description: "Completely hidden until you turn it off." }
];

export function SettingsScreen() {
  const { user, signOut } = useAuth();
  const [visibility, setVisibility] = useState<Visibility>("ghost");
  const [nearbyAlerts, setNearbyAlerts] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveVisibility(next: Visibility) {
    setVisibility(next);
    setBusy(true);
    const result = await api.post<{ ok: boolean; message: string }>("/api/settings/visibility", next);
    setBusy(false);
    setFeedback(result.ok ? result.data.message : result.error);
  }

  async function toggleNearby() {
    const next = !nearbyAlerts;
    setNearbyAlerts(next);
    setBusy(true);
    const result = await api.post<{ ok: boolean; message: string }>("/api/settings/notifications", {
      nearbyAlerts: next
    });
    setBusy(false);
    setFeedback(result.ok ? result.data.message : result.error);
  }

  return (
    <Screen title="Settings">
      <section className="glass-panel rounded-2xl p-5">
        <h2 className="text-sm font-semibold">Signed in as</h2>
        <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
      </section>

      <section className="glass-panel mt-4 rounded-2xl p-5">
        <h2 className="text-base font-semibold">Glow visibility</h2>
        <div className="mt-3 space-y-2">
          {visibilityOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={busy}
              onClick={() => void saveVisibility(option.value)}
              className={cn(
                "focus-ring w-full rounded-xl border p-3 text-left",
                visibility === option.value ? "border-primary bg-primary/10" : "border-border"
              )}
            >
              <p className="text-sm font-semibold">{option.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{option.description}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="glass-panel mt-4 flex items-center justify-between rounded-2xl p-5">
        <div className="pr-4">
          <h2 className="text-base font-semibold">Nearby alerts</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Get notified when a Muddy is close.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={nearbyAlerts}
          disabled={busy}
          onClick={() => void toggleNearby()}
          className={cn(
            "focus-ring relative h-7 w-12 shrink-0 rounded-full transition-colors",
            nearbyAlerts ? "bg-primary" : "bg-secondary"
          )}
        >
          <span
            className={cn(
              "absolute top-1 h-5 w-5 rounded-full bg-white transition-transform",
              nearbyAlerts ? "translate-x-6" : "translate-x-1"
            )}
          />
        </button>
      </section>

      {feedback ? <p className="mt-4 text-sm text-primary">{feedback}</p> : null}

      <Button variant="outline" className="mt-6 w-full" onClick={() => void signOut()}>
        <LogOut className="h-4 w-4" aria-hidden="true" />
        Sign out
      </Button>
    </Screen>
  );
}
