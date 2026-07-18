"use client";

import * as Popover from "@radix-ui/react-popover";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, MapPin, Plus, Search, Users, Vote, X } from "lucide-react";
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
import { Card } from "@/components/ui/card";
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
  attendees: Array<{ name: string; rsvp: string; isMe: boolean }>;
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
  const [plans, setPlans] = useState<PlanSummary[]>(initialPlans);
  const [activeBucket, setActiveBucket] = useState<PlanBucket>("upcoming");
  const [createOpen, setCreateOpen] = useState(() => searchParams.get("create") === "1");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
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

  return (
    <div className="mx-auto max-w-[1050px] pt-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Plans</h1>
          <p className="mt-2 text-sm text-muted-foreground">Make plans and organise meet-ups with your Muddies.</p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New plan
        </Button>
      </header>

      {feedback ? (
        <div className="mt-4 rounded-[1rem] border border-orange-400/20 bg-orange-400/10 p-3 text-sm text-orange-800 dark:text-orange-50" role="status">
          {feedback}
        </div>
      ) : null}

      <nav className="mt-4 overflow-x-auto border-b border-border/70" aria-label="Plans tabs">
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

      <div className="mt-6">
        {visiblePlans.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {visiblePlans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} onView={() => setSelectedPlanId(plan.id)} />
            ))}
          </div>
        ) : (
          // Compact inline state, not the bordered EmptyState panel, a
          // full card-style empty state for "nothing here yet" was reading
          // as an oversized, disconnected block on a tabbed list page.
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

function PlanCard({ plan, onView }: { plan: PlanSummary; onView: () => void }) {
  const goingCount = plan.attendees.filter((attendee) => attendee.rsvp === "going").length;
  const maybeCount = plan.attendees.filter((attendee) => attendee.rsvp === "maybe").length;

  const muddyCount = plan.attendees.length;

  return (
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
            {TERMINAL.has(plan.status) ? <Badge variant="default">{plan.status}</Badge> : null}
          </div>
          {/* Overview cards intentionally omit exact place text, that's
              only shown once a Muddy opens the plan's own details. */}
          <p className="mt-1 text-sm text-muted-foreground">{dateLabel(plan)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Organised by {plan.organiserName} · {muddyCount} {muddyCount === 1 ? "Muddy" : "Muddies"}
            {goingCount > 0 ? ` · ${goingCount} going` : ""}
            {maybeCount > 0 ? ` · ${maybeCount} maybe` : ""}
          </p>
        </div>
      </div>
      <Button type="button" variant="outline" className="mt-3 w-full" onClick={onView}>
        View
      </Button>
    </Card>
  );
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

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Create a plan"
      description="Add the details and invite your Muddies."
      widthClassName="max-w-[700px]"
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
      <div className="space-y-4 pb-1 pr-1">
        <FormField
          htmlFor={`${formId}-title`}
          label="Plan name"
          error={showNameError ? "Enter a plan name." : undefined}
        >
          <Input
            id={`${formId}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => setNameTouched(true)}
            placeholder="Lunch after class"
            className={fieldClassName}
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor={`${formId}-date`} label="Date (optional)">
            <Input
              id={`${formId}-date`}
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className={fieldClassName}
            />
          </FormField>
          <FormField htmlFor={`${formId}-time`} label="Time (optional)">
            <Input
              id={`${formId}-time`}
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className={fieldClassName}
            />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor={`${formId}-place`} label="Meeting area (optional)">
            <Input
              id={`${formId}-place`}
              value={placeText}
              onChange={(event) => setPlaceText(event.target.value)}
              placeholder="Campus café or nearby area"
              className={fieldClassName}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">Use a general area, not an exact address.</p>
          </FormField>
          <InviteMuddiesField invitees={invitees} selected={selected} onToggle={toggle} fieldClassName={fieldClassName} />
        </div>

        <FormField htmlFor={`${formId}-description`} label="Notes (optional)">
          <Textarea
            id={`${formId}-description`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add a note for your Muddies"
            className="min-h-[90px] focus-visible:ring-1 focus-visible:ring-offset-1"
          />
        </FormField>
      </div>
    </Modal>
  );
}

/**
 * A searchable, anchored multi-select (spec: "not a modal") built on Popover
 * rather than DropdownMenu, the search input inside needs to own normal text
 * editing and caret behaviour, which fights a menu's built-in typeahead and
 * roving-focus handling.
 */
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return invitees;
    return invitees.filter(
      (invitee) => invitee.name.toLowerCase().includes(term) || invitee.username?.toLowerCase().includes(term)
    );
  }, [invitees, query]);

  function usernameSuffixFor(invitee: PlanInvitee) {
    return invitee.username && duplicateNames.has(invitee.name.trim().toLowerCase()) ? `@${invitee.username}` : null;
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium leading-none">Invite Muddies</label>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={invitees.length === 0}
            className={cn(
              "focus-ring safe-motion flex w-full items-center justify-between gap-2 rounded-md border border-border bg-card/70 px-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50",
              fieldClassName
            )}
          >
            <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
              {invitees.length === 0
                ? "Add Muddies first"
                : selected.length > 0
                  ? `${selected.length} selected`
                  : "Select Muddies"}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            className="sidebar-flyout z-50 w-[--radix-popover-trigger-width] max-h-72 overflow-y-auto rounded-xl border border-border/80 bg-card p-2 shadow-lg outline-none dark:border-white/10 dark:bg-[#161617]"
          >
            <div className="sticky top-0 -m-2 mb-1 border-b border-border/70 bg-card p-2 dark:border-white/10 dark:bg-[#161617]">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search Muddies"
                  aria-label="Search Muddies"
                  className="focus-ring safe-motion h-9 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm"
                />
              </div>
            </div>
            {visible.length === 0 ? (
              <p className="p-3 text-center text-xs text-muted-foreground">No Muddies match your search.</p>
            ) : (
              <ul className="space-y-0.5 pt-1">
                {visible.map((invitee) => {
                  const isSelected = selected.includes(invitee.id);
                  const usernameSuffix = usernameSuffixFor(invitee);
                  return (
                    <li key={invitee.id}>
                      <button
                        type="button"
                        onClick={() => onToggle(invitee.id)}
                        aria-pressed={isSelected}
                        className={cn(
                          "focus-ring safe-motion flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm",
                          isSelected ? "bg-primary/10 text-primary" : "hover:bg-secondary"
                        )}
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-semibold text-foreground">
                          {invitee.name.trim().charAt(0).toUpperCase() || "?"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{invitee.name}</span>
                          {usernameSuffix ? (
                            <span className="block truncate text-xs text-muted-foreground">{usernameSuffix}</span>
                          ) : null}
                        </span>
                        <span
                          className={cn(
                            "grid h-4 w-4 shrink-0 place-items-center rounded border",
                            isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                          )}
                        >
                          {isSelected ? <Check className="h-3 w-3" aria-hidden="true" strokeWidth={3} /> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

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
    <Modal open={Boolean(plan)} onOpenChange={onOpenChange} title={plan?.title ?? "Plan"} description={plan ? dateLabel(plan) : undefined}>
      {plan ? (
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
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
                  <GlowAvatar name={attendee.name} size="sm" />
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
        <select
          value={pollType}
          onChange={(event) => setPollType(event.target.value)}
          aria-label="Poll type"
          className="focus-ring safe-motion h-10 rounded-md border border-border bg-card/70 px-2 text-sm"
        >
          <option value="time">Time</option>
          <option value="date">Date</option>
          <option value="place">Place</option>
          <option value="activity">Activity</option>
        </select>
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
