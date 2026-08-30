"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { cameFromInsideApp, resolveBack } from "@/lib/navigation/entry-origin";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  Coffee,
  Dumbbell,
  Footprints,
  Gamepad2,
  Car,
  Clapperboard,
  Hand,
  Loader2,
  Lock,
  Moon,
  PartyPopper,
  Plus,
  ShieldCheck,
  Shuffle,
  Trophy,
  Users,
  UtensilsCrossed,
  Wine,
  X
} from "lucide-react";
import {
  convertHangoutToPlanAction,
  endHangoutAction,
  getOwnerHangoutRequestsAction,
  leaveHangoutAction,
  getVisibleHangoutsAction,
  requestHangoutAction,
  respondHangoutRequestAction,
  startHangoutAction,
  type VisibleHangout
} from "@/app/(app)/hangout-actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import { UpForFeed } from "@/components/hangout/upfor-feed";
import { UpForDetailSheet } from "@/components/hangout/upfor-detail-sheet";
import { PlanStack } from "@/components/socialize/plan-stack";
import { PageSectionHeader } from "@/components/app-shell/page-section-header";
import { rsvpAction } from "@/app/(app)/plans-actions";
import type { HomeUpcomingPlan } from "@/lib/social/upcoming-plans";
import { useHasScrolled } from "@/hooks/use-has-scrolled";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useCountdownResume } from "@/hooks/use-countdown-clock";
import { OwnedUpForsSection } from "@/components/hangout/owned-upfors-section";
import type { OwnedUpFor } from "@/lib/social/owned-upfors";
import { resolveViewerTimeZone, upForTimeSlots } from "@/lib/social/upfor-schedule-options";
import { cn } from "@/lib/utils";
import { countActiveRequests } from "@/lib/social/hangout-requests";
import { HANGOUT_ACTIVITY_LABELS } from "@/lib/social/plans";
import { UPFOR_QUICK_IDEAS } from "@/lib/social/upfor";
import { conversationHref } from "@/lib/messaging/open-conversation";
import { withTimeout } from "@/lib/network/resilience";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import type {
  HangoutActivityType,
  HangoutAudienceType,
  HangoutRequestStatus
} from "@/lib/supabase/database.types";

export type ActiveHangout = {
  id: string;
  activityType: HangoutActivityType;
  audienceType: HangoutAudienceType;
  message: string | null;
  endsAt: string;
};

export type HangoutRequestSummary = {
  id: string;
  requesterName: string;
  status: HangoutRequestStatus;
  message: string | null;
};

type Duration = "30m" | "1h" | "3h";

const activityOptions: Array<{ id: HangoutActivityType; label: string }> = (
  ["anything", "food", "study", "sports", "gym", "walk", "gaming", "chill"] as HangoutActivityType[]
).map((id) => ({ id, label: HANGOUT_ACTIVITY_LABELS[id] ?? id }));

const audienceOptions: Array<{ id: HangoutAudienceType; label: string }> = [
  { id: "all_muddies", label: "All Muddies" },
  { id: "close_friends", label: "Close Friends" }
];


