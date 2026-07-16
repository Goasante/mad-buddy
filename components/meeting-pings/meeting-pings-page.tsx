"use client";

import { CalendarCheck2, Hand, MessageCircle } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { respondToMeetupRequestAction } from "@/app/(app)/premium-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { connectionResponsesFor } from "@/lib/meetups/connection-prompts";
import { formatRelativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

type PingTab = "received" | "sent" | "responded";

type ReceivedPing = {
  id: string;
  requestId: string;
  title: string;
  message: string;
  time: string;
};

type ApiNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

const pingTabs: Array<{ id: PingTab; label: string }> = [
  { id: "received", label: "Received" },
  { id: "sent", label: "Sent" },
  { id: "responded", label: "Responded" }
];

const howItWorks = [
  { step: "1", title: "Send a ping", description: "Choose time & place." },
  { step: "2", title: "They respond", description: "Accept or suggest." },
  { step: "3", title: "Plan it", description: "Turn it into a plan." }
];

export function MeetingPingsPage() {
  const [tab, setTab] = useState<PingTab>("received");
  const [pings, setPings] = useState<ReceivedPing[]>([]);
  const [respondingTo, setRespondingTo] = useState<ReceivedPing | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let isMounted = true;

    async function loadPings() {
      try {
        const response = await fetch("/api/notifications", { credentials: "include", cache: "no-store" });
        if (!response.ok || !isMounted) return;
        const data = (await response.json()) as { notifications: ApiNotification[] };
        setPings(
          data.notifications
            .filter((notification) => notification.type.startsWith("meetup_request:"))
            .map((notification) => ({
              id: notification.id,
              requestId: notification.type.slice("meetup_request:".length),
              title: notification.title,
              message: notification.message,
              time: formatRelativeTime(notification.created_at)
            }))
        );
      } catch {
        // Keep the list empty if the request fails.
      }
    }

    void loadPings();
    return () => {
      isMounted = false;
    };
  }, []);

  function respond(ping: ReceivedPing, message: string) {
    startTransition(async () => {
      const result = await respondToMeetupRequestAction({ requestId: ping.requestId, message });
      setFeedback(result.ok ? "Reply sent" : "Couldn’t send your reply. Try again.");
      if (result.ok) {
        setPings((current) => current.filter((item) => item.id !== ping.id));
        setRespondingTo(null);
      }
    });
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-6 pt-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Meeting Pings</h1>
        <p className="mt-2 text-sm text-muted-foreground">Request to meet up easily and at the right time.</p>
      </div>

      <div className="flex gap-1 border-b border-border/70">
        {pingTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium",
              tab === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
            {item.id === "received" && pings.length > 0 ? (
              <Badge variant="orange" className="ml-1.5">{pings.length}</Badge>
            ) : null}
          </button>
        ))}
      </div>

      {feedback ? <p className="text-sm text-muted-foreground" role="status">{feedback}</p> : null}

      {tab === "received" ? (
        pings.length > 0 ? (
          <div className="space-y-3">
            {pings.map((ping) => (
              <div key={ping.id} className="rounded-xl border border-border/70 bg-card/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{ping.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">&ldquo;{ping.message}&rdquo;</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{ping.time}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  {respondingTo?.id === ping.id ? null : (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        disabled={isPending}
                        onClick={() => setRespondingTo(ping)}
                      >
                        Accept
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => setPings((current) => current.filter((item) => item.id !== ping.id))}
                      >
                        Decline
                      </Button>
                    </>
                  )}
                </div>
                {respondingTo?.id === ping.id ? (
                  <div className="mt-3 grid gap-2 border-t border-border/70 pt-3 sm:grid-cols-2">
                    {connectionResponsesFor(ping.message).quickReplies.map((reply) => (
                      <Button
                        key={reply}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="justify-start"
                        disabled={isPending}
                        onClick={() => respond(ping, reply)}
                      >
                        {reply}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Hand} className="!shadow-none" title="No meeting pings" description="Pings you receive will show up here." />
        )
      ) : null}

      {tab === "sent" ? (
        <EmptyState icon={MessageCircle} className="!shadow-none" title="No pings sent" description="Pings you send from a Muddy's profile will appear here." />
      ) : null}

      {tab === "responded" ? (
        <EmptyState icon={CalendarCheck2} className="!shadow-none" title="No responded pings yet" description="Pings you've replied to will show up here." />
      ) : null}

      <div className="rounded-xl border border-border/70 bg-card/50 p-4">
        <p className="mb-3 text-sm font-semibold">How it works</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {howItWorks.map((step) => (
            <div key={step.step} className="flex items-start gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {step.step}
              </span>
              <div>
                <p className="text-sm font-medium">{step.title}</p>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
