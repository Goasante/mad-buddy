"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Coffee,
  Dumbbell,
  Footprints,
  Gamepad2,
  Hand,
  Loader2,
  Sparkles,
  Trophy,
  UtensilsCrossed,
  X
} from "lucide-react";
import {
  convertHangoutToPlanAction,
  endHangoutAction,
  getOwnerHangoutRequestsAction,
  requestHangoutAction,
  respondHangoutRequestAction,
  startHangoutAction,
  type VisibleHangout
} from "@/app/(app)/hangout-actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
import { countActiveRequests } from "@/lib/social/hangout-requests";
import { HANGOUT_ACTIVITY_LABELS } from "@/lib/social/plans";
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
  anything: Sparkles,
  food: UtensilsCrossed,
  study: BookOpen,
  sports: Trophy,
  gym: Dumbbell,
  walk: Footprints,
  gaming: Gamepad2,
  chill: Coffee
};

const audienceLabel: Record<HangoutAudienceType, string> = {
  all_muddies: "all your Muddies",
  close_friends: "your Close Friends",
  selected_circles: "selected circles",
  selected_muddies: "selected Muddies"
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

type Toast = { title?: string; message: string; error: boolean } | null;

export function HangoutModePage({
  initialActiveHangout = null,
  initialRequests = [],
  initialFeed = []
}: {
  initialActiveHangout?: ActiveHangout | null;
  initialRequests?: HangoutRequestSummary[];
  initialFeed?: VisibleHangout[];
}) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  const [activeHangout, setActiveHangout] = useState(initialActiveHangout);
  const [requests, setRequests] = useState(initialRequests);
  const [feed, setFeed] = useState(initialFeed);

  // Setup form draft state (only meaningful while the sheet is open).
  const [setupOpen, setSetupOpen] = useState(false);
  const [activity, setActivity] = useState<HangoutActivityType | null>(null);
  const [audience, setAudience] = useState<HangoutAudienceType>("all_muddies");
  const [duration, setDuration] = useState<Duration>("1h");
  const [message, setMessage] = useState("");
  const [attempted, setAttempted] = useState(false);

  const [feedback, setFeedback] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isPending, startTransition] = useTransition();

  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive activation straight from the source of truth so an expired session
  // flips the orb back to inactive without a manual refresh.
  const isActive = activeHangout !== null && Date.parse(activeHangout.endsAt) > nowMs;

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Canonical refetch of the owner's join requests — the database is the source
  // of truth, never client-side arithmetic. Adopts the server list only for the
  // current active Hangout, so requests from an unrelated session never leak in.
  const activeHangoutId = activeHangout?.id ?? null;
  const refreshRequests = useCallback(async () => {
    try {
      const state = await getOwnerHangoutRequestsAction();
      if (state.hangoutId && state.hangoutId === activeHangoutId) {
        setRequests(state.requests);
      } else if (!state.hangoutId) {
        setRequests([]);
      }
    } catch {
      // A failed refetch simply leaves the last known canonical state in place.
    }
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
    const interval = setInterval(() => void refreshRequests(), 15_000);
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

  const scheduleToastDismiss = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const showToast = useCallback(
    (message: string, error = false, title?: string) => {
      setToast({ message, error, title });
      scheduleToastDismiss();
    },
    [scheduleToastDismiss]
  );

  function openSetup() {
    if (isActive && activeHangout) {
      setActivity(activeHangout.activityType);
      setAudience(activeHangout.audienceType);
      setMessage(activeHangout.message ?? "");
      setDuration("1h");
    } else {
      setActivity(null);
      setAudience("all_muddies");
      setMessage("");
      setDuration("1h");
    }
    setAttempted(false);
    setSetupOpen(true);
  }

  function requestToJoin(hangoutId: string) {
    startTransition(async () => {
      const result = await requestHangoutAction(hangoutId);
      setFeedback(result.message);
      if (result.ok) {
        setFeed((current) =>
          current.map((item) => (item.id === hangoutId ? { ...item, myRequestStatus: "pending" } : item))
        );
      }
    });
  }

  const acceptedCount = requests.filter((request) => request.status === "accepted").length;

  function submitSetup() {
    setAttempted(true);
    if (!activity) return;

    const chosen = durationOptions.find((option) => option.id === duration) ?? durationOptions[1];
    const endsAt = new Date(Date.now() + chosen.ms).toISOString();
    const editing = isActive && activeHangout !== null;
    const previousId = activeHangout?.id;

    startTransition(async () => {
      // No dedicated update action exists, so an edit ends the current session
      // and starts a fresh one with the new details.
      if (editing && previousId) {
        const ended = await endHangoutAction(previousId);
        if (!ended.ok) {
          showToast(ended.message, true);
          return;
        }
      }

      const result = await startHangoutAction({
        activityType: activity,
        audienceType: audience,
        message: message.trim() || undefined,
        endsAt
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
        setSetupOpen(false);
        showToast(
          `Visible to ${audienceLabel[audience]} until ${formatTime(endsAt)}.`,
          false,
          editing ? "Hangout Mode updated" : "Hangout Mode is on"
        );
        router.refresh();
      } else {
        // If an edit ended the old session but the new one failed, the mode is
        // now genuinely off; reflect that rather than showing stale details.
        if (editing) setActiveHangout(null);
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
        showToast("You're no longer visible to your Muddies.", false, "Hangout Mode is off");
        router.refresh();
      } else {
        showToast(result.message, true);
      }
    });
  }

  function respond(requestId: string, response: "accepted" | "maybe" | "declined") {
    startTransition(async () => {
      const result = await respondHangoutRequestAction(requestId, response);
      setFeedback(result.message);
      // Re-derive the list from the database rather than trusting a local edit,
      // so the count stays canonical after accept/maybe/decline.
      if (result.ok) await refreshRequests();
    });
  }

  function convertToPlan() {
    if (!activeHangout) return;
    startTransition(async () => {
      const result = await convertHangoutToPlanAction(activeHangout.id);
      setFeedback(result.message);
      if (result.ok) {
        setActiveHangout(null);
        setRequests([]);
        router.refresh();
      }
    });
  }

  const activityType = activeHangout?.activityType ?? "anything";
  const OrbIcon = isActive ? ACTIVITY_ICONS[activityType] ?? Hand : Hand;
  const activatingGlow = isActive && !reducedMotion;

  return (
    <div className="mx-auto max-w-[1000px] space-y-8 pt-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Hangout Mode</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Let approved Muddies know you&apos;re open to do something. Your exact location is never shared.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-start">
        {/* Orb + state summary */}
        <section className="space-y-5">
          <div className="grid place-items-center px-6 py-4">
            <button
              type="button"
              onClick={openSetup}
              disabled={isPending}
              aria-label={isActive ? "Edit your Hangout Mode details" : "Set up Hangout Mode"}
              className={cn(
                "focus-ring relative isolate grid h-40 w-40 place-items-center rounded-full transition-all",
                isActive
                  ? cn(
                      "proximity-halo proximity-halo-nearby bg-primary/10 text-primary",
                      activatingGlow && "proximity-halo-animate"
                    )
                  : "border border-dashed border-primary/30 bg-card/40 text-muted-foreground hover:border-primary/50 hover:text-primary"
              )}
              style={
                isActive
                  ? ({ "--halo-active-opacity": 0.7, "--halo-rest-opacity": 0.4 } as CSSProperties)
                  : undefined
              }
            >
              {isPending ? (
                <Loader2 className="h-12 w-12 animate-spin" aria-hidden="true" />
              ) : (
                <OrbIcon className="h-12 w-12" aria-hidden="true" />
              )}
            </button>
          </div>

          {isActive && activeHangout ? (
            <div className="space-y-4 rounded-2xl border border-primary/40 bg-primary/5 p-5">
              <div className="space-y-1 text-center">
                <p className="text-base font-semibold text-primary">You&apos;re open to hang out</p>
                <p className="text-sm text-muted-foreground">
                  Visible to {audienceLabel[activeHangout.audienceType]} until {formatTime(activeHangout.endsAt)}
                </p>
                <p className="text-sm text-foreground">
                  Open to{" "}
                  <span className="font-medium">
                    {HANGOUT_ACTIVITY_LABELS[activeHangout.activityType]?.toLowerCase() ?? "anything"}
                  </span>
                </p>
                {activeHangout.message ? (
                  <p className="text-sm text-muted-foreground">&ldquo;{activeHangout.message}&rdquo;</p>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={openSetup} disabled={isPending}>
                  Update
                </Button>
                <Button type="button" variant="danger" className="flex-1" onClick={turnOff} disabled={isPending}>
                  Turn off
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-2xl border border-border/70 bg-card/50 p-5 text-center">
              <p className="text-base font-semibold">Hangout Mode is off</p>
              <p className="text-sm text-muted-foreground">
                Turn it on to let your Muddies know you&apos;re around and up for something.
              </p>
              <Button type="button" variant="primary" className="w-full" onClick={openSetup} disabled={isPending}>
                Turn on Hangout Mode
              </Button>
            </div>
          )}

          {isActive && activeHangout ? (
            <div className="rounded-2xl border border-border/70 bg-card/50 p-4">
              <p className="mb-2 text-sm font-semibold">Requests to join ({countActiveRequests(requests)})</p>
              {requests.length === 0 ? (
                <p className="text-xs text-muted-foreground">No requests yet. We&apos;ll let you know.</p>
              ) : (
                <ul className="space-y-2">
                  {requests.map((request) => (
                    <li
                      key={request.id}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card/60 p-3"
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
                          <Button type="button" size="sm" variant="outline" onClick={() => respond(request.id, "maybe")} disabled={isPending}>
                            Maybe
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
          ) : null}

          {feedback ? (
            <p className="text-center text-sm text-muted-foreground" role="status">
              {feedback}
            </p>
          ) : null}
        </section>

        {/* Muddies available now */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Muddies available now</h2>
          {feed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody&apos;s open right now. When a Muddy turns on Hangout Mode, they&apos;ll show up here.
            </p>
          ) : (
            <ul className="space-y-2">
              {feed.map((hangout) => (
                <li
                  key={hangout.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {hangout.ownerName} is open to{" "}
                      {HANGOUT_ACTIVITY_LABELS[hangout.activityType]?.toLowerCase() ?? "hang out"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {hangout.message ? `“${hangout.message}” · ` : ""}
                      {hangout.broadAreaText ? `${hangout.broadAreaText} · ` : ""}
                      Until {formatTime(hangout.endsAt)}
                    </p>
                  </div>
                  {hangout.myRequestStatus ? (
                    <span className="text-xs font-medium capitalize text-muted-foreground">
                      {hangout.myRequestStatus === "pending" ? "Requested" : hangout.myRequestStatus}
                    </span>
                  ) : (
                    <Button type="button" size="sm" disabled={isPending} onClick={() => requestToJoin(hangout.id)}>
                      I&apos;m interested
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Modal
        open={setupOpen}
        onOpenChange={setSetupOpen}
        title={isActive ? "Update Hangout Mode" : "Turn on Hangout Mode"}
        description="Let your Muddies know what you're open to."
      >
        <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">What are you open to?</legend>
            <div className="flex flex-wrap gap-2">
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
              <p className="mt-2 text-xs text-red-500">Choose an activity to continue.</p>
            ) : null}
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Visible to</legend>
            <div className="flex flex-wrap gap-2">
              {audienceOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setAudience(option.id)}
                  aria-pressed={audience === option.id}
                  className={cn(
                    "focus-ring safe-motion rounded-full border px-3 py-1.5 text-sm font-medium",
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

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Duration</legend>
            <div className="flex flex-wrap gap-2">
              {durationOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setDuration(option.id)}
                  aria-pressed={duration === option.id}
                  className={cn(
                    "focus-ring safe-motion rounded-full border px-3 py-1.5 text-sm font-medium",
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
            <label htmlFor="hangout-note" className="mb-1.5 block text-sm font-medium">
              Add a note (optional)
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

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            Only your availability is shared. Your exact location stays private.
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setSetupOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={submitSetup} disabled={isPending || (attempted && !activity)}>
            {isPending ? "Saving..." : isActive ? "Save changes" : "Turn on Hangout Mode"}
          </Button>
        </div>
      </Modal>

      {toast ? (
        <div
          className="toast-in fixed bottom-[calc(88px+env(safe-area-inset-bottom))] left-1/2 z-50 w-[calc(100%-2rem)] max-w-[320px] -translate-x-1/2 md:bottom-6"
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
