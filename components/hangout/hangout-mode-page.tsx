"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties } from "react";
import {
  convertHangoutToPlanAction,
  endHangoutAction,
  requestHangoutAction,
  respondHangoutRequestAction,
  startHangoutAction,
  type VisibleHangout
} from "@/app/(app)/hangout-actions";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
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
  const [activity, setActivity] = useState<HangoutActivityType>(
    initialActiveHangout?.activityType ?? "anything"
  );
  const [audience, setAudience] = useState<HangoutAudienceType>(
    initialActiveHangout?.audienceType ?? "all_muddies"
  );
  const [duration, setDuration] = useState<Duration>("1h");
  const [message, setMessage] = useState(initialActiveHangout?.message ?? "");
  const [feed, setFeed] = useState(initialFeed);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const active = activeHangout !== null;

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

  function turnOn() {
    const chosen = durationOptions.find((option) => option.id === duration) ?? durationOptions[1];
    const endsAt = new Date(Date.now() + chosen.ms).toISOString();
    startTransition(async () => {
      const result = await startHangoutAction({
        activityType: activity,
        audienceType: audience,
        message: message.trim() || undefined,
        endsAt
      });
      setFeedback(result.message);
      if (result.ok && result.hangoutId) {
        setActiveHangout({
          id: result.hangoutId,
          activityType: activity,
          audienceType: audience,
          message: message.trim() || null,
          endsAt
        });
        setRequests([]);
        router.refresh();
      }
    });
  }

  function turnOff() {
    if (!activeHangout) return;
    startTransition(async () => {
      const result = await endHangoutAction(activeHangout.id);
      setFeedback(result.message);
      if (result.ok) {
        setActiveHangout(null);
        setRequests([]);
        router.refresh();
      }
    });
  }

  function respond(requestId: string, response: "accepted" | "maybe" | "declined") {
    startTransition(async () => {
      const result = await respondHangoutRequestAction(requestId, response);
      setFeedback(result.message);
      if (result.ok) {
        setRequests((current) =>
          current.map((request) =>
            request.id === requestId ? { ...request, status: response } : request
          )
        );
      }
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

  return (
    <div className="mx-auto max-w-[720px] space-y-6 pt-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Hangout Mode</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Let approved Muddies know you&apos;re open to do something. Your exact location is never shared.
        </p>
      </div>

      <div className="relative mx-auto grid h-72 w-72 max-w-full place-items-center overflow-hidden">
        <div
          className={cn(
            "relative isolate grid h-40 w-40 place-items-center rounded-full text-4xl transition-all",
            active
              ? cn("proximity-halo proximity-halo-very-close bg-primary/10", !reducedMotion && "proximity-halo-animate")
              : "border border-dashed border-border text-muted-foreground"
          )}
          style={active ? ({ "--halo-active-opacity": 0.9, "--halo-rest-opacity": 0.5 } as CSSProperties) : undefined}
        >
          😎
        </div>
      </div>

      {feedback ? <p className="text-center text-sm text-muted-foreground" role="status">{feedback}</p> : null}

      {active && activeHangout ? (
        <div className="space-y-4 rounded-2xl border border-primary/40 bg-primary/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-primary">
                You&apos;re open to {HANGOUT_ACTIVITY_LABELS[activeHangout.activityType]?.toLowerCase() ?? "hang out"}
              </p>
              <p className="text-xs text-muted-foreground">
                Until {new Date(activeHangout.endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </p>
            </div>
            <Button type="button" variant="danger" size="sm" onClick={turnOff} disabled={isPending}>
              End
            </Button>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold">Requests to join ({requests.length})</p>
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
          </div>

          {acceptedCount > 0 ? (
            <Button type="button" variant="primary" className="w-full" onClick={convertToPlan} disabled={isPending}>
              Create a group plan with {acceptedCount} {acceptedCount === 1 ? "person" : "people"}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4 rounded-2xl border border-border/70 bg-card/50 p-4">
          <div>
            <p className="mb-1.5 text-sm font-medium">What are you up to?</p>
            <select
              value={activity}
              onChange={(event) => setActivity(event.target.value as HangoutActivityType)}
              className="focus-ring safe-motion h-11 w-full rounded-md border border-border bg-card/70 px-3 text-sm"
            >
              {activityOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium">Add a note (optional)</p>
            <input
              type="text"
              value={message}
              maxLength={140}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Free until 4, come through"
              className="focus-ring safe-motion h-11 w-full rounded-md border border-border bg-card/70 px-3 text-sm"
            />
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium">Who can see this?</p>
            <div className="flex flex-wrap gap-2">
              {audienceOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setAudience(option.id)}
                  className={cn(
                    "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
                    audience === option.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium">For how long?</p>
            <div className="flex flex-wrap gap-2">
              {durationOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setDuration(option.id)}
                  className={cn(
                    "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
                    duration === option.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <Button type="button" variant="primary" className="w-full" onClick={turnOn} disabled={isPending}>
            Turn on Hangout Mode
          </Button>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-base font-semibold">Muddies open to hang out</h2>
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
                    Until {new Date(hangout.endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
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
      </div>
    </div>
  );
}
