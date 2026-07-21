import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/api";

type Plan = {
  id: string;
  title: string;
  description: string | null;
  planType: string;
  status: string;
  startAt: string | null;
  placeText: string | null;
  organiserName: string;
  isHost: boolean;
  myRsvp: string;
  goingCount: number;
  attendeeCount: number;
};

const rsvpChoices: { value: string; label: string }[] = [
  { value: "going", label: "Going" },
  { value: "maybe", label: "Maybe" },
  { value: "not_going", label: "Can't" }
];

export function PlansScreen() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await api.get<{ plans: Plan[] }>("/api/plans");
    setLoading(false);
    if (result.ok) setPlans(result.data.plans);
    else setFeedback(result.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function rsvp(planId: string, status: string) {
    const result = await api.post<{ ok: boolean; message: string }>(`/api/plans/${planId}/rsvp`, { status });
    if (result.ok) void load();
    else setFeedback(result.error);
  }

  return (
    <Screen
      title="Plans"
      action={
        <Button size="sm" onClick={() => setShowCreate((value) => !value)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New
        </Button>
      }
    >
      {showCreate ? (
        <CreatePlan
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      ) : null}

      {feedback ? <p className="mb-3 text-sm text-primary">{feedback}</p> : null}

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : plans.length === 0 ? (
        <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
          No plans yet. Tap “New” to make one.
        </p>
      ) : (
        <ul className="space-y-3">
          {plans.map((plan) => (
            <li key={plan.id} className="glass-panel rounded-2xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">{plan.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {plan.organiserName} · {plan.goingCount} going
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
                  {plan.status}
                </span>
              </div>
              {plan.description ? <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p> : null}
              {plan.startAt ? (
                <p className="mt-2 text-xs text-muted-foreground">{new Date(plan.startAt).toLocaleString()}</p>
              ) : null}
              {plan.placeText ? <p className="text-xs text-muted-foreground">📍 {plan.placeText}</p> : null}

              {!plan.isHost ? (
                <div className="mt-3 flex gap-2">
                  {rsvpChoices.map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
                      onClick={() => void rsvp(plan.id, choice.value)}
                      className={cn(
                        "focus-ring flex-1 rounded-lg border py-1.5 text-sm",
                        plan.myRsvp === choice.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground"
                      )}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs font-medium text-primary">You're hosting</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

function CreatePlan({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [when, setWhen] = useState("");
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (title.trim().length < 2) return setError("Give your plan a title.");
    setBusy(true);
    setError("");
    const scheduled = when.trim().length > 0;
    const result = await api.post<{ ok: boolean; message: string; planId?: string }>("/api/plans", {
      title: title.trim(),
      description: description.trim() || undefined,
      planType: scheduled ? "scheduled" : "quick",
      startAt: scheduled ? new Date(when).toISOString() : undefined,
      placeType: "custom",
      customPlaceText: place.trim() || undefined
    });
    setBusy(false);
    if (result.ok) onCreated();
    else setError(result.error);
  }

  return (
    <section className="glass-panel mb-4 space-y-3 rounded-2xl p-4">
      <Input placeholder="What's the plan?" value={title} onChange={(event) => setTitle(event.target.value)} />
      <Textarea placeholder="Details (optional)" value={description} onChange={(event) => setDescription(event.target.value)} />
      <div className="space-y-1.5">
        <label htmlFor="when" className="text-xs font-medium text-muted-foreground">When (optional)</label>
        <Input id="when" type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} />
      </div>
      <Input placeholder="Where (optional)" value={place} onChange={(event) => setPlace(event.target.value)} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button className="w-full" onClick={create} disabled={busy}>
        {busy ? "Creating…" : "Create plan"}
      </Button>
    </section>
  );
}
