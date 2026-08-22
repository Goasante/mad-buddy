"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import {
  ChevronRight,
  Clock,
  Lock,
  MapPin,
  MessageCircle,
  Plus,
  Vote,
  X
} from "lucide-react";
import { useId, useMemo, useRef, useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import { isArchivedUnscheduledPlan, planPhase } from "@/lib/social/plans";
import type { PlanCategory, PlanStatus, SubscriptionPlan } from "@/lib/supabase/database.types";
import { PLAN_CATEGORIES, planCategoryLabel } from "@/lib/plans/plan-covers";
import { PlanCover } from "@/components/plans/plan-cover";
import { MobilePageHeader } from "@/components/app-shell/mobile-page-header";
import { useAppMenu } from "@/hooks/app-menu-context";
import { useUnreadNotifications } from "@/hooks/unread-notification-context";

export type PlanInvitee = { id: string; name: string; username?: string | null; avatarUrl?: string | null; plan: SubscriptionPlan };

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
  /**
   * The canonical status union, not a loose string. planPhase branches on
   * specific values, and a plain `string` lets an unhandled status reach it
   * and be silently mis-bucketed.
   */
  status: PlanStatus;
  startAt: string | null;
  /** Honoured by planPhase, so a plan stays upcoming until it actually ends. */
  endAt: string | null;
  /** Anchors the grace window for an undated plan. */
  createdAt: string | null;
  placeText: string | null;
  /** Cover inputs, resolved by lib/plans/plan-covers. */
  category: PlanCategory | null;
  coverImageUrl: string | null;
  organiserName: string;
  organiserPlan: SubscriptionPlan;
  isHost: boolean;
  myRsvp: string;
  attendees: Array<{ name: string; avatarUrl: string | null; rsvp: string; isMe: boolean; plan: SubscriptionPlan }>;
  polls: PlanPollSummary[];
  /**
   * The Plan conversation, present ONLY when the viewer is a joined member.
   * Null for an invitee who has not responded yet, which is why the Plan Chat
   * button can simply test this instead of re-deriving the RSVP rule.
   */
  myConversationId?: string | null;
};

type PlanBucket = "upcoming" | "invites" | "hosting" | "unscheduled" | "past";

const bucketTabs: Array<{ id: PlanBucket; label: string }> = [
  { id: "upcoming", label: "Upcoming" },
  { id: "invites", label: "Invitations" },
  { id: "hosting", label: "Created by you" },
  { id: "unscheduled", label: "No date yet" },
  { id: "past", label: "Past" }
];

const TERMINAL = new Set(["cancelled", "completed", "expired"]);

/** Categories shown before "More". Enough to be useful, few enough to scan. */
const QUICK_CATEGORY_COUNT = 6;

/**
 * Which tab a plan belongs to.
 *
 * PHASE FIRST, ROLE SECOND, and that order is the fix. This used to ask
 * `isPastPlan` and then fall through to role, so a plan with no date -- which
 * the old helper could never call past -- landed in Upcoming, Invitations or
 * Created by you and stayed there indefinitely. Nine of them were doing
 * exactly that in production.
 *
 * Every branch below reads planPhase, so this file no longer decides anything
 * about time for itself.
 */
function bucketFor(plan: PlanSummary): PlanBucket {
  const phase = planPhase(plan);
  if (phase === "past") return "past";
  // Undated: its own home, whether or not the grace window has run out. The
  // archived ones are still reachable here rather than disappearing, which is
  // the difference between setting a plan aside and losing it.
  if (phase === "unscheduled" || phase === "archived_unscheduled") return "unscheduled";
  if (plan.isHost) return "hosting";
  if (plan.myRsvp === "invited" || plan.myRsvp === "viewed") return "invites";
  return "upcoming";
}

