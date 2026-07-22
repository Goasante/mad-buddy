import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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

type Bucket = "upcoming" | "invites" | "hosting" | "past";
const bucketTabs: { id: Bucket; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "invites", label: "Invitations" },
  { id: "hosting", label: "Created by you" },
  { id: "past", label: "Past" }
];

const TERMINAL = new Set(["completed", "cancelled"]);

function bucketFor(plan: Plan): Bucket {
  if (TERMINAL.has(plan.status)) return "past";
  if (plan.myRsvp === "invited") return "invites";
  if (plan.isHost) return "hosting";
  return "upcoming";
}

function dateLabel(plan: Plan): string {
  if (!plan.startAt) return "Anytime";
  return new Date(plan.startAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const rsvpChoices = [
  { value: "going", label: "Going" },
  { value: "maybe", label: "Maybe" },
  { value: "not_going", label: "Can't" }
];

export function PlansScreen() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeBucket, setActiveBucket] = useState<Bucket>("upcoming");
  const [createOpen, setCreateOpen] = useState(false);
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

  const visible = useMemo(() => plans.filter((plan) => bucketFor(plan) === activeBucket), [plans, activeBucket]);

  async function rsvp(planId: string, status: string) {
    const result = await api.post<{ ok: boolean; message: string }>(`/api/plans/${planId}/rsvp`, { status });
    if (result.ok) void load();
    else setFeedback(result.error);
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 pt-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
        <Button type="button" className="shrink-0" onClick={() => setCreateOpen((v) => !v)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New plan
        </Button>
      </header>

      {createOpen ? (
        <CreatePlan
          onCreated={() => {
            setCreateOpen(false);
            void load();
          }}
        />
      ) : null}

      {feedback ? (
        <div className="mt-4 rounded-[1rem] border border-orange-400/20 bg-orange-400/10 p-3 text-sm text-orange-50" role="status">
          {feedback}
        </div>
      ) : null}

      <nav className="mt-4 overflow-x-auto border-b border-border/70" aria-label="Plans tabs">
        <div className="flex min-w-max gap-1">
          {bucketTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveBucket(tab.id)}
              className={cn(
                "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium",
                activeBucket === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : visible.length === 0 ? (
        <p className="mt-6 rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
          {activeBucket === "invites"
            ? "New plan invitations will appear here."
            : activeBucket === "past"
              ? "Past plans will appear here."
              : "No plans yet. Tap “New plan” to make one."}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {visible.map((plan) => (
            <li key={plan.id}>
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Users className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold">{plan.title}</h3>
                      {plan.isHost ? <Badge variant="orange">Host</Badge> : null}
                      {plan.myRsvp === "invited" ? <Badge variant="violet">Invited</Badge> : null}
                      {TERMINAL.has(plan.status) ? <Badge>{plan.status}</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{dateLabel(plan)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Organised by {plan.organiserName} · {plan.attendeeCount} {plan.attendeeCount === 1 ? "Muddy" : "Muddies"}
                      {plan.goingCount > 0 ? ` · ${plan.goingCount} going` : ""}
                    </p>
                  </div>
                </div>

                {plan.isHost || TERMINAL.has(plan.status) ? null : (
                  <div className="mt-3 flex gap-2">
                    {rsvpChoices.map((choice) => (
                      <button
                        key={choice.value}
                        type="button"
                        onClick={() => void rsvp(plan.id, choice.value)}
                        className={cn(
                          "focus-ring flex-1 rounded-lg border py-1.5 text-sm",
                          plan.myRsvp === choice.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                        )}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
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
    const result = await api.post<{ ok: boolean; message: string }>("/api/plans", {
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
    <Card className="mt-4 space-y-3 p-4">
      <p className="text-sm font-semibold">Create plan</p>
      <Input placeholder="Lunch later" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea placeholder="Details (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="space-y-1.5">
        <label htmlFor="when" className="text-xs font-medium text-muted-foreground">When (optional)</label>
        <Input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      <Input placeholder="A café or nearby area" value={place} onChange={(e) => setPlace(e.target.value)} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button className="w-full" onClick={create} disabled={busy}>
        {busy ? "Creating…" : "Create plan"}
      </Button>
    </Card>
  );
}
