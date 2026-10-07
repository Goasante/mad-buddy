"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Link } from "@/lib/platform";
import { conversationHref } from "@/lib/messaging/open-conversation";
import type { MeetupDiscoveryHub } from "@/lib/meetups/discovery";
import { listingsAwaitingReview, pendingReviewCount, requestStatusMessage } from "@/lib/meetups/discovery-review";
import type { MeetupDiscoveryAction } from "./meet-new-people";

export function DiscoveryRequests({ hub, nowMs, action, onRefresh }: {
  hub: MeetupDiscoveryHub; nowMs: number;
  action: MeetupDiscoveryAction; onRefresh: () => Promise<void>;
}) {
  const review = listingsAwaitingReview(hub, nowMs);
  const requests = hub.requests ?? [];
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);

  function run(input: unknown) {
    if (inFlight.current) return;
    inFlight.current = true;
    startTransition(async () => {
      try {
        const result = await action(input, false);
        setMessage(result.message);
        if (result.ok) {
          try { await onRefresh(); }
          catch { setMessage(`${result.message} Reopen Meetups to see the latest.`); }
        }
      } catch { setMessage("Could not update this request. Try again."); }
      finally { inFlight.current = false; }
    });
  }

  if (!review.length && !requests.length) return null;
  return (
    <div className="space-y-6">
      {message ? <p role="status" className="rounded-xl bg-secondary p-3 text-sm">{message}</p> : null}
      {review.length ? (
        <section aria-labelledby="discovery-review-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 id="discovery-review-heading" className="text-sm font-bold">Awaiting your review</h2>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{pendingReviewCount(hub, nowMs)} requests</span>
          </div>
          {review.map((item) => (
            <article key={item.id} className="rounded-2xl border border-border bg-card p-4">
              <h3 className="break-words font-semibold">{item.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{new Intl.DateTimeFormat("en", { timeZone: item.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(item.startsAt))}</p>
              <p className="mt-2 text-xs text-muted-foreground">{Date.parse(item.listingExpiresAt) <= nowMs ? "Posting window closed. You can review existing requests until the meetup starts." : "People interested in your listing."}</p>
              <div className="mt-3 space-y-2">
                {item.interestedPeople.filter((person) => person.status === "pending").map((person) => (
                  <div key={person.userId} className="flex flex-wrap items-center gap-2 rounded-xl bg-secondary/50 p-2.5">
                    <Link href={`/friends/${person.username}` as ReturnType<typeof conversationHref>} className="focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-lg">
                      <UserAvatar src={person.avatarUrl} name={person.name} size="xs" decorative />
                      <span className="truncate text-sm font-medium">{person.name}</span>
                    </Link>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => run({ action: "decide", id: item.id, userId: person.userId, response: "declined" })} aria-label={`Pass on ${person.name}'s request`}>Pass</Button>
                    <Button size="sm" disabled={pending || item.interestedPeople.filter((member) => member.status === "accepted").length >= item.maxAttendees - 1} onClick={() => run({ action: "decide", id: item.id, userId: person.userId, response: "accepted" })} aria-label={`Accept ${person.name}'s request`}>Accept</Button>
                  </div>
                ))}
              </div>
              {item.interestedPeople.filter((person) => person.status === "accepted").length >= item.maxAttendees - 1 ? <p className="mt-2 text-xs text-muted-foreground">This meetup is full. You can still pass on remaining requests.</p> : null}
            </article>
          ))}
        </section>
      ) : null}
      {requests.length ? (
        <section aria-labelledby="discovery-your-requests-heading" className="space-y-3">
          <h2 id="discovery-your-requests-heading" className="px-1 text-sm font-bold">Your requests</h2>
          {requests.map((item) => (
            <article key={item.id} className="rounded-2xl border border-border bg-card p-4">
              <h3 className="break-words font-semibold">{item.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{requestStatusMessage(item, nowMs)}</p>
              {item.myInterestStatus === "pending" && item.status !== "cancelled" && Date.parse(item.startsAt) > nowMs ? (
                <Button className="mt-3" size="sm" variant="outline" disabled={pending} onClick={() => run({ action: "withdraw", id: item.id })}>Withdraw interest</Button>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