const durationOptions: Array<{ id: Duration; label: string; ms: number }> = [
  { id: "30m", label: "30 mins", ms: 30 * 60 * 1000 },
  { id: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { id: "3h", label: "3 hours", ms: 3 * 60 * 60 * 1000 }
];

const ACTIVITY_ICONS: Record<HangoutActivityType, typeof Hand> = {
  // The original eight.
  /* "Anything" is an OPEN CHOICE -- the person has not picked an activity and
     is up for whatever fits. Shuffle says that literally; Sparkles said the
     option was somehow special, which it is not: it sits alongside food, gym
     and study as one ordinary choice among them. */
  anything: Shuffle,
  food: UtensilsCrossed,
  study: BookOpen,
  sports: Trophy,
  gym: Dumbbell,
  walk: Footprints,
  gaming: Gamepad2,
  chill: Moon,
  /* Added with the 20260822120000 migration. `chill` moves to a moon so
   * `coffee` can take the cup it always should have had -- the label was
   * already "Chill 🌙" everywhere else, so this aligns the icon with the word
   * rather than changing what the category means. */
  coffee: Coffee,
  football: Trophy,
  drinks: Wine,
  movie: Clapperboard,
  drive: Car,
  party: PartyPopper
};

const audienceLabel: Record<HangoutAudienceType, string> = {
  all_muddies: "all your Muddies",
  close_friends: "your Close Friends",
  selected_circles: "selected circles",
  selected_muddies: "selected Muddies",
  // Public communities, not private Circles -- the wording keeps them apart.
  selected_groups: "selected groups"
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Human "1h 20m remaining" from an end time (empty once elapsed). */
function remainingLabel(endsAt: string, nowMs: number): string {
  const totalMinutes = Math.max(0, Math.round((Date.parse(endsAt) - nowMs) / 60000));
  if (totalMinutes === 0) return "ending now";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

/** Short audience label for the "Visible to …" pill. */
function visibleToLabel(audience: HangoutAudienceType, muddyCount: number): string {
  if (audience === "all_muddies") return `${muddyCount} ${muddyCount === 1 ? "Muddy" : "Muddies"}`;
  if (audience === "close_friends") return "Close Friends";
  if (audience === "selected_circles") return "selected circles";
  return "selected Muddies";
}

type Toast = { title?: string; message: string; error: boolean } | null;

export function HangoutModePage({
  initialActiveHangout = null,
  initialOwnedUpFors = [],
  initialRequests = [],
  initialFeed = [],
  avatarUrl = null,
  displayName = "",
  muddyCount = 0,
  viewerId = null,
  initialPlans = []
}: {
  initialActiveHangout?: ActiveHangout | null;
  /** Every UpFor the owner holds -- the owner-facing authority. */
  initialOwnedUpFors?: OwnedUpFor[];
  initialRequests?: HangoutRequestSummary[];
  initialFeed?: VisibleHangout[];
  avatarUrl?: string | null;
  displayName?: string;
  muddyCount?: number;
  /** The signed-in user, so the sheet can recognise their own UpFor. */
  viewerId?: string | null;
  /** Upcoming plans, from the same projection Home and Linkr read. */
  initialPlans?: HomeUpcomingPlan[];
}) {
  const router = useRouter();
  const requestedHangoutId = useSearchParams().get("hangout");
  const reducedMotion = useReducedMotion();
  // Drives the header divider once content passes beneath it.
  const scrolled = useHasScrolled();

  const [activeHangout, setActiveHangout] = useState(initialActiveHangout);
  /* EXPLICIT INTENT, NOT INFERRED FROM EXISTENCE.

     The defect this replaces: `editing` was `activeHangout !== null`, so
     having ANY UpFor made the next creation an edit -- and an edit ends the
     previous session. Creating B therefore cancelled A, and C cancelled B.
     Production data showed exactly that chain of cancellations.

     Now the form is told what it is for. null means create; an id means edit
     that specific UpFor and no other. Nothing about how many sessions exist
     can change which one an action targets. */
  const [editingUpForId, setEditingUpForId] = useState<string | null>(null);
  const [ownedUpFors, setOwnedUpFors] = useState(initialOwnedUpFors);
  /* Which owned UpFor the management surface is showing. ONE selection is
     legitimate UI state; one session standing in for the whole collection is
     the defect this repair removed. */
  const [managingId, setManagingId] = useState<string | null>(null);
  const [requestsByUpFor, setRequestsByUpFor] = useState<Record<string, HangoutRequestSummary[]>>({});
  /* Pending count per UpFor, from the session-scoped projection. Derived, so
     a row cannot disagree with the list the sheet will show. */
  const pendingRequestCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [upForId, rows] of Object.entries(requestsByUpFor)) {
      counts[upForId] = rows.filter((row) => row.status === "pending").length;
    }
    return counts;
  }, [requestsByUpFor]);
  const [requests, setRequests] = useState(initialRequests);
  const [feed, setFeed] = useState(initialFeed);
  /**
   * Feed-level failure, kept in context.
   *
   * The list itself arrives as a server prop, so there is no client fetch to
   * be "loading" -- claiming a skeleton on first paint would be theatre. This
   * holds a REFRESH failure instead, which is the only feed-level error a
   * person on this screen can actually hit, and it stays on the page rather
   * than routing to a full-page error for something a retry usually fixes.
   */
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedRefreshing, setFeedRefreshing] = useState(false);

  /**
   * Re-read the eligible feed after a write, or after a failure.
   *
   * A plain function, deliberately NOT useCallback. This component already
   * carries manual memoization that the React Compiler analyses as a whole;
   * adding one more useCallback made the inferred dependencies disagree with
   * the written ones and the compiler skipped optimizing the entire component
   * -- three lint errors for a memo nothing here needed. The function is
   * called from event handlers, never passed as a dependency.
   */
  async function refreshFeed() {
    setFeedRefreshing(true);
    try {
      const next = await getVisibleHangoutsAction();
      setFeed(next);
      setFeedError(null);
    } catch {
      setFeedError("Couldn't load UpFors. Try again.");
    } finally {
      setFeedRefreshing(false);
    }
  }

  /* ANSWER "MAYBE" REMOVED (owner decision).
   *
   * The decision vocabulary is Accept or Decline. The 'maybe' value stays in
   * hangout_requests for rows that already carry it -- deleting a schema value
   * that historic data uses would be destructive for no benefit -- but nothing
   * in the UI can create a new one. UpForCard reads an existing 'maybe' as
   * still-waiting rather than stranding it in an unrenderable state.
   */

  // Setup form draft state (only meaningful while the sheet is open).
  const [setupOpen, setSetupOpen] = useState(false);
  const [activity, setActivity] = useState<HangoutActivityType | null>(null);
  const [audience, setAudience] = useState<HangoutAudienceType>("all_muddies");
  const [duration, setDuration] = useState<Duration>("1h");
  /* Scheduling is one extra choice on the existing form, not a sub-product:
     "Now" behaves exactly as it always has, and "Later today" reveals a time
     list for the rest of today only. There is deliberately no date input. */
  const [when, setWhen] = useState<"now" | "later">("now");
  const [startAtIso, setStartAtIso] = useState<string>("");
  const viewerTimeZone = useMemo(() => resolveViewerTimeZone(), []);
  const [message, setMessage] = useState("");
  const [broadArea, setBroadArea] = useState("");
  /**
   * The visibility choice. Defaults to the private answer, so a user who
   * never touches this control cannot widen their own UpFor by omission.
   */
  const [discoveryScope, setDiscoveryScope] = useState<"muddies" | "nearby">("muddies");
  const [attempted, setAttempted] = useState(false);
  // Inline, in-sheet failure — a toast can render behind/underneath an open
  // sheet, so activation failure needs to be visible where the user is
  // actually looking, without dismissing the sheet.
  const [setupError, setSetupError] = useState("");


  const [toast, setToast] = useState<Toast>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  /* Recomputed as the clock ticks, so a form left open past a slot stops
     offering it -- rather than letting the server reject it on submit. */
  const timeSlots = useMemo(
    () => upForTimeSlots(new Date(nowMs), viewerTimeZone),
    [nowMs, viewerTimeZone]
  );

  /**
   * Filter state, held here rather than in the sheet.
   *
   * The sheet is presentation: it unmounts when closed, and state living
   * inside it would reset every time — so a user could not open the sheet,
   * close it, and still see their narrowing applied.
   */

  /**
   * The open UpFor, held as an ID rather than the row itself.
   *
   * The sheet re-reads from `feed` on every render, so a join, a leave or an
   * arriving refresh updates it in place. Holding the object would freeze a
   * copy that silently drifts from the list behind it.
   */
  const [detailId, setDetailId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRefreshRef = useRef<Promise<void> | null>(null);

  /* The feed is no longer narrowed here. UpForFeed owns discovery now: the
   * four modes are the only filter, and they are applied by the tested rules
   * in lib/social/upfor-feed.ts rather than by a second filtering path on this
   * page. lib/social/upfor-filters.ts survives for the callers that still use
   * hasSpace/isJoined. */
  // Null when the row is gone — expired, or access lost on refresh — which
  // closes the sheet without announcing why.
  const detailUpFor = detailId ? (feed.find((item) => item.id === detailId) ?? null) : null;

  // Derive activation straight from the source of truth so an expired session
  // flips the orb back to inactive without a manual refresh.
  const isActive = activeHangout !== null && Date.parse(activeHangout.endsAt) > nowMs;

  /* The clock now also re-reads on visibilitychange/pageshow, so a phone that
     spent forty minutes in a pocket shows the correct countdown on the first
     frame back rather than up to 30s later. See useCountdownClock. */
  useCountdownResume(setNowMs);

  useEffect(() => {
    if (!requestedHangoutId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`hangout-${requestedHangoutId}`)?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "center"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedHangoutId, reducedMotion]);

  // Canonical refetch of the owner's join requests — the database is the source
  // of truth, never client-side arithmetic. Adopts the server list only for the
  // current active Hangout, so requests from an unrelated session never leak in.
  const activeHangoutId = activeHangout?.id ?? null;
  const refreshRequests = useCallback(async () => {
    if (requestRefreshRef.current) return requestRefreshRef.current;

    const refresh = (async () => {
      try {
        const state = await withTimeout(getOwnerHangoutRequestsAction(), {
          operation: "refresh hangout requests"
        });
        if (state.hangoutId && state.hangoutId === activeHangoutId) {
          setRequests(state.requests);
        } else if (!state.hangoutId) {
          setRequests([]);
        }
      } catch {
        // A failed refetch simply leaves the last known canonical state in place.
      } finally {
        requestRefreshRef.current = null;
      }
    })();

    requestRefreshRef.current = refresh;
    return refresh;
  }, [activeHangoutId]);

  // Live count updates for the owner: refetch on an interval while the Hangout
  // is active and whenever the tab regains focus. Reuses the project's server-
  // action data pattern rather than introducing a new realtime framework. The
  // interval and listener are cleaned up on unmount or when the Hangout ends.
  useEffect(() => {
    if (!isActive) return;
    // Initial refetch is scheduled (not called synchronously in the effect body)
    // so it never triggers a cascading render on mount.
    const initial = setTimeout(() => void refreshRequests(), 0);
    const interval = setInterval(() => {
      if (!document.hidden) void refreshRequests();
    }, 15_000);
    const onFocus = () => void refreshRequests();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [isActive, refreshRequests]);

  useEffect(() => {
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  /* Plain functions, not useCallback.
   *
   * Both close over `setToast`, which React guarantees is stable -- so the
   * empty and [scheduleToastDismiss] dependency arrays were correct by hand
   * and wrong to the React Compiler, which infers `setToast` as a dependency
   * and refuses to optimize a component whose written deps disagree with its
   * inferred ones. Neither of these is ever passed as a dependency or to a
   * memoized child, so the memo bought nothing and cost the whole component
   * its optimization. */
  function scheduleToastDismiss() {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setToast(null), 3500);
  }

  function showToast(message: string, error = false, title?: string) {
    setToast({ message, error, title });
    scheduleToastDismiss();
  }

  /**
   * Open the setup sheet.
   *
   * `preset` comes from a Quick Idea tile: the sheet opens with that activity
   * already chosen, so "one tap" means one tap to the form rather than one tap
   * to a form you still have to fill from scratch. It is deliberately a
   * preselection, not a submission — audience and duration are still the
   * user's to confirm before anything becomes visible to anyone.
   */
  /**
   * Open the form to CREATE another UpFor.
   *
   * Always create, whatever already exists. Reaching for "Create" or a Quick
   * Idea while one UpFor is running now means the person wants a second one --
   * the canonical ceiling of three is what decides whether they may, and it
   * decides that on the server.
   */
  function openCreate(preset?: HangoutActivityType) {
    setEditingUpForId(null);
    setActivity(preset ?? null);
    setAudience("all_muddies");
    setMessage("");
    setBroadArea("");
    setDiscoveryScope("muddies");
    setDuration("1h");
    setWhen("now");
    setStartAtIso("");
    setSetupError("");
    setSetupOpen(true);
  }

  /** Open the form to EDIT one specific UpFor, named by id. */
  function openEdit(target: ActiveHangout) {
    setEditingUpForId(target.id);
    setActivity(target.activityType);
    setAudience(target.audienceType);
    setMessage(target.message ?? "");
    setBroadArea("");
    setDiscoveryScope("muddies");
    setDuration("1h");
    setWhen("now");
    setStartAtIso("");
    setSetupError("");
    setSetupOpen(true);
  }

  function openSetup(preset?: HangoutActivityType) {
    if (isActive && activeHangout) {
      setActivity(preset ?? activeHangout.activityType);
      setAudience(activeHangout.audienceType);
      setMessage(activeHangout.message ?? "");
      setBroadArea("");
      setDiscoveryScope("muddies");
      setDuration("1h");
    } else {
      setActivity(preset ?? null);
      setAudience("all_muddies");
      setMessage("");
      setBroadArea("");
      setDiscoveryScope("muddies");
      setDuration("1h");
    }
    setAttempted(false);
    setSetupError("");
    setSetupOpen(true);
  }

  /**
   * Join an UpFor.
   *
   * NOT inside startTransition. A transition is interruptible by design and
   * React really does abandon it -- which would kill the request mid-flight
   * and leave the card claiming a seat the server never recorded. Returns a
   * promise so the feed can hold its own per-card pending state until the
   * write actually settles.
   */
  async function requestToJoin(hangoutId: string) {
    const result = await requestHangoutAction(hangoutId).catch(() => ({
      ok: false,
      message: "Couldn't join. Check your connection and try again."
    }));
    showToast(result.message, !result.ok);
    if (result.ok) {
      setFeed((current) =>
        current.map((item) => (item.id === hangoutId ? { ...item, myRequestStatus: "pending" } : item))
      );
    }
  }

  const acceptedCount = requests.filter((request) => request.status === "accepted").length;

  /**
   * Withdraw: cancel a pending request, or leave after being accepted.
   *
   * Optimistic, then reconciled. The card returns to its join state
   * immediately and reverts if the server refuses, because a card that
   * silently keeps saying "Going" after a failed write looks identical to one
   * that worked.
   */
  async function leaveUpFor(hangoutId: string) {
    const previous = feed.find((item) => item.id === hangoutId)?.myRequestStatus ?? null;
    setFeed((current) =>
      current.map((item) =>
        item.id === hangoutId
          ? {
              ...item,
              myRequestStatus: "cancelled",
              // The seat is freed the moment the row is cancelled, so the
              // count drops here rather than waiting for a refresh.
              goingCount: previous === "accepted" ? Math.max(1, item.goingCount - 1) : item.goingCount
            }
          : item
      )
    );
    // Plain async for the same reason as join: an abandoned write here would
    // leave the optimistic revert below unreachable.
    {
      const result = await leaveHangoutAction(hangoutId).catch(() => ({
        ok: false,
        message: "Couldn't update that. Try again."
      }));
      if (result.ok) {
        showToast(result.message);
      } else {
        setFeed((current) =>
          current.map((item) =>
            item.id === hangoutId
              ? {
                  ...item,
                  myRequestStatus: previous,
                  goingCount: previous === "accepted" ? item.goingCount + 1 : item.goingCount
                }
              : item
          )
        );
        showToast(result.message, true);
      }
    }
  }

  /**
   * RSVP from the plans stack. The canonical action, unchanged — the card
   * decides only what to OFFER, and the server still authorises.
   */
  function joinPlan(plan: HomeUpcomingPlan) {
    if (isPending) return;
    startTransition(async () => {
      const result = await rsvpAction(plan.id, "going");
      showToast(result.message, !result.ok);
      if (result.ok) router.refresh();
    });
  }

  function submitSetup() {
    setAttempted(true);
    setSetupError("");
    if (!activity) return;
    if (when === "later" && !startAtIso) {
      setSetupError("Choose a time later today.");
      return;
    }

    const chosen = durationOptions.find((option) => option.id === duration) ?? durationOptions[1];
    /* `nowMs` rather than Date.now(): this runs in an event handler, but the
     * React Compiler analyses the whole function body and cannot tell, so a
     * direct clock read reads to it as an impure call during render. The
     * component already keeps a ticking `nowMs`, which is the same instant to
     * within a second and is what every other part of this screen measures
     * against. */
    const endsAt = new Date(nowMs + chosen.ms).toISOString();
    /* THE FIX. `editing` is now the explicit intent the caller set, not
       "does this person happen to have an UpFor". A create leaves every
       existing session untouched; an edit touches exactly the one it names.

       Editing still replaces the row, because no canonical update action
       exists and inventing a whole lifecycle for it is out of scope here --
       but it can now only ever replace the UpFor the owner actually chose. */
    const editing = editingUpForId !== null;
    const previousId = editingUpForId;

    startTransition(async () => {
      // No dedicated update action exists, so an edit ends the current session
      // and starts a fresh one with the new details.
      if (editing && previousId) {
        const ended = await endHangoutAction(previousId);
        if (!ended.ok) {
          setSetupError(ended.message);
          showToast(ended.message, true);
          return;
        }
      }

      const result = await startHangoutAction({
        activityType: activity,
        audienceType: audience,
        message: message.trim() || undefined,
        broadAreaText: broadArea.trim() || undefined,
        discoveryScope,
        endsAt,
        when,
        startsAt: when === "later" ? startAtIso : undefined,
        timezone: viewerTimeZone
      });

      if (result.ok && result.hangoutId) {
        setActiveHangout({
          id: result.hangoutId,
          activityType: activity,
          audienceType: audience,
          message: message.trim() || null,
          endsAt
        });
        if (!editing) setRequests([]);
        /* Clear the target on every exit. A stale id would make the NEXT
           create behave as an edit and cancel a sibling -- the exact bug. */
        setEditingUpForId(null);
        setSetupOpen(false);
        showToast(
          `Visible to ${audienceLabel[audience]} until ${formatTime(endsAt)}.`,
          false,
          editing ? "UpFor updated" : "You're UpFor"
        );
        router.refresh();
      } else {
        // If an edit ended the old session but the new one failed, the mode is
        // now genuinely off; reflect that rather than showing stale details.
        if (editing) setActiveHangout(null);
        setSetupError(result.message);
        showToast(result.message, true);
      }
    });
  }

  function turnOff() {
    if (!activeHangout) return;
    startTransition(async () => {
      const result = await endHangoutAction(activeHangout.id);
      if (result.ok) {
        setActiveHangout(null);
        setRequests([]);
        showToast("You're no longer visible to your Muddies.", false, "UpFor ended");
        router.refresh();
      } else {
        showToast(result.message, true);
      }
    });
  }

  function respond(requestId: string, response: "accepted" | "declined") {
    startTransition(async () => {
      const result = await respondHangoutRequestAction(requestId, response);
      showToast(result.message, !result.ok);
      // Re-derive the list from the database rather than trusting a local edit,
      // so the count stays canonical after accept/decline.
      if (result.ok) await refreshRequests();
    });
  }

  /**
   * Turn an UpFor into a canonical Plan.
   *
   * Takes an id so the feed's own "Looks like a plan" prompt can call it for
   * whichever card the creator is looking at, rather than only for the session
   * held in `activeHangout`. The action is unchanged and still routes through
   * convertHangoutToPlanAction -> create_plan_lifecycle; there is no second
   * Plan path.
   */
  async function convertToPlanById(hangoutId: string) {
    /* The fallback is shaped like the action's own result so the success branch
       can read conversationId. Deliberately NOT `import type` from
       hangout-actions: that module is "use server", where Turbopack turns every
       export into a server reference and a type import becomes a runtime
       ReferenceError tsc cannot catch. */
    const result = await convertHangoutToPlanAction(hangoutId).catch(() => ({
      ok: false,
      message: "Couldn't create the Plan yet. Try again.",
      conversationId: undefined as string | undefined
    }));
    showToast(result.message, !result.ok);
    if (result.ok) {
      if (activeHangout?.id === hangoutId) {
        setActiveHangout(null);
        setRequests([]);
      }
      /* STRAIGHT INTO THE PLAN CHAT.
       *
       * The conversion already created the Plan, its conversation and the
       * accepted participants' membership; the action now returns that
       * conversation id. Previously this only refreshed the UpFor list, leaving
       * the owner to go and find the chat they had just made.
       *
       * conversationHref is the one canonical spelling of the destination, so
       * this lands in the same conversation the participants' notifications
       * open. router.refresh() stays as the fallback for the unlikely case
       * where the lifecycle returned no conversation. */
      if (result.conversationId) {
        router.push(conversationHref(result.conversationId));
        return;
      }
      router.refresh();
    }
  }

  /** Back to wherever UpFor was opened from; Home only on a cold entry. */
  const [fromInsideApp] = useState(() => cameFromInsideApp());
  const goBack = useCallback(() => {
    const decision = resolveBack({ fromInsideApp, fallbackHref: "/dashboard" });
    if (decision.kind === "history") router.back();
    else router.push(decision.href as Route);
  }, [fromInsideApp, router]);

  function convertToPlan() {
    if (!activeHangout) return;
    void convertToPlanById(activeHangout.id);
  }

  const activityType = activeHangout?.activityType ?? "anything";
  const OrbIcon = isActive ? ACTIVITY_ICONS[activityType] ?? Hand : Hand;

  const remaining = isActive && activeHangout ? remainingLabel(activeHangout.endsAt, nowMs) : "";

  return (
    <div className="upfor-page">
      {/* ------------------------------------------------------------------
          HEADER. Title, subtitle, filter control and create — matching the
          approved design. The canonical PageHeader is not used here because
          this screen's header carries a subtitle and its own actions.
          ------------------------------------------------------------------ */}
      <header className={cn("upfor-header", scrolled && "upfor-header-scrolled")}>
        {/* History first: UpFor is reached from Home, from a notification and
            from Linkr, and only one of those wants /dashboard. A cold entry
            has nothing behind it and falls back to Home. */}
        <button type="button" onClick={goBack} aria-label="Back" className="upfor-back">
          <ArrowLeft className="h-6 w-6" aria-hidden="true" />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="upfor-title">UpFor</h1>
          <p className="upfor-subtitle">
            See what people are up for <span aria-hidden="true">⚡</span>
          </p>
        </div>

        <div className="upfor-header-actions">
          <button
            type="button"
            data-tour-id={TOUR_TARGET_IDS.HANGOUT_TOGGLE}
            onClick={() => openSetup()}
            disabled={isPending}
            aria-label={isActive ? "Edit your UpFor" : "Create an UpFor"}
            className="upfor-create-button"
          >
            <Plus className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* THE PROMISE. What makes an UpFor different from a plan: it expires. */}
      <section className="upfor-banner">
        <span className="upfor-banner-icon" aria-hidden="true">
          <Clock className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="upfor-banner-title">Live &amp; temporary</p>
          <p className="upfor-banner-copy">
UpFors are temporary and disappear when they end. Jump in while you can!
          </p>
        </div>
      </section>

      {/* --------------------------- YOUR UPFORS --------------------------
          Every UpFor the owner holds, live and scheduled. The projection in
          lib/social/owned-upfors.ts decides order and wording; this only hands
          it the collection and the page's single clock. */}
      <OwnedUpForsSection
        ownedUpFors={ownedUpFors}
        nowMs={nowMs}
        pendingRequestCounts={pendingRequestCounts}
        busy={isPending}
        onCreate={() => openCreate()}
        onManage={(id) => setManagingId(id)}
      />

      {/* --------------------------- YOUR OWN UPFOR ---------------------- */}
      {isActive && activeHangout ? (
        <section data-tour-id={TOUR_TARGET_IDS.HANGOUT_ACTIVE} className="upfor-mine">
          <div className="upfor-mine-head">
            <span className="upfor-mine-avatar">
              <UserAvatar src={avatarUrl} name={displayName || "You"} size="lg" decorative />
              <span className="upfor-mine-glyph" aria-hidden="true">
                <OrbIcon className="h-3.5 w-3.5" />
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="upfor-mine-label">You&rsquo;re up for</p>
              <p className="upfor-mine-activity">
                {HANGOUT_ACTIVITY_LABELS[activeHangout.activityType] ?? "Anything"}
              </p>
              {activeHangout.message ? (
                <p className="upfor-mine-message">&ldquo;{activeHangout.message}&rdquo;</p>
              ) : null}
            </div>
            <span className="upfor-mine-timer" suppressHydrationWarning>
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {remaining}
            </span>
          </div>

          <button type="button" onClick={() => openSetup()} className="upfor-mine-audience">
            <Users className="h-4 w-4" aria-hidden="true" />
            Visible to {visibleToLabel(activeHangout.audienceType, muddyCount)}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <div className="upfor-mine-actions">
            <Button type="button" variant="outline" className="flex-1" onClick={() => openSetup()} disabled={isPending}>
              Update
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1 border-primary/40 text-primary"
              onClick={turnOff}
              disabled={isPending}
            >
              End UpFor
            </Button>
          </div>

          {/* Requests to join. Unchanged behaviour — accept, maybe, decline,
              and the existing route into a group plan. */}
          <div className="upfor-requests">
            <p className="upfor-requests-title">Requests to join ({countActiveRequests(requests)})</p>
            {requests.length === 0 ? (
              <p className="upfor-requests-empty">No requests yet. We&apos;ll let you know.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {requests.map((request) => (
                  <li
                    key={request.id}
                    id={`hangout-${request.id}`}
                    className={cn(
                      "upfor-request",
                      requestedHangoutId === request.id && "ring-2 ring-primary/35"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {request.requesterName}
                      {request.message ? (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">: {request.message}</span>
                      ) : null}
                    </span>
                    {request.status === "pending" ? (
                      <span className="flex gap-1.5">
                        <Button type="button" size="sm" onClick={() => respond(request.id, "accepted")} disabled={isPending}>
                          Accept
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => respond(request.id, "declined")} disabled={isPending}>
                          Decline
                        </Button>
                      </span>
                    ) : (
                      <span className="text-xs font-medium capitalize text-muted-foreground">{request.status}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {acceptedCount > 0 ? (
              <Button type="button" variant="primary" className="mt-3 w-full" onClick={convertToPlan} disabled={isPending}>
                Create a group plan with {acceptedCount} {acceptedCount === 1 ? "person" : "people"}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ------------------------- THE UPFOR FEED -------------------------
          The approved "Live Social Pulse" feed. Four real discovery modes over
          one eligible list: every row already cleared canViewHangout on the
          server, so a tab narrows what the viewer is looking at rather than
          deciding what they may see.

          The 148-line inline list that used to live here is gone. It rendered a
          single "Happening Now Nearby" section with a filter sheet, which is
          not the approved structure, and every card rule it carried now lives
          in lib/social/upfor-feed.ts where it can be tested.
          ------------------------------------------------------------------ */}
      <section
        aria-labelledby="upfor-feed-heading"
        data-tour-id={TOUR_TARGET_IDS.HANGOUT_DISCOVERY}
        className="upfor-section"
      >
        <h2 id="upfor-feed-heading" className="sr-only">
          UpFors you can join
        </h2>
        <UpForFeed
          items={feed.map((item) => ({
            ...item,
            /* Every row in `feed` is a live, eligible session -- the server
             * drops expired and cancelled ones before projecting. Stated
             * explicitly so the card's momentum gate reads a real status
             * rather than inferring one. */
            status: "active",
            /* HangoutParticipant carries `displayName`; the card asks for
             * `name`. Mapped rather than widening the card's type, so the card
             * keeps a shape that any surface can satisfy. */
            participants: item.participants.map((person) => ({
              userId: person.userId,
              name: person.displayName,
              avatarUrl: person.avatarUrl
            }))
          }))}
          viewerId={viewerId ?? ""}
          nowMs={nowMs}
          loading={feedRefreshing}
          error={feedError}
          onRetry={() => void refreshFeed()}
          onJoin={requestToJoin}
          onWithdraw={leaveUpFor}
          onCreatePlan={convertToPlanById}
          onOpen={(id) => setDetailId(id)}
          onStart={() => openSetup()}
        />
      </section>

      {/* The "Create your UpFor" banner was removed: the + in the header and
          the Quick Ideas tiles below already open the same sheet, so it was a
          third route to one action taking a full band of the screen. */}
      {/* ---------------------------- QUICK IDEAS ------------------------ */}
      <section aria-labelledby="upfor-ideas-heading" className="upfor-section">
        <div className="upfor-ideas-head">
          <h2 id="upfor-ideas-heading" className="upfor-section-title">
            <span aria-hidden="true">⚡</span> Quick Ideas
          </h2>
          <p className="upfor-ideas-sub">Start an UpFor in one tap</p>
        </div>

        <ul className="upfor-ideas">
          {UPFOR_QUICK_IDEAS.map((idea) => (
            <li key={idea.id}>
              <button
                type="button"
                onClick={() => openSetup(idea.id)}
                disabled={isPending}
                className="upfor-idea"
                aria-label={`Start an UpFor for ${idea.label}`}
              >
                <span className="upfor-idea-emoji" aria-hidden="true">
                  {idea.emoji}
                </span>
                <span className="upfor-idea-label">{idea.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* WHERE AN UPFOR ENDS UP.
          The same stack Home and Linkr render, from the same projection. It
          belongs here because the two are one arc rather than two features:
          an UpFor is "I am free right now", and a Plan is what a good one
          becomes once people commit to a time. Seeing your plans beside your
          UpFors is what makes that progression visible instead of implied.

          "See all" points at /plans, which owns the full list — this is a
          preview, not a second plans page. */}
      {initialPlans.length > 0 ? (
        <section aria-labelledby="upfor-plans-heading" className="upfor-section">
          <PageSectionHeader
            id="upfor-plans-heading"
            title="Coming Up"
            href="/plans"
            actionAriaLabel="See all plans"
          />
          <PlanStack plans={initialPlans} onJoin={joinPlan} pending={isPending} nowMs={nowMs} />
        </section>
      ) : null}

      {/* The route to what this actually shares, kept from the old screen. */}
      <Link href="/safety-center" className="upfor-safety">
        <Lock className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        Your exact location is never shared. How this keeps you safe
      </Link>

      {/* The UpFor detail sheet. Reads from the same projection the card
          uses, so opening it costs no round trip. */}
      <UpForDetailSheet
        upFor={detailUpFor}
        viewerId={viewerId}
        nowMs={nowMs}
        pending={isPending}
        onJoin={(id) => requestToJoin(id)}
        onLeave={(id) => leaveUpFor(id)}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        onEnd={
          detailUpFor && viewerId && detailUpFor.ownerId === viewerId
            ? () => {
                setDetailId(null);
                turnOff();
              }
            : undefined
        }
        requestCount={countActiveRequests(requests)}
      />

      {/* The filter sheet. Rendered from the registry, so a future filter is a
          new entry there rather than an edit here. */}

      <Modal
        open={setupOpen}
        onOpenChange={setSetupOpen}
        title={isActive ? "Update your UpFor" : "What are you up for?"}
        description="Let your Muddies know what you're open to."
        variant="sheet"
        compact
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => { setEditingUpForId(null); setSetupOpen(false); }} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={submitSetup} disabled={isPending || (attempted && !activity)}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  {isActive ? "Saving…" : "Turning on…"}
                </>
              ) : isActive ? (
                "Save changes"
              ) : (
                "Start UpFor"
              )}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              What are you open to?
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {activityOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setActivity(option.id)}
                  aria-pressed={activity === option.id}
                  className={cn(
                    "focus-ring safe-motion rounded-full border px-3 py-1.5 text-sm font-medium",
                    activity === option.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {attempted && !activity ? (
              <p className="mt-1.5 text-xs text-red-500">Choose an activity to continue.</p>
            ) : null}
          </fieldset>

          {/* AREA. Free text the creator types, treated as context rather than
              geolocation: it never grants access and never narrows anything.
              Optional — an UpFor with no area is perfectly valid. */}
          <div>
            <label
              htmlFor="upfor-area"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Area <span className="font-normal normal-case">(optional)</span>
            </label>
            <input
              id="upfor-area"
              type="text"
              value={broadArea}
              onChange={(event) => setBroadArea(event.target.value)}
              maxLength={80}
              placeholder="Osu, East Legon, Campus…"
              className="focus-ring w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              A neighbourhood or landmark. Your exact location is never shared.
            </p>
          </div>

          {/* WHO CAN SEE THIS. A deliberate choice, defaulting to Muddies. */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Who can see this?
            </legend>
            <div className="flex flex-col gap-1.5">
              {[
                {
                  id: "muddies" as const,
                  label: "Muddies only",
                  hint: "Only people you are connected to."
                },
                {
                  id: "nearby" as const,
                  label: "Nearby people",
                  hint: "People nearby can discover this and ask to join."
                }
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setDiscoveryScope(option.id);
                    // Widening past Muddies resets the narrowing beneath it.
                    // Leaving "Close Friends" set would hide the UpFor from
                    // most Muddies while showing it to strangers — and the
                    // control that did so is no longer on screen to explain
                    // it.
                    if (option.id === "nearby") setAudience("all_muddies");
                  }}
                  aria-pressed={discoveryScope === option.id}
                  className={cn(
                    "focus-ring safe-motion rounded-xl border px-3 py-2 text-left",
                    discoveryScope === option.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-secondary/50"
                  )}
                >
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint}</span>
                </button>
              ))}
            </div>
            {/* Stated up front rather than after a silent failure: if we
                cannot place the creator, nearby discovery cannot be enabled,
                and the server falls back to Muddies rather than publishing a
                session nobody can be matched against. */}
            {discoveryScope === "nearby" ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Needs a recent location. If we can&rsquo;t tell where you are, this stays visible to
                your Muddies only.
              </p>
            ) : null}
          </fieldset>

          {/* WHICH Muddies — a sub-question of "Muddies only", not a peer of
              it. Shown only under that branch, because "Close Friends" has no
              meaning once nearby strangers are included: the form would be
              claiming two incompatible audiences at once. Choosing Nearby
              still keeps every Muddy in scope, which is why the branch below
              says so rather than leaving it implied. */}
          {discoveryScope === "muddies" ? (
            <fieldset className="upfor-audience-nested">
              <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Which Muddies
              </legend>
              <div className="flex gap-1.5">
                {audienceOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setAudience(option.id)}
                    aria-pressed={audience === option.id}
                    className={cn(
                      "focus-ring safe-motion flex-1 rounded-full border px-2 py-1.5 text-sm font-medium",
                      audience === option.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-secondary"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className="upfor-audience-note">
              Your Muddies can see this too, plus people nearby.
            </p>
          )}

          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              When?
            </legend>
            <div className="flex gap-1.5">
              {(["now", "later"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setWhen(option);
                    /* Preselect the first still-valid slot, so choosing
                       "Later today" is one tap rather than two. */
                    if (option === "later" && !startAtIso) setStartAtIso(timeSlots[0]?.iso ?? "");
                    if (option === "now") setStartAtIso("");
                    setSetupError("");
                  }}
                  aria-pressed={when === option}
                  className={cn(
                    "focus-ring safe-motion min-h-11 flex-1 rounded-full border px-2 py-1.5 text-sm font-medium",
                    when === option
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {option === "now" ? "Now" : "Later today"}
                </button>
              ))}
            </div>
          </fieldset>

          {when === "later" ? (
            <div>
              <label
                htmlFor="upfor-start-time"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Time
              </label>
              {timeSlots.length === 0 ? (
                /* Late enough that nothing is left today. Said plainly rather
                   than offering a time the server would refuse. */
                <p className="text-sm text-muted-foreground">
                  There is no time left today. Choose Now instead.
                </p>
              ) : (
                <select
                  id="upfor-start-time"
                  value={startAtIso}
                  onChange={(event) => {
                    setStartAtIso(event.target.value);
                    setSetupError("");
                  }}
                  className="focus-ring min-h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm"
                >
                  {timeSlots.map((slot) => (
                    <option key={slot.iso} value={slot.iso}>
                      {slot.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : null}

          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Duration
            </legend>
            <div className="flex gap-1.5">
              {durationOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setDuration(option.id)}
                  aria-pressed={duration === option.id}
                  className={cn(
                    "focus-ring safe-motion flex-1 rounded-full border px-2 py-1.5 text-sm font-medium",
                    duration === option.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="hangout-note" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Note (optional)
            </label>
            <input
              id="hangout-note"
              type="text"
              value={message}
              maxLength={140}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Free after 4, anyone around?"
              className="focus-ring safe-motion h-11 w-full rounded-md border border-border bg-card/70 px-3 text-sm"
            />
          </div>

          {setupError ? (
            <p className="flex items-start gap-1.5 text-xs text-red-500" role="alert">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {setupError}
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              {/* REPLACED: a privacy assurance about location, so a shield is
                  the literal concept. A sparkle beside "your exact location
                  stays private" decorated a promise rather than signalling it. */}
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              Only your availability is shared. Your exact location stays private.
            </p>
          )}
        </div>
      </Modal>

      {toast ? (
        <div
          className="toast-in fixed bottom-[calc(96px+env(safe-area-inset-bottom))] left-1/2 z-50 w-[calc(100%-2rem)] max-w-[320px] -translate-x-1/2 md:bottom-6"
          role="status"
          aria-live="polite"
          onMouseEnter={() => {
            if (dismissTimer.current) clearTimeout(dismissTimer.current);
          }}
          onMouseLeave={scheduleToastDismiss}
        >
          <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-[#1b1b1d] px-4 py-3 text-white shadow-lg">
            {toast.error ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              {toast.title ? <p className="text-sm font-semibold">{toast.title}</p> : null}
              <p className="text-xs text-white/70">{toast.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="focus-ring -mr-1 shrink-0 rounded text-white/50 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
