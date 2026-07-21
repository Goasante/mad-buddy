import { useCallback, useEffect, useState } from "react";
import { Compass, Hand, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SOCIALIZE_ACTIVITIES,
  SOCIALIZE_AREA_TIERS,
  SOCIALIZE_DURATIONS,
  SOCIALIZE_ACTIVITY_LABELS
} from "@/lib/social/socialize";
import { cn } from "@/lib/utils";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/api";

type Session = { id: string; activity: string; note: string | null; areaTier: string; expiresAt: string };
type Person = {
  userId: string;
  displayName: string;
  username: string;
  activity: string;
  note: string | null;
  proximityTier: "very_close" | "nearby" | "around";
  waveState: "none" | "sent" | "received" | "accepted";
};

const tierLabels: Record<Person["proximityTier"], string> = {
  very_close: "Very close",
  nearby: "Nearby",
  around: "Around"
};

export function SocializeScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  // Activation form.
  const [activity, setActivity] = useState<string>(SOCIALIZE_ACTIVITIES[0]?.id ?? "");
  const [areaTier, setAreaTier] = useState<string>(SOCIALIZE_AREA_TIERS[0]?.id ?? "");
  const [duration, setDuration] = useState<string>(SOCIALIZE_DURATIONS[1]?.id ?? "1h");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const result = await api.get<{ session: Session | null }>("/api/socialize");
    if (result.ok) {
      setSession(result.data.session);
      if (result.data.session) {
        const discovered = await api.get<{ people: Person[] }>("/api/socialize/discover");
        if (discovered.ok) setPeople(discovered.data.people);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function activate() {
    setBusy(true);
    setFeedback("");
    const result = await api.post<{ ok: boolean; message: string }>("/api/socialize", {
      activity,
      areaTier,
      duration,
      note: note.trim() || undefined
    });
    setBusy(false);
    if (result.ok) await load();
    else setFeedback(result.error);
  }

  async function deactivate() {
    setBusy(true);
    await api.del("/api/socialize");
    setBusy(false);
    setSession(null);
    setPeople([]);
  }

  async function wave(person: Person) {
    setPeople((current) =>
      current.map((item) => (item.userId === person.userId ? { ...item, waveState: "sent" } : item))
    );
    await api.post("/api/friends/request", { targetUserId: person.userId });
  }

  if (loading) {
    return (
      <Screen title="Socialize">
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen title="Socialize">
        <section className="glass-panel rounded-2xl p-5">
          <div className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="text-lg font-semibold">Meet new people</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Turn on Socialize to discover others nearby who are also up for it. You only appear while it's on.
          </p>

          <Picker label="I'm up for" options={SOCIALIZE_ACTIVITIES} value={activity} onChange={setActivity} />
          <Picker label="Area" options={SOCIALIZE_AREA_TIERS} value={areaTier} onChange={setAreaTier} />
          <Picker label="For" options={SOCIALIZE_DURATIONS} value={duration} onChange={setDuration} />

          <div className="mt-4">
            <Input placeholder="Add a note (optional)" maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {feedback ? <p className="mt-3 text-sm text-destructive">{feedback}</p> : null}

          <Button className="mt-4 w-full" onClick={activate} disabled={busy}>
            {busy ? "Turning on…" : "Turn on Socialize"}
          </Button>
        </section>
      </Screen>
    );
  }

  return (
    <Screen
      title="Socialize"
      action={
        <Button size="sm" variant="outline" onClick={deactivate} disabled={busy}>
          Turn off
        </Button>
      }
    >
      <div className="mb-4 rounded-xl border border-primary/40 bg-primary/10 p-3 text-sm text-primary">
        You're visible as <span className="font-semibold">{SOCIALIZE_ACTIVITY_LABELS[session.activity as keyof typeof SOCIALIZE_ACTIVITY_LABELS] ?? session.activity}</span>.
      </div>

      <h2 className="mb-3 text-lg font-semibold">People around</h2>
      {people.length === 0 ? (
        <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
          No one nearby yet. Check back in a bit — you need to have shared your location on Home.
        </p>
      ) : (
        <ul className="space-y-2">
          {people.map((person) => (
            <li key={person.userId} className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
                {person.displayName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{person.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {SOCIALIZE_ACTIVITY_LABELS[person.activity as keyof typeof SOCIALIZE_ACTIVITY_LABELS] ?? person.activity}
                  {" · "}
                  {tierLabels[person.proximityTier]}
                </p>
              </div>
              {person.waveState === "sent" ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="h-4 w-4" aria-hidden="true" /> Waved
                </span>
              ) : (
                <Button size="sm" variant="outline" onClick={() => void wave(person)}>
                  <Hand className="h-4 w-4" aria-hidden="true" />
                  Wave
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

function Picker({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: ReadonlyArray<{ id: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              "focus-ring rounded-full border px-3 py-1.5 text-sm",
              value === option.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