function dateLabel(plan: PlanSummary): string {
  if (!plan.startAt) {
    // Says what actually happened rather than "Time TBD" forever. An undated
    // plan past its grace window has left Upcoming, and the owner should learn
    // that here rather than from its absence.
    if (isArchivedUnscheduledPlan(plan)) return "Set aside — add a time to bring it back";
    return plan.planType === "poll" ? "Time being decided" : "No date yet";
  }
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
  // Shared shell chrome: one menu sheet, one unread count.
  const openAppMenu = useAppMenu();
  const unreadNotificationCount = useUnreadNotifications();
  const [createOpen, setCreateOpen] = useState(() => searchParams.get("create") === "1");
  /* Who the Plan is with, when the user arrived from a relationship surface.
     Read once from the URL so a refresh keeps the context. */
  const contextMuddyId = searchParams.get("with");
  const createRequestKeyRef = useRef<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(() => requestedPlan?.id ?? null);

  /**
   * Open the plan named in ?plan=, including on a CLIENT-SIDE navigation.
   *
   * `selectedPlanId` and `activeBucket` above are useState INITIALISERS: they
   * run once, when the component first mounts. Arriving from Linkr is a
   * client transition into an already-mounted page, so they never re-ran and
   * the link silently did nothing — the plan was loaded and the modal simply
   * never opened.
   *
   * Derived during render rather than synced in an effect, matching the
   * initialPlans sync above: an effect would paint one frame of the plans list
   * before the modal appeared.
   *
   * Tracking the param VALUE (not just its presence) is what lets the user
   * close the modal and stay closed — without it, every subsequent render
   * would re-open the same plan.
   */
  const planParam = searchParams.get("plan");
  const [trackedPlanParam, setTrackedPlanParam] = useState(planParam);
  if (trackedPlanParam !== planParam) {
    setTrackedPlanParam(planParam);
    const target = planParam ? plans.find((plan) => plan.id === planParam) ?? null : null;
    // A param naming a plan this user cannot see leaves the page as it is,
    // rather than opening an empty modal.
    if (target) {
      setSelectedPlanId(target.id);
      // Follow the plan into its own bucket: a hosted plan opened from the
      // "upcoming" tab would otherwise sit behind a filter that hides it.
      setActiveBucket(bucketFor(target));
    }
  }
  const [feedback, setFeedback] = useState("");
  /**
   * A refusal the composer can actually show.
   *
   * `feedback` renders on the PAGE, and the composer is a modal layered over
   * it -- so a refused Plan explained itself on a surface hidden behind the
   * open sheet. The person saw the form simply not submit, with no reason
   * given. This is the same message, rendered where they are looking.
   */
  const [createError, setCreateError] = useState("");
  const [isPending, startTransition] = useTransition();
  /**
   * Creating a Plan is a MUTATION, so it does not run inside a transition.
   * React abandons transition work by design, which kills the Server Action
   * mid-flight and leaves the person unable to tell whether the Plan was made.
   */
  const [isCreating, setIsCreating] = useState(false);

  const visiblePlans = useMemo(
    () => plans.filter((plan) => bucketFor(plan) === activeBucket),
    [plans, activeBucket]
  );
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null;

  function changeRsvp(planId: string, rsvp: "going" | "maybe" | "not_going") {
    /* A REFUSED RSVP MUST NOT LOOK LIKE AN ACCEPTED ONE.
     *
     * The optimistic update was never rolled back, so a server refusal -- a
     * cancelled Plan, a passed deadline, an ended friendship, a full guest list
     * -- left "Going" selected underneath an error message saying it had not
     * worked. router.refresh() eventually corrected it, but in the meantime the
     * UI contradicted both the server and its own feedback.
     *
     * The previous answer is captured first and restored on failure, so the
     * control keeps showing what the server actually believes. The optimistic
     * paint stays for the successful path, which is nearly all of them. */
    const previousRsvp = plans.find((plan) => plan.id === planId)?.myRsvp;
    setPlans((current) =>
      current.map((plan) => (plan.id === planId ? { ...plan, myRsvp: rsvp } : plan))
    );
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof rsvpAction>>;
      try {
        result = await rsvpAction(planId, rsvp);
      } catch {
        if (previousRsvp !== undefined) {
          setPlans((current) =>
            current.map((plan) => (plan.id === planId ? { ...plan, myRsvp: previousRsvp } : plan))
          );
        }
        setFeedback("Couldn't save your RSVP. Try again.");
        return;
      }
      if (!result.ok && previousRsvp !== undefined) {
        setPlans((current) =>
          current.map((plan) => (plan.id === planId ? { ...plan, myRsvp: previousRsvp } : plan))
        );
      }
      setFeedback(result.message);
      // Authoritative counts, roster statuses, and -- because reconciliation
      // runs inside the RSVP transaction -- the Plan Chat button appearing.
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
    category: PlanCategory | null;
    participantIds: string[];
  }) {
    void (async () => {
      setIsCreating(true);
      setCreateError("");
      const result = await createPlanAction({
        requestKey:
          createRequestKeyRef.current ?? (createRequestKeyRef.current = crypto.randomUUID()),
        title: input.title,
        description: input.description || undefined,
        planType: input.startAt ? "scheduled" : "quick",
        startAt: input.startAt,
        placeType: "custom",
        customPlaceText: input.placeText || undefined,
        // Optional and never inferred: no category means the branded
        // fallback cover, not a guess from the title.
        category: input.category,
        participantIds: input.participantIds
      });
      setIsCreating(false);
      setFeedback(result.message);
      if (!result.ok) {
        /* STAY IN THE COMPOSER. A refused Plan keeps everything typed and says
         * why, right here -- navigating or closing would discard the work and
         * leave the person guessing what was wrong. */
        setCreateError(result.message);
        return;
      }
      {
        createRequestKeyRef.current = null;
        setCreateError("");
        setCreateOpen(false);
        setActiveBucket("hosting");
        /* LAND ON THE PLAN, NOT ON A LIST CONTAINING IT.
         *
         * Creating dropped the user onto the "Created by you" tab and left
         * them to spot their own new Plan among the others -- so the moment
         * after the most deliberate action in the product was a search task.
         * Opening it directly is also what makes the invite state visible: it
         * is where "invited" appears beside the person they chose. */
        if (result.planId) setSelectedPlanId(result.planId);
        router.refresh();
      }
    })();
  }

  const inviteCount = useMemo(() => plans.filter((plan) => bucketFor(plan) === "invites").length, [plans]);

  return (
    <div className="mx-auto max-w-[640px] md:pt-5">
      {/* Canonical mobile header (mobile only). Plans is a bottom-nav root,
          so it keeps Notifications and Add Muddy; Quick Controls is Home's. */}
      <MobilePageHeader
        title="Plans"
        onOpenMenu={openAppMenu}
        showQuickControls={false}
        unreadNotificationCount={unreadNotificationCount}
      />

      <header className="flex items-start justify-between gap-3 pt-1 md:pt-0">
        <div className="min-w-0">
          {/* Hidden on mobile: the shared header above already carries the
              title there. Desktop has no mobile header, so it keeps this. */}
          <h1 className="hidden text-2xl font-semibold tracking-tight md:block sm:text-3xl">Plans</h1>
          <p className="mt-1 text-sm text-muted-foreground">Plan something with your Muddies.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0 whitespace-nowrap"
          onClick={() => setCreateOpen(true)}
          data-tour-id={TOUR_TARGET_IDS.PLANS_CREATE}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New plan
        </Button>
      </header>

      {feedback ? (
        <div className="mt-4 rounded-[1rem] border border-orange-400/20 bg-orange-400/10 p-3 text-sm text-orange-800 dark:text-orange-50" role="status">
          {feedback}
        </div>
      ) : null}

      {/* THE CLIPPED TAB WAS SCROLLING, NOT BREAKING.
       *
       * "No date y..." in the screenshot is the last tab meeting the viewport
       * edge -- the strip already scrolls (overflow-x-auto + w-max + shrink-0 +
       * whitespace-nowrap), so nothing is truncated or unreachable. What was
       * missing is the SIGNAL: `no-scrollbar` hides the bar, so a cleanly cut
       * label looked like a layout bug rather than an invitation to swipe.
       *
       * A fade on the trailing edge says "there is more this way" without
       * shrinking type or abbreviating labels. It is masked out from `sm` up,
       * where every tab fits and there is nothing to hint at. */}
      <nav
        data-tour-id={TOUR_TARGET_IDS.PLANS_TABS}
        className="no-scrollbar plans-tab-strip -mx-4 mt-4 overflow-x-auto border-b border-border/70 px-4 sm:mx-0 sm:px-0"
        aria-label="Plans tabs"
      >
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
                  // min-h-11 (44px) is the app-wide minimum touch target; padding alone
                  // left this underline tab row at 42px.
                  "focus-ring safe-motion inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium",
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

      <div data-tour-id={TOUR_TARGET_IDS.PLANS_LIST} className="mt-4">
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
            {/* AN END MARKER, NOT A SECOND EMPTY STATE.
             *
             * This was a bordered card with a primary-coloured icon and two
             * lines of copy, sitting directly under a real plan -- heavier than
             * the genuine empty state and reading as "there is nothing here"
             * on a tab that plainly had something in it.
             *
             * Reaching the end of a short list is not an event that needs a
             * card. One quiet line closes the list; the empty state below still
             * does the real work when a tab has zero plans. */}
            <p className="mt-4 pb-1 text-center text-xs text-muted-foreground">
              {listEndCopy[activeBucket].title}
            </p>
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
        contextMuddyId={contextMuddyId}
        invitees={invitees}
        pending={isPending || isCreating}
        error={createError}
        onOpenChange={(next) => {
          if (!next) createRequestKeyRef.current = null;
          setCreateOpen(next);
        }}
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
        // The canonical Plan conversation on the Messages surface -- the same
        // route a Plan Chat opened from anywhere else lands on. Deliberately
        // NOT a DM with the organiser: a Plan has one conversation, and this is
        // it.
        onOpenChat={(conversationId) =>
          router.push(`/messages?conversation=${encodeURIComponent(conversationId)}` as Route)
        }
      />
    </div>
  );
}

