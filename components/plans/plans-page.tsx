"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays,
  ChevronRight,
  Clock,
  Dumbbell,
  Flame,
  Gamepad2,
  Heart,
  Lock,
  MapPin,
  PartyPopper,
  Plus,
  Sun,
  Users,
  Utensils,
  Vote,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useId, useMemo, useState, useTransition } from "react";
import {
  cancelPlanAction,
  createPlanAction,
  createPollAction,
  rsvpAction,
  votePollAction
} from "@/app/(app)/plans-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppMultiSelect, AppSelect } from "@/components/ui/app-dropdown";
import { FormField } from "@/components/auth/form-field";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type PlanInvitee = { id: string; name: string; username?: string | null; avatarUrl?: string | null };

export type PlanPollSummary = {
  id: string;
  question: string;
  status: string;
  myOptionIds: string[];
  options: Array<{ id: string; label: string; votes: number; sort: number }>;
};

export type PlanSummary = {
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
  attendees: Array<{ name: string; avatarUrl: string | null; rsvp: string; isMe: boolean }>;
  polls: PlanPollSummary[];
};

type PlanBucket = "upcoming" | "invites" | "hosting" | "past";

const bucketTabs: Array<{ id: PlanBucket; label: string }> = [
  { id: "upcoming", label: "Upcoming" },
  { id: "invites", label: "Invitations" },
  { id: "hosting", label: "Created by you" },
  { id: "past", label: "Past" }
];

const TERMINAL = new Set(["cancelled", "completed", "expired"]);

function bucketFor(plan: PlanSummary): PlanBucket {
  if (TERMINAL.has(plan.status)) return "past";
  if (plan.isHost) return "hosting";
  if (plan.myRsvp === "invited" || plan.myRsvp === "viewed") return "invites";
  return "upcoming";
}

