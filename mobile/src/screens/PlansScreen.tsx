import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Spinner } from "../components/Spinner";
import { Modal } from "../components/Modal";
import { useOverlayDismiss } from "../lib/overlay";
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

type Invitee = { id: string; name: string; username: string };

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
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeBucket, setActiveBucket] = useState<Bucket>("upcoming");
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await api.get<{ plans: Plan[]; invitees: Invitee[] }>("/api/plans");
    setLoading(false);
    if (result.ok) {
      setPlans(result.data.plans);
      setInvitees(result.data.invitees ?? []);
    } else setFeedback(result.error);
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
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
        <p className="mt-1 text-sm text-muted-foreground">Make plans and organise meet-ups with your Muddies.</p>
      </header>

      <Button type="button" className="mt-4 w-full" onClick={() => setCreateOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        New plan
      </Button>

      <CreatePlanModal
        open={createOpen}
        invitees={invitees}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          void load();
        }}
      />

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

                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 w-full"
                  onClick={() => setExpandedId((id) => (id === plan.id ? null : plan.id))}
                >
                  View
                </Button>

                {expandedId === plan.id ? (
                  <div className="mt-3 space-y-3 border-t border-border pt-3">
                    {plan.placeText ? <p className="text-sm text-muted-foreground">📍 {plan.placeText}</p> : null}
                    {plan.description ? <p className="text-sm">{plan.description}</p> : null}
                    {plan.isHost ? (
                      <p className="text-xs font-medium text-primary">You're hosting this plan.</p>
                    ) : TERMINAL.has(plan.status) ? null : (
                      <div className="flex gap-2">
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
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreatePlanModal({
  open,
  invitees,
  onOpenChange,
  onCreated
}: {
  open: boolean;
  invitees: Invitee[];
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [place, setPlace] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setTitle("");
    setDate("");
    setTime("");
    setPlace("");
    setSelected(new Set());
    setError("");
  }

  async function create() {
    if (title.trim().length < 2) return setError("Give your plan a name.");
    setBusy(true);
    setError("");
    // Combine the optional date + time into a single start timestamp. Time
    // alone is ignored (no day to anchor it to), matching the web form.
    const scheduled = date.trim().length > 0;
    const startAt = scheduled ? new Date(`${date}T${time || "00:00"}`).toISOString() : undefined;
    const result = await api.post<{ ok: boolean; message: string }>("/api/plans", {
      title: title.trim(),
      planType: scheduled ? "scheduled" : "quick",
      startAt,
      placeType: "custom",
      customPlaceText: place.trim() || undefined,
      participantIds: selected.size > 0 ? [...selected] : undefined
    });
    setBusy(false);
    if (result.ok) {
      reset();
      onCreated();
    } else setError(result.error);
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      title="Create a plan"
      description="Add the details and invite your Muddies."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={create} disabled={busy || title.trim().length < 2}>
            {busy ? "Creating…" : "Create plan"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Plan name">
          <Input placeholder="Lunch later" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date (optional)">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Time (optional)">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>

        <Field label="Meeting area (optional)" hint="Use a general area, not an exact address.">
          <Input placeholder="A café or nearby area" value={place} onChange={(e) => setPlace(e.target.value)} />
        </Field>

        <Field label="Invite Muddies">
          <InviteSelect invitees={invitees} selected={selected} onChange={setSelected} />
        </Field>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </Modal>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold">{label}</p>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function InviteSelect({
  invitees,
  selected,
  onChange
}: {
  invitees: Invitee[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  useOverlayDismiss(open, () => setOpen(false));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  const summary =
    selected.size === 0
      ? "Select Muddies"
      : `${selected.size} ${selected.size === 1 ? "Muddy" : "Muddies"} invited`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="focus-ring flex w-full items-center justify-between rounded-md border border-border bg-card/70 px-3 py-2.5 text-left text-sm"
      >
        <span className={cn(selected.size === 0 && "text-muted-foreground")}>{summary}</span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-[110]" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="listbox"
            className="absolute left-0 right-0 top-full z-[120] mt-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-[0_18px_45px_rgba(0,0,0,0.5)]"
          >
            {invitees.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">Add Muddies first to invite them.</p>
            ) : (
              invitees.map((invitee) => {
                const checked = selected.has(invitee.id);
                return (
                  <button
                    key={invitee.id}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggle(invitee.id)}
                    className="focus-ring flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left active:bg-secondary"
                  >
                    <span
                      className={cn(
                        "grid h-5 w-5 shrink-0 place-items-center rounded border",
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      )}
                    >
                      {checked ? "✓" : ""}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{invitee.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">@{invitee.username}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