const emptyCopy: Record<PlanBucket, { title: string; description: string }> = {
  upcoming: { title: "Nothing planned yet", description: "Your upcoming plans will appear here." },
  invites: { title: "No invitations", description: "New plan invitations will appear here." },
  hosting: { title: "No plans created yet", description: "Create a plan and invite your Muddies." },
  unscheduled: {
    title: "Nothing waiting on a time",
    description: "Plans without a date yet will appear here."
  },
  past: { title: "No past plans", description: "Plans you've joined will appear here." }
};

const bucketSectionLabel: Record<PlanBucket, string> = {
  upcoming: "Upcoming plans",
  invites: "Invitations",
  hosting: "Created by you",
  unscheduled: "Waiting on a time",
  past: "Past plans"
};

/* One quiet line each. The second line these used to carry ("Create a plan to
 * meet up with your Muddies.") was prompting the user to act at the bottom of a
 * list that already showed them acting -- that job belongs to the empty state
 * and to the Create button, not to the end of a populated list. */
const listEndCopy: Record<PlanBucket, { title: string }> = {
  upcoming: { title: "No more upcoming plans" },
  invites: { title: "That's every invitation" },
  hosting: { title: "That's all you've created" },
  unscheduled: { title: "That's everything without a time" },
  past: { title: "You've reached the start" }
};

