"use client";

import { useSearchParams } from "next/navigation";
import {
  CalendarCheck2,
  MapPin,
  MessageCircle,
  Plus,
  Users,
  Vote
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/auth/form-field";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PreviewNotice } from "@/components/ui/preview-notice";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type PlanType = "hangout" | "study" | "sports" | "other";
type PlanBucket = "upcoming" | "invites" | "hosting" | "past";
type Rsvp = "going" | "maybe" | "invited" | "declined";

type PlanAttendee = { name: string; rsvp: Rsvp };

type Plan = {
  id: string;
  title: string;
  type: PlanType;
  dateLabel: string;
  location: string;
  description: string;
  hostName: string;
  isHost: boolean;
  bucket: PlanBucket;
  attendees: PlanAttendee[];
  myRsvp: Rsvp;
};

const planTypeMeta: Record<PlanType, { label: string; icon: typeof CalendarCheck2 }> = {
  hangout: { label: "Hangout", icon: Users },
  study: { label: "Study", icon: CalendarCheck2 },
  sports: { label: "Sports", icon: Users },
  other: { label: "Other", icon: CalendarCheck2 }
};

const seedPlans: Plan[] = [
  {
    id: "plan-1",
    title: "Study Session",
    type: "study",
    dateLabel: "Today · 5:30 PM",
    location: "Legon Library · Study Room 2",
    description: "Let's prepare for the midterms together. Bring your notes!",
    hostName: "Kojo Mensah",
    isHost: false,
    bucket: "upcoming",
    myRsvp: "going",
    attendees: [
      { name: "Kojo Mensah", rsvp: "going" },
      { name: "Ama", rsvp: "going" },
      { name: "You", rsvp: "going" },
      { name: "Nana", rsvp: "maybe" }
    ]
  },
  {
    id: "plan-2",
    title: "Dinner Night",
    type: "hangout",
    dateLabel: "Tomorrow · 7:00 PM",
    location: "East Legon",
    description: "Casual dinner before the week gets busy.",
    hostName: "You",
    isHost: true,
    bucket: "hosting",
    myRsvp: "going",
    attendees: [
      { name: "You", rsvp: "going" },
      { name: "Efua", rsvp: "going" },
      { name: "Kofi", rsvp: "maybe" }
    ]
  },
  {
    id: "plan-3",
    title: "Football Match",
    type: "sports",
    dateLabel: "Sat, 24 May · 6:00 PM",
    location: "Legon Park",
    description: "Weekend five-a-side. Bring boots.",
    hostName: "Nana",
    isHost: false,
    bucket: "upcoming",
    myRsvp: "going",
    attendees: [
      { name: "Nana", rsvp: "going" },
      { name: "You", rsvp: "going" },
      { name: "Kofi", rsvp: "going" },
      { name: "Ama", rsvp: "maybe" }
    ]
  },
  {
    id: "plan-4",
    title: "Movie Night",
    type: "hangout",
    dateLabel: "Sun, 25 May · 8:00 PM",
    location: "Accra Mall",
    description: "Which movie should we watch? Vote once you're in.",
    hostName: "Efua",
    isHost: false,
    bucket: "invites",
    myRsvp: "invited",
    attendees: [
      { name: "Efua", rsvp: "going" },
      { name: "Kofi", rsvp: "going" }
    ]
  }
];

const bucketTabs: Array<{ id: PlanBucket; label: string }> = [
  { id: "upcoming", label: "Upcoming" },
  { id: "invites", label: "Invites" },
  { id: "hosting", label: "Hosting" },
  { id: "past", label: "Past" }
];

const inviteCandidates = ["Ama", "Kofi", "Nana", "Efua"];

type PollOption = { id: string; label: string; votes: number };

const seedPolls: Record<string, PollOption[]> = {
  "plan-2": [
    { id: "opt-1", label: "Café Kwame", votes: 3 },
    { id: "opt-2", label: "Bistro 22", votes: 1 },
    { id: "opt-3", label: "Bella Roma", votes: 0 }
  ]
};

export function PlansPageContent() {
  const searchParams = useSearchParams();
  const [plans, setPlans] = useState<Plan[]>(seedPlans);
  const [activeBucket, setActiveBucket] = useState<PlanBucket>("upcoming");
  const [createOpen, setCreateOpen] = useState(() => searchParams.get("create") === "1");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [pollsByPlanId, setPollsByPlanId] = useState<Record<string, PollOption[]>>(seedPolls);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 3200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const visiblePlans = useMemo(
    () => plans.filter((plan) => plan.bucket === activeBucket),
    [plans, activeBucket]
  );
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null;

  function updateMyRsvp(planId: string, rsvp: Rsvp) {
    setPlans((current) =>
      current.map((plan) =>
        plan.id === planId
          ? {
              ...plan,
              myRsvp: rsvp,
              attendees: plan.attendees.map((attendee) =>
                attendee.name === "You" ? { ...attendee, rsvp } : attendee
              )
            }
          : plan
      )
    );
  }

  function voteOnPoll(planId: string, optionId: string) {
    setPollsByPlanId((current) => ({
      ...current,
      [planId]: (current[planId] ?? []).map((option) =>
        option.id === optionId ? { ...option, votes: option.votes + 1 } : option
      )
    }));
  }

  function addPollOption(planId: string, label: string) {
    setPollsByPlanId((current) => ({
      ...current,
      [planId]: [...(current[planId] ?? []), { id: `opt-${Date.now()}`, label, votes: 0 }]
    }));
  }

  function createPlan(input: { title: string; dateLabel: string; location: string; description: string; type: PlanType; invitees: string[] }) {
    const newPlan: Plan = {
      id: `plan-${Date.now()}`,
      title: input.title,
      type: input.type,
      dateLabel: input.dateLabel,
      location: input.location,
      description: input.description,
      hostName: "You",
      isHost: true,
      bucket: "hosting",
      myRsvp: "going",
      attendees: [
        { name: "You", rsvp: "going" },
        ...input.invitees.map((name) => ({ name, rsvp: "invited" as Rsvp }))
      ]
    };
    setPlans((current) => [newPlan, ...current]);
    setActiveBucket("hosting");
    setCreateOpen(false);
    setFeedback(`${input.title} created and shared with your Muddies.`);
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 pt-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Plans</h1>
          <p className="mt-2 text-sm text-muted-foreground">Create, manage, and join plans with your people.</p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Plan
        </Button>
      </header>

      <PreviewNotice />

      {feedback ? (
        <div className="rounded-[1rem] border border-orange-400/20 bg-orange-400/10 p-3 text-sm text-orange-800 dark:text-orange-50" role="status">
          {feedback}
        </div>
      ) : null}

      <nav className="overflow-x-auto border-b border-border/70" aria-label="Plans tabs">
        <div className="flex min-w-max gap-1">
          {bucketTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cn(
                "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium",
                activeBucket === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setActiveBucket(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {visiblePlans.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {visiblePlans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} onView={() => setSelectedPlanId(plan.id)} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={CalendarCheck2}
          className="!min-h-0 !shadow-none p-5"
          title={emptyCopy[activeBucket].title}
          description={emptyCopy[activeBucket].description}
          action={
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New Plan
            </Button>
          }
        />
      )}

      <CreatePlanModal open={createOpen} onOpenChange={setCreateOpen} onCreate={createPlan} />
      <PlanDetailsModal
        plan={selectedPlan}
        poll={selectedPlan ? pollsByPlanId[selectedPlan.id] ?? [] : []}
        onOpenChange={(open) => {
          if (!open) setSelectedPlanId(null);
        }}
        onRsvpChange={(rsvp) => selectedPlan && updateMyRsvp(selectedPlan.id, rsvp)}
        onVote={(optionId) => selectedPlan && voteOnPoll(selectedPlan.id, optionId)}
        onAddPollOption={(label) => selectedPlan && addPollOption(selectedPlan.id, label)}
      />
    </div>
  );
}

const emptyCopy: Record<PlanBucket, { title: string; description: string }> = {
  upcoming: { title: "No upcoming plans", description: "Plans you're going to will show up here." },
  invites: { title: "No pending invites", description: "Plan invites from your Muddies will appear here." },
  hosting: { title: "You're not hosting anything yet", description: "Create a plan and invite your Muddies." },
  past: { title: "No past plans", description: "Plans that have happened will show up here." }
};

function PlanCard({ plan, onView }: { plan: Plan; onView: () => void }) {
  const TypeIcon = planTypeMeta[plan.type].icon;
  const goingCount = plan.attendees.filter((attendee) => attendee.rsvp === "going").length;
  const maybeCount = plan.attendees.filter((attendee) => attendee.rsvp === "maybe").length;

  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <TypeIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold">{plan.title}</h3>
            {plan.isHost ? <Badge variant="orange">Hosting</Badge> : null}
            {plan.myRsvp === "invited" ? <Badge variant="violet">Invited</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{plan.dateLabel}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {plan.location}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            {goingCount} going{maybeCount > 0 ? ` · ${maybeCount} maybe` : ""}
          </p>
        </div>
      </div>
      <Button type="button" variant="outline" className="mt-4 w-full" onClick={onView}>
        View
      </Button>
    </Card>
  );
}

function CreatePlanModal({
  open,
  onOpenChange,
  onCreate
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { title: string; dateLabel: string; location: string; description: string; type: PlanType; invitees: string[] }) => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<PlanType>("hangout");
  const [invitees, setInvitees] = useState<string[]>([]);
  const formId = useId();

  function resetFields() {
    setStep(0);
    setTitle("");
    setDate("");
    setTime("");
    setLocation("");
    setDescription("");
    setType("hangout");
    setInvitees([]);
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) resetFields();
  }

  const canContinueDetails = title.trim().length > 1 && date.trim().length > 0 && time.trim().length > 0;

  function toggleInvitee(name: string) {
    setInvitees((current) =>
      current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name]
    );
  }

  return (
    <Modal open={open} onOpenChange={handleOpenChange} title="Create New Plan" description={`Step ${step + 1} of 3`}>
      <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
        {step === 0 ? (
          <div className="grid gap-4">
            <FormField htmlFor={`${formId}-title`} label="Plan name">
              <Input
                id={`${formId}-title`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Dinner Night"
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField htmlFor={`${formId}-date`} label="Date">
                <Input id={`${formId}-date`} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </FormField>
              <FormField htmlFor={`${formId}-time`} label="Time">
                <Input id={`${formId}-time`} type="time" value={time} onChange={(event) => setTime(event.target.value)} />
              </FormField>
            </div>
            <FormField htmlFor={`${formId}-location`} label="Location (optional)">
              <Input
                id={`${formId}-location`}
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="e.g. East Legon"
              />
            </FormField>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-foreground">Plan type</legend>
              <div className="grid grid-cols-4 gap-2">
                {(Object.keys(planTypeMeta) as PlanType[]).map((planType) => {
                  const Icon = planTypeMeta[planType].icon;
                  return (
                    <button
                      key={planType}
                      type="button"
                      onClick={() => setType(planType)}
                      className={cn(
                        "focus-ring safe-motion flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium",
                        type === planType
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-secondary"
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {planTypeMeta[planType].label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <FormField htmlFor={`${formId}-description`} label="Description (optional)">
              <Textarea
                id={`${formId}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Add more details about the plan"
              />
            </FormField>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Invite Muddies</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {inviteCandidates.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleInvitee(name)}
                  className={cn(
                    "focus-ring safe-motion flex items-center gap-3 rounded-lg border p-3 text-left text-sm",
                    invitees.includes(name)
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-secondary"
                  )}
                >
                  <GlowAvatar name={name} size="sm" />
                  <span className="font-medium">{name}</span>
                  {invitees.includes(name) ? (
                    <Badge variant="orange" className="ml-auto">Invited</Badge>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Review</p>
            <div className="rounded-xl border border-border/70 bg-card/50 p-4 text-sm">
              <p className="font-semibold">{title || "Untitled plan"}</p>
              <p className="mt-1 text-muted-foreground">
                {date || "No date"} {time ? `· ${time}` : ""}
              </p>
              {location ? <p className="mt-1 text-muted-foreground">{location}</p> : null}
              {description ? <p className="mt-2 text-muted-foreground">{description}</p> : null}
              <p className="mt-3 text-xs text-muted-foreground">
                {invitees.length > 0 ? `Inviting ${invitees.join(", ")}` : "No one invited yet"}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-5 flex justify-between gap-3">
        <Button type="button" variant="outline" onClick={() => (step === 0 ? handleOpenChange(false) : setStep((current) => (current - 1) as 0 | 1))}>
          {step === 0 ? "Cancel" : "Back"}
        </Button>
        {step < 2 ? (
          <Button
            type="button"
            disabled={step === 0 && !canContinueDetails}
            onClick={() => setStep((current) => (current + 1) as 1 | 2)}
          >
            Next
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => {
              onCreate({
                title: title.trim(),
                dateLabel: date && time ? `${date} · ${time}` : date || time || "Date TBD",
                location: location.trim() || "Location TBD",
                description: description.trim(),
                type,
                invitees
              });
              resetFields();
            }}
          >
            Create Plan
          </Button>
        )}
      </div>
    </Modal>
  );
}

function PlanDetailsModal({
  plan,
  poll,
  onOpenChange,
  onRsvpChange,
  onVote,
  onAddPollOption
}: {
  plan: Plan | null;
  poll: PollOption[];
  onOpenChange: (open: boolean) => void;
  onRsvpChange: (rsvp: Rsvp) => void;
  onVote: (optionId: string) => void;
  onAddPollOption: (label: string) => void;
}) {
  const [tab, setTab] = useState<"overview" | "chat" | "polls">("overview");
  const [newOption, setNewOption] = useState("");

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) setTab("overview");
  }

  return (
    <Modal
      open={Boolean(plan)}
      onOpenChange={handleOpenChange}
      title={plan?.title ?? "Plan"}
      description={plan?.dateLabel}
    >
      {plan ? (
      <div className="space-y-4">
        <div className="flex gap-1 border-b border-border/70">
          {(["overview", "chat", "polls"] as const).map((tabId) => (
            <button
              key={tabId}
              type="button"
              onClick={() => setTab(tabId)}
              className={cn(
                "focus-ring safe-motion border-b-2 px-3 py-2 text-sm font-medium capitalize",
                tab === tabId
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tabId}
            </button>
          ))}
        </div>

        {tab === "overview" ? (
          <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
              {plan.location}
            </p>
            {plan.description ? <p className="text-sm leading-6">{plan.description}</p> : null}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Who&apos;s going ({plan.attendees.filter((a) => a.rsvp === "going").length})
              </p>
              <ul className="space-y-2">
                {plan.attendees.map((attendee) => (
                  <li
                    key={attendee.name}
                    className="flex items-center gap-3 rounded-lg border border-border/70 bg-background/60 px-3 py-2"
                  >
                    <GlowAvatar name={attendee.name} size="sm" />
                    <span className="text-sm font-medium">{attendee.name}</span>
                    <RsvpBadge rsvp={attendee.rsvp} className="ml-auto" />
                  </li>
                ))}
              </ul>
            </div>

            {!plan.isHost ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Your RSVP
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={plan.myRsvp === "going" ? "primary" : "outline"}
                    onClick={() => onRsvpChange("going")}
                  >
                    Going
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={plan.myRsvp === "maybe" ? "primary" : "outline"}
                    onClick={() => onRsvpChange("maybe")}
                  >
                    Maybe
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={plan.myRsvp === "declined" ? "primary" : "outline"}
                    onClick={() => onRsvpChange("declined")}
                  >
                    Can&apos;t go
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "chat" ? (
          <EmptyState
            icon={MessageCircle}
            className="!min-h-0 !shadow-none p-5"
            title="Plan chat is coming soon"
            description="Messaging inside a plan isn't wired up yet — this is a placeholder for a future update."
          />
        ) : null}

        {tab === "polls" ? (
          <div className="space-y-4">
            <p className="text-sm font-semibold">Where should we eat?</p>
            {poll.length > 0 ? (
              <div className="space-y-2">
                {(() => {
                  const totalVotes = poll.reduce((sum, option) => sum + option.votes, 0);
                  return poll.map((option) => {
                    const percent = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => onVote(option.id)}
                        className="focus-ring safe-motion relative block w-full overflow-hidden rounded-lg border border-border/70 p-3 text-left hover:bg-secondary/40"
                      >
                        <div
                          className="absolute inset-y-0 left-0 bg-primary/10"
                          style={{ width: `${percent}%` }}
                          aria-hidden="true"
                        />
                        <div className="relative flex items-center justify-between text-sm">
                          <span className="font-medium">{option.label}</span>
                          <span className="text-xs text-muted-foreground">{option.votes} votes</span>
                        </div>
                      </button>
                    );
                  });
                })()}
              </div>
            ) : (
              <EmptyState icon={Vote} className="!min-h-0 !shadow-none p-5" title="No poll options yet" description="Add an option to start the vote." />
            )}
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const trimmed = newOption.trim();
                if (!trimmed) return;
                onAddPollOption(trimmed);
                setNewOption("");
              }}
            >
              <Input
                value={newOption}
                onChange={(event) => setNewOption(event.target.value)}
                placeholder="Add option"
                aria-label="Add poll option"
                className="flex-1"
              />
              <Button type="submit" variant="outline" size="sm" disabled={!newOption.trim()}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add
              </Button>
            </form>
          </div>
        ) : null}
      </div>
      ) : null}
    </Modal>
  );
}

function RsvpBadge({ rsvp, className }: { rsvp: Rsvp; className?: string }) {
  const variant = rsvp === "going" ? "green" : rsvp === "maybe" ? "warning" : rsvp === "invited" ? "violet" : "default";
  const label = rsvp === "going" ? "Going" : rsvp === "maybe" ? "Maybe" : rsvp === "invited" ? "Invited" : "Can't go";
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