function dateLabel(plan: PlanSummary): string {
  if (!plan.startAt) return plan.planType === "poll" ? "Time being decided" : "Time TBD";
  return new Date(plan.startAt).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function PlansPageContent({
  initialPlans = [],
  invitees = []
}: {
  initialPlans?: PlanSummary[];
  invitees?: PlanInvitee[];
  currentUserId?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPlan = initialPlans.find((plan) => plan.id === searchParams.get("plan")) ?? null;
  const [plans, setPlans] = useState<PlanSummary[]>(initialPlans);
  // router.refresh() re-runs the server component and hands us fresh props, but
  // React never re-initializes useState from changed props. Without this sync,
  // authoritative server data after a mutation (poll vote counts, RSVP totals)
  // never reaches the UI until a full reload. This is React's recommended
  // "adjust state when a prop changes" pattern (set state during render, not in
  // an effect): initialPlans only gets a new reference when the server
  // re-renders (refresh/navigation), so ordinary client re-renders are untouched
  // and optimistic updates survive until the authoritative refresh lands.
  const [syncedFrom, setSyncedFrom] = useState(initialPlans);
  if (syncedFrom !== initialPlans) {
    setSyncedFrom(initialPlans);
    setPlans(initialPlans);
  }
  const [activeBucket, setActiveBucket] = useState<PlanBucket>(() =>
    requestedPlan ? bucketFor(requestedPlan) : "upcoming"
  );
  const [createOpen, setCreateOpen] = useState(() => searchParams.get("create") === "1");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(() => requestedPlan?.id ?? null);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const visiblePlans = useMemo(
    () => plans.filter((plan) => bucketFor(plan) === activeBucket),
    [plans, activeBucket]
  );
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null;

  function changeRsvp(planId: string, rsvp: "going" | "maybe" | "not_going") {
    // Optimistic; refresh from server on completion for authoritative counts.
    setPlans((current) =>
      current.map((plan) => (plan.id === planId ? { ...plan, myRsvp: rsvp } : plan))
    );
    startTransition(async () => {
      const result = await rsvpAction(planId, rsvp);
      setFeedback(result.message);
      router.refresh();
    });
  }

  function vote(pollId: string, optionId: string) {
    // Optimistic single-choice update so the tally moves the instant you tap;
    // router.refresh() then reconciles with authoritative counts (incl. other
    // voters and multi-choice polls). votePollAction always makes the clicked
    // option your vote — clicking your current option is a no-op, not an un-vote.
    setPlans((current) =>
      current.map((plan) => ({
        ...plan,
        polls: plan.polls.map((poll) => {
          if (poll.id !== pollId) return poll;
          const wasMine = new Set(poll.myOptionIds);
          return {
            ...poll,
            myOptionIds: [optionId],
            options: poll.options.map((option) => {
              const lost = wasMine.has(option.id) && option.id !== optionId;
              const gained = !wasMine.has(option.id) && option.id === optionId;
              return { ...option, votes: Math.max(0, option.votes + (gained ? 1 : 0) - (lost ? 1 : 0)) };
            })
          };
        })
      }))
    );
    startTransition(async () => {
      const result = await votePollAction(pollId, [optionId]);
      setFeedback(result.message);
      router.refresh();
    });
  }

  function addPoll(planId: string, question: string, pollType: string, options: string[]) {
    startTransition(async () => {
      const result = await createPollAction({
        planId,
        pollType,
        question,
        options: options.map((label) => ({ label }))
      });
      setFeedback(result.message);
      router.refresh();
    });
  }

  function cancelPlan(planId: string) {
    startTransition(async () => {
      const result = await cancelPlanAction(planId);
      setFeedback(result.message);
      if (result.ok) {
        setSelectedPlanId(null);
        router.refresh();
      }
    });
  }

  function createPlan(input: {
    title: string;
    description: string;
    startAt: string | null;
    placeText: string;
    participantIds: string[];
  }) {
    startTransition(async () => {
      const result = await createPlanAction({
        title: input.title,
        description: input.description || undefined,
        planType: input.startAt ? "scheduled" : "quick",
        startAt: input.startAt,
        placeType: "custom",
        customPlaceText: input.placeText || undefined,
        participantIds: input.participantIds
      });
      setFeedback(result.message);
      if (result.ok) {
        setCreateOpen(false);
        setActiveBucket("hosting");
        router.refresh();
      }
    });
  }

  const inviteCount = useMemo(() => plans.filter((plan) => bucketFor(plan) === "invites").length, [plans]);

  return (
    <div className="mx-auto max-w-[640px] pt-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Plans</h1>
          <p className="mt-1 text-sm text-muted-foreground">Plan something with your Muddies.</p>
        </div>
        <Button type="button" variant="outline" className="shrink-0 whitespace-nowrap" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New plan
        </Button>
      </header>

      {feedback ? (
        <div className="mt-4 rounded-[1rem] border border-orange-400/20 bg-orange-400/10 p-3 text-sm text-orange-800 dark:text-orange-50" role="status">
          {feedback}
        </div>
      ) : null}

      <nav className="no-scrollbar -mx-4 mt-4 overflow-x-auto border-b border-border/70 px-4 sm:mx-0 sm:px-0" aria-label="Plans tabs">
        <div className="flex w-max gap-1 pr-4 sm:pr-0">
          {bucketTabs.map((tab) => {
            const active = activeBucket === tab.id;
            const showCount = tab.id === "invites" && inviteCount > 0;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring safe-motion inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium",
                  active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setActiveBucket(tab.id)}
              >
                {tab.label}
                {showCount ? (
                  <span className="grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-primary px-1 text-[11px] font-bold leading-none text-primary-foreground">
                    {inviteCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="mt-4">
        {visiblePlans.length > 0 ? (
          <>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {bucketSectionLabel[activeBucket]}
              </h2>
            </div>
            <ul className="divide-y divide-border/60">
              {visiblePlans.map((plan) => (
                <PlanCard key={plan.id} plan={plan} onView={() => setSelectedPlanId(plan.id)} />
              ))}
            </ul>
            <div className="mt-5 rounded-2xl border border-border/60 bg-card/40 py-6 text-center">
              <CalendarDays className="mx-auto h-6 w-6 text-primary" aria-hidden="true" />
              <p className="mt-2 text-sm font-semibold">{listEndCopy[activeBucket].title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{listEndCopy[activeBucket].description}</p>
            </div>
          </>
        ) : (
          <div className="py-12 text-center">
            <p className="text-base font-semibold">{emptyCopy[activeBucket].title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{emptyCopy[activeBucket].description}</p>
          </div>
        )}
      </div>

      <CreatePlanModal
        open={createOpen}
        invitees={invitees}
        pending={isPending}
        onOpenChange={setCreateOpen}
        onCreate={createPlan}
      />
      <PlanDetailsModal
        plan={selectedPlan}
        pending={isPending}
        onOpenChange={(open) => {
          if (!open) setSelectedPlanId(null);
        }}
        onRsvpChange={(rsvp) => selectedPlan && changeRsvp(selectedPlan.id, rsvp)}
        onVote={(pollId, optionId) => vote(pollId, optionId)}
        onCancel={() => selectedPlan && cancelPlan(selectedPlan.id)}
        onAddPoll={(question, pollType, options) => selectedPlan && addPoll(selectedPlan.id, question, pollType, options)}
      />
    </div>
  );
}

const emptyCopy: Record<PlanBucket, { title: string; description: string }> = {
  upcoming: { title: "Nothing planned yet", description: "Your upcoming plans will appear here." },
  invites: { title: "No invitations", description: "New plan invitations will appear here." },
  hosting: { title: "No plans created yet", description: "Create a plan and invite your Muddies." },
  past: { title: "No past plans", description: "Plans you've joined will appear here." }
};

const bucketSectionLabel: Record<PlanBucket, string> = {
  upcoming: "Upcoming plans",
  invites: "Invitations",
  hosting: "Created by you",
  past: "Past plans"
};

const listEndCopy: Record<PlanBucket, { title: string; description: string }> = {
  upcoming: { title: "No more upcoming plans", description: "Create a plan to meet up with your Muddies." },
  invites: { title: "That's every invitation", description: "New plan invitations will appear here." },
  hosting: { title: "That's all you've created", description: "Start another plan whenever you're ready." },
  past: { title: "You've reached the start", description: "Older plans stay here for reference." }
};

/** A small, decorative icon chosen from the plan title (a display choice over
 *  user text — not stored data). Falls back to a calendar. */
const PLAN_ICON_RULES: Array<{ match: RegExp; icon: LucideIcon; className: string }> = [
  { match: /fish/i, icon: Users, className: "bg-primary/10 text-primary" },
  { match: /gym|work ?out|run|fitness|train/i, icon: Dumbbell, className: "bg-blue-500/12 text-blue-500 dark:text-blue-300" },
  { match: /beach|swim|pool|sun/i, icon: Sun, className: "bg-amber-500/12 text-amber-500 dark:text-amber-300" },
  { match: /bonfire|fire|camp/i, icon: Flame, className: "bg-violet-500/12 text-violet-500 dark:text-violet-300" },
  { match: /date|dinner|romant|valentine/i, icon: Heart, className: "bg-pink-500/12 text-pink-500 dark:text-pink-300" },
  { match: /lunch|brunch|food|eat|restaurant|meal/i, icon: Utensils, className: "bg-primary/10 text-primary" },
  { match: /party|club|celebrat|birthday/i, icon: PartyPopper, className: "bg-violet-500/12 text-violet-500 dark:text-violet-300" },
  { match: /game|match|football|soccer|ball|play/i, icon: Gamepad2, className: "bg-emerald-500/12 text-emerald-500 dark:text-emerald-300" }
];

function planIcon(title: string): { icon: LucideIcon; className: string } {
  const rule = PLAN_ICON_RULES.find((entry) => entry.match.test(title));
  return rule ?? { icon: CalendarDays, className: "bg-primary/10 text-primary" };
}

function rsvpPill(myRsvp: string, isHost: boolean): { label: string; className: string } | null {
  if (isHost) return { label: "Hosting", className: "border-primary/40 bg-primary/10 text-primary" };
  switch (myRsvp) {
    case "going":
      return { label: "Going", className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300" };
    case "maybe":
      return { label: "Maybe", className: "border-amber-400/40 bg-amber-400/10 text-amber-600 dark:text-amber-200" };
    case "invited":
    case "viewed":
      return { label: "Invited", className: "border-amber-400/40 bg-amber-400/10 text-amber-600 dark:text-amber-200" };
    case "not_going":
    case "declined":
      return { label: "Not going", className: "border-border text-muted-foreground" };
    default:
      return null;
  }
}

function DateChip({ startAt }: { startAt: string | null }) {
  if (!startAt) {
    return (
      <span className="grid h-14 w-12 shrink-0 place-content-center rounded-xl border border-border/70 bg-card/50 text-center leading-none">
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">TBD</span>
      </span>
    );
  }
  const date = new Date(startAt);
  const month = date.toLocaleString([], { month: "short" }).toUpperCase();
  const day = date.toLocaleString([], { day: "numeric" });
  const weekday = date.toLocaleString([], { weekday: "short" }).toUpperCase();
  return (
    <span
      className="grid h-14 w-12 shrink-0 place-content-center rounded-xl border border-border/70 bg-card/50 text-center leading-none"
      suppressHydrationWarning
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">{month}</span>
      <span className="mt-0.5 text-xl font-bold">{day}</span>
      <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{weekday}</span>
    </span>
  );
}

function PlanCard({ plan, onView }: { plan: PlanSummary; onView: () => void }) {
  const going = plan.attendees.filter((attendee) => attendee.rsvp === "going");
  const goingCount = going.length;
  const timeLabel = plan.startAt
    ? new Date(plan.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : plan.planType === "poll"
      ? "Time being decided"
      : "Time TBD";
  const { icon: Icon, className: iconClass } = planIcon(plan.title);
  const pill = rsvpPill(plan.myRsvp, plan.isHost);

  return (
    <li>
      <button
        type="button"
        onClick={onView}
        className="focus-ring safe-motion flex w-full items-start gap-3 py-4 text-left hover:bg-secondary/20"
        aria-label={`${plan.title}, ${dateLabel(plan)}`}
      >
        <DateChip startAt={plan.startAt} />
        <span className={cn("mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl", iconClass)}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>

        {/* overflow-hidden is the real fix: without it, the going/avatars row
            below can render wider than this column's computed flex width and
            visually bleed into the pill/organiser column beside it rather than
            wrapping or clipping within its own box. */}
        <span className="min-w-0 flex-1 overflow-hidden">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-base font-semibold">{plan.title}</span>
            {plan.myRsvp === "going" && !plan.isHost ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            ) : null}
          </span>
          <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground" suppressHydrationWarning>
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{timeLabel}</span>
            {plan.placeText ? (
              <>
                <span aria-hidden="true">·</span>
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{plan.placeText}</span>
              </>
            ) : null}
          </span>
          {goingCount > 0 ? (
            <span className="mt-1.5 flex min-w-0 items-center gap-1.5">
              <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
                {going.slice(0, 2).map((attendee, index) => (
                  <span
                    key={`${attendee.name}-${index}`}
                    className="grid h-5 w-5 place-items-center overflow-hidden rounded-full border-2 border-background bg-secondary text-[8px] font-semibold uppercase text-muted-foreground"
                  >
                    {attendee.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={attendee.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      attendee.name.trim().charAt(0).toUpperCase() || "?"
                    )}
                  </span>
                ))}
              </span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">{goingCount} going</span>
            </span>
          ) : null}
        </span>

        <span className="flex max-w-[6.5rem] shrink-0 flex-col items-end gap-1.5">
          <span className="inline-flex items-center gap-0.5">
            {pill ? (
              <span className={cn("whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", pill.className)}>
                {pill.label}
              </span>
            ) : null}
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </span>
          <span className="w-full truncate text-right text-[11px] leading-tight text-muted-foreground">
            {plan.isHost ? "By you" : plan.organiserName}
          </span>
        </span>
      </button>
    </li>
  );
}

/** yyyy-mm-dd in local time for today + offset (matches <input type="date">). */
function localDateValue(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Days from today to the coming Saturday (0 when today is Saturday). */
function daysUntilSaturday(): number {
  return (6 - new Date().getDay() + 7) % 7;
}

function CreatePlanModal({
  open,
  invitees,
  pending,
  onOpenChange,
  onCreate
}: {
  open: boolean;
  invitees: PlanInvitee[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: {
    title: string;
    description: string;
    startAt: string | null;
    placeText: string;
    participantIds: string[];
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [placeText, setPlaceText] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [nameTouched, setNameTouched] = useState(false);
  const formId = useId();

  function reset() {
    setTitle("");
    setDate("");
    setTime("");
    setPlaceText("");
    setDescription("");
    setSelected([]);
    setNameTouched(false);
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  }

  const canCreate = title.trim().length > 0;
  const showNameError = nameTouched && title.trim().length === 0;
  const fieldClassName = "h-12 focus-visible:ring-1 focus-visible:ring-offset-1";

  // Quick "When?" presets set the date field; the Date/Time inputs stay the
  // source of truth so nothing about the create payload changes.
  const quickWhen: Array<{ id: string; label: string; date: () => string }> = [
    { id: "today", label: "Today", date: () => localDateValue(0) },
    { id: "tomorrow", label: "Tomorrow", date: () => localDateValue(1) },
    { id: "weekend", label: "This weekend", date: () => localDateValue(daysUntilSaturday()) }
  ];

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Create a plan"
      description="Make something happen with your Muddies."
      widthClassName="max-w-[560px]"
      variant="sheet"
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canCreate || pending}
            title={!canCreate ? "Enter a plan name to continue" : undefined}
            className={
              !canCreate
                ? "disabled:border-border disabled:bg-secondary disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none"
                : undefined
            }
            onClick={() => {
              // Date without a time still means "quick plan, no fixed hour"
              // wasn't the intent here, a date was deliberately chosen, so
              // default the time to the very start of that day rather than
              // silently dropping it.
              const combined = date ? `${date}T${time || "00:00"}` : null;
              onCreate({
                title: title.trim(),
                description: description.trim(),
                startAt: combined ? new Date(combined).toISOString() : null,
                placeText: placeText.trim(),
                participantIds: selected
              });
            }}
          >
            Create plan
          </Button>
        </>
      }
    >
      <div className="space-y-5 pb-1 pr-1">
        <FormField
          htmlFor={`${formId}-title`}
          label="What are we doing?"
          error={showNameError ? "Enter a plan name." : undefined}
        >
          <Input
            id={`${formId}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => setNameTouched(true)}
            placeholder="Lunch later"
            className={fieldClassName}
          />
        </FormField>

        <div>
          <p className="mb-1.5 text-sm font-medium">When?</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {quickWhen.map((option) => {
              const active = date === option.date();
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setDate(option.date())}
                  aria-pressed={active}
                  className={cn(
                    "focus-ring safe-motion rounded-full border px-3.5 py-1.5 text-sm font-medium",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/70 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField htmlFor={`${formId}-date`} label="Date">
              <Input
                id={`${formId}-date`}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className={fieldClassName}
              />
            </FormField>
            <FormField htmlFor={`${formId}-time`} label="Time">
              <Input
                id={`${formId}-time`}
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                className={fieldClassName}
              />
            </FormField>
          </div>
        </div>

        <FormField htmlFor={`${formId}-place`} label="Where? (optional)">
          <Input
            id={`${formId}-place`}
            value={placeText}
            onChange={(event) => setPlaceText(event.target.value)}
            placeholder="Café or nearby area"
            className={fieldClassName}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">Keep it general — no exact addresses.</p>
        </FormField>

        <InviteMuddiesField invitees={invitees} selected={selected} onToggle={toggle} fieldClassName={fieldClassName} />

        <FormField htmlFor={`${formId}-description`} label="Notes (optional)">
          <Textarea
            id={`${formId}-description`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add a note for your Muddies"
            className="min-h-[90px] focus-visible:ring-1 focus-visible:ring-offset-1"
          />
        </FormField>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          Only invited Muddies will see this plan.
        </p>
      </div>
    </Modal>
  );
}

function InviteMuddiesField({
  invitees,
  selected,
  onToggle,
  fieldClassName
}: {
  invitees: PlanInvitee[];
  selected: string[];
  onToggle: (id: string) => void;
  fieldClassName: string;
}) {
  const selectedInvitees = invitees.filter((invitee) => selected.includes(invitee.id));

  // Duplicate display names get their @username shown for disambiguation,
  // both in the dropdown list and on the selected chips.
  const duplicateNames = useMemo(() => {
    const seen = new Map<string, number>();
    for (const invitee of invitees) {
      const name = invitee.name.trim().toLowerCase();
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name));
  }, [invitees]);

  function usernameSuffixFor(invitee: PlanInvitee) {
    return invitee.username && duplicateNames.has(invitee.name.trim().toLowerCase()) ? `@${invitee.username}` : null;
  }

  return (
    <div>
      <AppMultiSelect
        label="Who's coming?"
        value={selected}
        options={invitees.map((invitee) => ({
          value: invitee.id,
          label: invitee.name,
          description: usernameSuffixFor(invitee) ?? undefined,
          keywords: invitee.username ? [invitee.username] : undefined,
          icon: (
            <span className="grid h-7 w-7 place-items-center rounded-full bg-secondary text-[11px] font-semibold text-foreground">
              {invitee.name.trim().charAt(0).toUpperCase() || "?"}
            </span>
          )
        }))}
        placeholder={invitees.length === 0 ? "Add Muddies first" : "Select Muddies"}
        searchable
        searchPlaceholder="Search Muddies"
        emptyText="No Muddies found"
        disabled={invitees.length === 0}
        triggerClassName={fieldClassName}
        onChange={(next) => {
          const changed = [...selected, ...next].find((id) => selected.includes(id) !== next.includes(id));
          if (changed) onToggle(changed);
        }}
      />

      {selectedInvitees.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {selectedInvitees.map((invitee) => (
            <span
              key={invitee.id}
              className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-1 pr-2 text-xs font-medium text-foreground"
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary">
                {invitee.name.trim().charAt(0).toUpperCase() || "?"}
              </span>
              {invitee.name}
              <button
                type="button"
                onClick={() => onToggle(invitee.id)}
                aria-label={`Remove ${invitee.name}`}
                className="focus-ring safe-motion -mr-1 grid h-3.5 w-3.5 place-items-center rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PlanDetailsModal({
  plan,
  pending,
  onOpenChange,
  onRsvpChange,
  onVote,
  onCancel,
  onAddPoll
}: {
  plan: PlanSummary | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onRsvpChange: (rsvp: "going" | "maybe" | "not_going") => void;
  onVote: (pollId: string, optionId: string) => void;
  onCancel: () => void;
  onAddPoll: (question: string, pollType: string, options: string[]) => void;
}) {
  return (
    <Modal
      open={Boolean(plan)}
      onOpenChange={onOpenChange}
      title={plan?.title ?? "Plan"}
      description={plan ? dateLabel(plan) : undefined}
      variant="sheet"
    >
      {plan ? (
        // Modal's own middle section already scrolls (variant="sheet" caps the
        // whole sheet at ~88svh); a second inner max-h/overflow here just
        // wasted space and doubled the scroll region.
        <div className="space-y-4">
          {plan.placeText ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
              {plan.placeText}
            </p>
          ) : null}
          {plan.description ? <p className="text-sm leading-6">{plan.description}</p> : null}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Who&apos;s going ({plan.attendees.filter((a) => a.rsvp === "going").length})
            </p>
            <ul className="space-y-2">
              {plan.attendees.map((attendee) => (
                <li key={attendee.name} className="flex items-center gap-3 rounded-lg border border-border/70 bg-background/60 px-3 py-2">
                  <GlowAvatar name={attendee.name} src={attendee.avatarUrl} size="sm" />
                  <span className="text-sm font-medium">{attendee.name}</span>
                  <RsvpBadge rsvp={attendee.rsvp} className="ml-auto" />
                </li>
              ))}
            </ul>
          </div>

          {!plan.isHost && !TERMINAL.has(plan.status) ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your RSVP</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={plan.myRsvp === "going" ? "primary" : "outline"} onClick={() => onRsvpChange("going")} disabled={pending}>
                  Going
                </Button>
                <Button type="button" size="sm" variant={plan.myRsvp === "maybe" ? "primary" : "outline"} onClick={() => onRsvpChange("maybe")} disabled={pending}>
                  Maybe
                </Button>
                <Button type="button" size="sm" variant={plan.myRsvp === "not_going" ? "primary" : "outline"} onClick={() => onRsvpChange("not_going")} disabled={pending}>
                  Can&apos;t make it
                </Button>
              </div>
            </div>
          ) : null}

          {plan.polls.map((poll) => (
            <div key={poll.id}>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <Vote className="h-4 w-4 text-primary" aria-hidden="true" />
                {poll.question}
              </p>
              <div className="space-y-2">
                {(() => {
                  const total = poll.options.reduce((sum, option) => sum + option.votes, 0);
                  return poll.options.map((option) => {
                    const percent = total > 0 ? Math.round((option.votes / total) * 100) : 0;
                    const mine = poll.myOptionIds.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={pending || poll.status !== "open"}
                        onClick={() => onVote(poll.id, option.id)}
                        className={cn(
                          "focus-ring safe-motion relative block w-full overflow-hidden rounded-lg border p-3 text-left disabled:opacity-70",
                          mine ? "border-primary" : "border-border/70 hover:bg-secondary/40"
                        )}
                      >
                        <div className="absolute inset-y-0 left-0 bg-primary/10" style={{ width: `${percent}%` }} aria-hidden="true" />
                        <div className="relative flex items-center justify-between text-sm">
                          <span className="font-medium">
                            {option.label}
                            {mine ? <span className="ml-1 text-xs text-primary">· your vote</span> : null}
                          </span>
                          <span className="text-xs text-muted-foreground">{option.votes} votes</span>
                        </div>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          ))}

          {plan.isHost && !TERMINAL.has(plan.status) ? (
            <div className="space-y-4 border-t border-border/70 pt-4">
              <AddPollForm pending={pending} onSubmit={onAddPoll} />
              <Button type="button" variant="danger" size="sm" onClick={onCancel} disabled={pending}>
                Cancel plan
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

/** Host-only "add a poll" control (batch 3 §polls; limits enforced server-side). */
function AddPollForm({
  pending,
  onSubmit
}: {
  pending: boolean;
  onSubmit: (question: string, pollType: string, options: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [pollType, setPollType] = useState("time");
  const [optionsText, setOptionsText] = useState("");

  const options = optionsText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
  const valid = question.trim().length > 0 && options.length >= 2;

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Vote className="h-4 w-4" aria-hidden="true" />
        Add a poll
      </Button>
    );
  }

  return (
    <form
      className="space-y-3 rounded-xl border border-border/70 bg-card/50 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onSubmit(question.trim(), pollType, options);
        setOpen(false);
        setQuestion("");
        setOptionsText("");
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={question}
          maxLength={160}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What should we decide? e.g. What time works?"
          aria-label="Poll question"
          className="focus-ring safe-motion h-10 min-w-0 flex-1 rounded-md border border-border bg-card/70 px-3 text-sm"
        />
        <AppSelect
          value={pollType}
          options={[
            { value: "time", label: "Time" },
            { value: "date", label: "Date" },
            { value: "place", label: "Place" },
            { value: "activity", label: "Activity" }
          ]}
          size="compact"
          triggerClassName="min-w-28"
          onChange={setPollType}
        />
      </div>
      <textarea
        value={optionsText}
        onChange={(event) => setOptionsText(event.target.value)}
        rows={3}
        placeholder={"One option per line (2–6), e.g.\n6:00 PM\n7:30 PM"}
        aria-label="Poll options, one per line"
        className="focus-ring safe-motion w-full rounded-md border border-border bg-card/70 px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!valid || pending}>
          Add poll
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RsvpBadge({ rsvp, className }: { rsvp: string; className?: string }) {
  const variant =
    rsvp === "going" ? "green" : rsvp === "maybe" ? "warning" : rsvp === "waitlisted" ? "violet" : "default";
  const label =
    rsvp === "going"
      ? "Going"
      : rsvp === "maybe"
        ? "Maybe"
        : rsvp === "waitlisted"
          ? "Waitlist"
          : rsvp === "not_going"
            ? "Can't make it"
            : "Invited";
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