// The title-keyword icon rules that used to live here are gone. They guessed
// a plan's subject from its title ("beach|swim|pool" -> a sun icon), which is
// exactly the inference the canonical cover system forbids: a plan's cover now
// comes from its stored category, or from the branded fallback when it has
// none. See lib/plans/plan-covers.

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
  // The card had its own copy of this, so a plan could read "Time TBD" here
  // while the row above already said it had been set aside. One rule, asked
  // once.
  const timeLabel = plan.startAt
    ? new Date(plan.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : isArchivedUnscheduledPlan(plan)
      ? "Set aside"
      : plan.planType === "poll"
        ? "Time being decided"
        : "No date yet";
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
        {/* The plan's cover, from the same canonical resolver Home uses. It
            replaces the status-derived icon tile that used to sit here —
            status is already carried by the pill on the right, so the tile
            was a second marker for it, and this gives the card the plan's own
            identity instead. */}
        <PlanCover
          category={plan.category}
          coverImageUrl={plan.coverImageUrl}
          rounded="rounded-xl"
          className="mt-0.5 h-11 w-11"
        />

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
            {/* Organiser name only. The same rule as the Plan roster: the
                person who invited you is a Muddy, and their billing tier is
                not a fact about the Plan you are deciding whether to join. */}
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
  error,
  contextMuddyId,
  onOpenChange,
  onCreate
}: {
  open: boolean;
  invitees: PlanInvitee[];
  pending: boolean;
  /**
   * Why the last attempt was refused, shown INSIDE this sheet.
   *
   * The page-level feedback banner sits underneath this modal, so a refusal
   * rendered there was invisible: the form just did not submit and said
   * nothing. A refusal has to appear where the person is looking.
   */
  error?: string;
  /**
   * The Muddy this Plan started from, if the user arrived from a relationship.
   *
   * CONTEXT SHOULD FOLLOW THE USER. Tapping "Make a Plan" on Kofi and then
   * being asked to search for Kofi again is the product forgetting what you
   * just did. An id only -- person context, never a location payload.
   */
  contextMuddyId?: string | null;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: {
    title: string;
    description: string;
    startAt: string | null;
    placeText: string;
    category: PlanCategory | null;
    participantIds: string[];
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [placeText, setPlaceText] = useState("");
  const [description, setDescription] = useState("");
  // Optional. Null means "no category", which resolves to the branded
  // fallback cover — never a guess.
  const [category, setCategory] = useState<PlanCategory | null>(null);
  /* Seeded from the relationship the user came from. Filtered against real
     invitees so a stale or unauthorised id simply selects nobody. */
  const contextSelection = useMemo(
    () =>
      contextMuddyId && invitees.some((invitee) => invitee.id === contextMuddyId)
        ? [contextMuddyId]
        : [],
    [contextMuddyId, invitees]
  );
  const [selected, setSelected] = useState<string[]>(contextSelection);
  /* The person named at the top, resolved from real invitees only -- an id the
     viewer is not actually Muddies with resolves to nothing. */
  const contextInvitee = useMemo(
    () => invitees.find((invitee) => invitee.id === contextMuddyId) ?? null,
    [invitees, contextMuddyId]
  );
  const [nameTouched, setNameTouched] = useState(false);
  /* CATEGORIES ACCELERATE, THEY DO NOT ENUMERATE.
   *
   * All fifteen wrapped across several rows and became the tallest thing in
   * the composer -- a taxonomy to browse rather than a shortcut. The common
   * few are shown; the rest stay one tap away, and a category chosen from
   * "More" keeps its chip visible so the selection is never hidden. */
  const [showAllCategories, setShowAllCategories] = useState(false);
  const shownCategories = useMemo(() => {
    if (showAllCategories) return PLAN_CATEGORIES;
    const quick = PLAN_CATEGORIES.slice(0, QUICK_CATEGORY_COUNT);
    return category && !quick.includes(category) ? [...quick, category] : quick;
  }, [showAllCategories, category]);
  const formId = useId();

  function reset() {
    setTitle("");
    setDate("");
    setTime("");
    setPlaceText("");
    setDescription("");
    setCategory(null);
    setSelected(contextSelection);
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
                category,
                participantIds: selected
              });
            }}
          >
            {/* Says the send is under way rather than sitting inert while the
                canonical lifecycle runs. Never a fake completion: the label
                returns to "Create plan" unless the server actually succeeded. */}
            {pending ? "Creating…" : "Create plan"}
          </Button>
        </>
      }
    >
      {/* THE REFUSAL, WHERE THE PERSON IS LOOKING (§16, §21).
          role="alert" so it is announced rather than only seen, and placed at
          the top of the body so it is not below the fold of a scrolled form.
          Everything typed stays exactly where it was. */}
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-[0.75rem] border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      <div className="space-y-5 pb-1 pr-1">
        {/* WHO THIS STARTED WITH, stated before anything is asked.
            Somebody who tapped "Make a Plan" on Kofi should see Kofi here
            rather than wonder whether the app kept track. They stay editable
            below -- this confirms the context, it does not lock it. */}
        {contextInvitee ? (
          <p className="flex items-center gap-2.5 text-sm">
            {/* UserAvatar, not GlowAvatar. Glow is the proximity treatment and
                needs proximity props even to be switched off -- passing
                "hidden"/0 here meant a Plan surface reasoning about nearness
                it has no business knowing. This is Plan context, so it uses
                the plain identity avatar the picker below uses. */}
            <UserAvatar
              name={contextInvitee.name}
              src={contextInvitee.avatarUrl ?? null}
              size="xs"
            />
            <span className="text-muted-foreground">
              Planning with <span className="font-semibold text-foreground">{contextInvitee.name}</span>
            </span>
          </p>
        ) : null}

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
            // An idea, not an idea plus a time. "Lunch later" hinted that the
            // when belonged in this box, which the When field asks separately.
            placeholder="Grab food"
            className={fieldClassName}
          />
        </FormField>

        {/* Optional cover category. Same chip language as "When?" below.
            Choosing one picks the plan's canonical cover; leaving it unset is
            perfectly valid and yields the branded fallback. */}
        <div>
          <p className="mb-1.5 text-sm font-medium">
            What kind of plan? <span className="font-normal text-muted-foreground">(optional)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {shownCategories.map((option) => {
              const active = category === option;
              return (
                <button
                  key={option}
                  type="button"
                  // Tapping the active chip clears it, so a category can be
                  // undone without resetting the whole form.
                  onClick={() => setCategory(active ? null : option)}
                  aria-pressed={active}
                  className={cn(
                    "focus-ring safe-motion flex items-center gap-1.5 rounded-full border py-1.5 pl-1.5 pr-3 text-sm font-medium",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary/50"
                  )}
                >
                  <PlanCover category={option} rounded="rounded-full" className="h-5 w-5" />
                  {planCategoryLabel(option)}
                </button>
              );
            })}
            {!showAllCategories && PLAN_CATEGORIES.length > shownCategories.length ? (
              <button
                type="button"
                onClick={() => setShowAllCategories(true)}
                className="focus-ring safe-motion rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-secondary/50"
              >
                More
              </button>
            ) : null}
          </div>
        </div>

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
            // "Nearby area" quietly echoed proximity, a different idea
            // entirely: this is a place the user types, not one the app knows.
            placeholder="Café, cinema, campus…"
            className={fieldClassName}
          />
          {/* THE OLD HELPER SAID "Keep it general — no exact addresses."
              That was the wrong invariant. The rule Mad Buddy protects is that
              GLOW never exposes where a friend is; it was never that Muddies
              may not deliberately tell each other where to meet. Deciding on a
              café and being told not to name it makes the product useless for
              the thing it exists to arrange.

              No replacement text: the footer already says only invited Muddies
              see this plan, and saying it twice is not reassurance. */}
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
          /* The same face as Home and the context line above. UserAvatar owns
             the no-photo fallback, so nothing here invents one. */
          icon: <UserAvatar src={invitee.avatarUrl ?? null} name={invitee.name} size="xs" />
        }))}
        /* SAYS WHAT IT DOES NEXT, not who is already coming.
           The trigger used to echo the current selection while the chips below
           repeated it -- the control telling you about Kofi twice, when its
           actual remaining job is adding somebody else. */
        placeholder={invitees.length === 0 ? "Add Muddies first" : "Add Muddy"}
        alwaysShowPlaceholder
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
              <UserAvatar src={invitee.avatarUrl ?? null} name={invitee.name} size="xs" />
              {invitee.name}
              {/* NO SUBSCRIPTION TIER AMONG PEOPLE YOU ARE MEETING.
                  A participant in a private Plan is a Muddy first; ranking the
                  guest list by who pays has nothing to do with arranging to see
                  them. The badge stays everywhere it is genuinely about
                  entitlement -- this is a coordination space. */}
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
  onAddPoll,
  onOpenChat
}: {
  plan: PlanSummary | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onRsvpChange: (rsvp: "going" | "maybe" | "not_going") => void;
  onVote: (pollId: string, optionId: string) => void;
  onCancel: () => void;
  onAddPoll: (question: string, pollType: string, options: string[]) => void;
  onOpenChat: (conversationId: string) => void;
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
              {/* THE HEADING MUST DESCRIBE WHAT IS UNDER IT.
                  "Who's going (1)" sat above a list containing one person who
                  was going and one who had only been invited -- a count that
                  was accurate about confirmations and a title that was wrong
                  about the list. Naming the section for the people, and
                  putting the confirmed count in words beside it, lets both be
                  true at once without splitting the list. */}
              People ({plan.attendees.filter((a) => a.rsvp === "going").length} going)
            </p>
            <ul className="space-y-2">
              {plan.attendees.map((attendee) => (
                <li key={attendee.name} className="flex items-center gap-3 rounded-lg border border-border/70 bg-background/60 px-3 py-2">
                  {/* UserAvatar, not GlowAvatar: a Plan roster is a guest list,
                      and Glow is the proximity treatment. Who is coming to a
                      Plan has nothing to do with who is near you right now. */}
                  <UserAvatar name={attendee.name} src={attendee.avatarUrl} size="sm" />
                  <span className="text-sm font-medium">{attendee.name}</span>
                  {/* NO SUBSCRIPTION TIER AMONG PEOPLE YOU ARE MEETING.
                      The composer already dropped this badge for the same
                      reason: inside a private Plan a person is a Muddy, not a
                      billing tier, and rating your guest list by who pays has
                      nothing to do with arranging to meet them. RSVP stays --
                      that is the one status a guest list genuinely carries. */}
                  <RsvpBadge rsvp={attendee.rsvp} className="ml-auto" />
                </li>
              ))}
            </ul>
          </div>

          {!plan.isHost && !TERMINAL.has(plan.status) ? (
            <div data-tour-id={TOUR_TARGET_IDS.PLANS_RSVP}>
              {/* "You're invited" before you have answered, "Your RSVP" after.
                  The old label described the form field rather than the moment:
                  someone opening a fresh invitation was met with an admin word
                  for a thing a friend just asked them. Once answered, the
                  heading goes back to naming what the controls now change. */}
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {plan.myRsvp === "invited" || plan.myRsvp === "viewed" ? "You're invited" : "Your RSVP"}
              </p>
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

          {/* THE PLACE THE PLAN ACTUALLY HAPPENS.
           *
           * Plan detail had no route into the Plan conversation at all, so the
           * surface where people sort out when and where was reachable only by
           * hunting through Messages. It sits directly under the RSVP controls
           * because that is the order of events: answer, then coordinate.
           *
           * Shown only when myConversationId is set, which the server fills in
           * only for a joined member. An invitee who has not responded sees
           * nothing here rather than a button that would refuse them -- and
           * nothing locked or upsold either, since this is not a paid feature. */}
          {plan.myConversationId ? (
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center"
              onClick={() => onOpenChat(plan.myConversationId as string)}
            >
              <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
              Open Plan Chat
            </Button>
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
      /* method="post": without JavaScript a form with no method submits as
         GET and puts its fields in the URL (MB-GOD-003's defect shape). */
      method="post"
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
