"use client";

import { CalendarCheck2, HelpCircle, MessageCircle, Plus, Search, Send } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useMemo, useState, useTransition } from "react";
import { createMeetupRequestAction, dismissMeetupRequestAction, respondToMeetupRequestAction, type MeetingPingListItem } from "@/app/(app)/premium-actions";
import { getMessageableFriendsAction, type MessageableFriend } from "@/app/(app)/messaging-actions";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { connectionResponsesFor } from "@/lib/meetups/connection-prompts";
import { formatRelativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

type PingTab = "received" | "sent" | "history";

type ReceivedPing = MeetingPingListItem;

const pingTabs: Array<{ id: PingTab; label: string }> = [
  { id: "received", label: "Received" },
  { id: "sent", label: "Sent" },
  { id: "history", label: "History" }
];

const howItWorks = [
  { step: "1", title: "Send a ping", description: "Choose time & place." },
  { step: "2", title: "They respond", description: "Accept or suggest." },
  { step: "3", title: "Plan it", description: "Turn it into a plan." }
];

export function MeetingPingsPage({ initialPings }: { initialPings: MeetingPingListItem[] }) {
  const [tab, setTab] = useState<PingTab>("received");
  const [pings, setPings] = useState<ReceivedPing[]>(initialPings);
  const [respondingTo, setRespondingTo] = useState<ReceivedPing | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const [helpOpen, setHelpOpen] = useState(false);
  const [newPingOpen, setNewPingOpen] = useState(false);
  const [friends, setFriends] = useState<MessageableFriend[]>([]);
  const [friendsLoaded, setFriendsLoaded] = useState(false);
  const [friendQuery, setFriendQuery] = useState("");
  const [selectedFriend, setSelectedFriend] = useState<MessageableFriend | null>(null);
  const [pingMessage, setPingMessage] = useState("");
  const [isSendingPing, startSendPing] = useTransition();
  const [sendPingError, setSendPingError] = useState("");

  function respond(ping: ReceivedPing, message: string) {
    startTransition(async () => {
      const result = await respondToMeetupRequestAction({ requestId: ping.id, message });
      setFeedback(result.ok ? "Reply sent" : "Couldn’t send your reply. Try again.");
      if (result.ok) {
        setPings((current) => current.filter((item) => item.id !== ping.id));
        setRespondingTo(null);
      }
    });
  }

  function dismiss(ping: ReceivedPing) {
    startTransition(async () => {
      const result = await dismissMeetupRequestAction(ping.id);
      setFeedback(result.message);
      if (result.ok) setPings((current) => current.map((item) => item.id === ping.id ? { ...item, status: "declined" } : item));
    });
  }

  function openNewPing() {
    setNewPingOpen(true);
    setSelectedFriend(null);
    setPingMessage("");
    setSendPingError("");
    if (!friendsLoaded) {
      void getMessageableFriendsAction().then((result) => {
        setFriends(result);
        setFriendsLoaded(true);
      });
    }
  }

  const filteredFriends = useMemo(() => {
    const query = friendQuery.trim().toLowerCase();
    if (!query) return friends;
    return friends.filter(
      (friend) => friend.displayName.toLowerCase().includes(query) || friend.username.toLowerCase().includes(query)
    );
  }, [friends, friendQuery]);

  const duplicateNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const friend of friends) {
      const key = friend.displayName.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [friends]);

  function sendNewPing() {
    if (!selectedFriend) return;
    startSendPing(async () => {
      const result = await createMeetupRequestAction({
        receiverId: selectedFriend.friendId,
        message: pingMessage.trim() || undefined
      });
      if (!result.ok) {
        setSendPingError(result.message);
        return;
      }
      setNewPingOpen(false);
      setFeedback("Meeting ping sent");
    });
  }

  return (
    <div className="mx-auto max-w-[1040px] space-y-6 pt-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Meeting Pings</h1>
          <p className="mt-2 text-sm text-muted-foreground">Make plans with your Muddies.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Popover.Root open={helpOpen} onOpenChange={setHelpOpen}>
            <Popover.Trigger asChild>
              <Button type="button" variant="ghost" size="icon" title="How it works" aria-label="How it works">
                <HelpCircle className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                sideOffset={8}
                collisionPadding={12}
                className="compact-drop-popover app-dropdown-content w-[min(300px,calc(100vw-1.5rem))] p-3"
              >
                <p className="mb-2 text-sm font-semibold">How it works</p>
                <div className="grid gap-3">
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
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <Button type="button" title="New ping" aria-label="New ping" onClick={openNewPing}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            New ping
          </Button>
        </div>
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
            {item.id === "received" ? `Received (${pings.length})` : item.label}
          </button>
        ))}
      </div>

      {feedback ? <p className="text-sm text-muted-foreground" role="status">{feedback}</p> : null}

      {tab === "received" ? (
        pings.filter((ping) => ping.direction === "received" && ping.status === "pending").length > 0 ? (
          <div className="divide-y divide-border/70">
            {pings.filter((item) => item.direction === "received" && item.status === "pending").map((ping) => (
              <div key={ping.id} className="min-h-[96px] py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{ping.counterpartyName} wants to connect</p>
                    <p className="mt-1 truncate text-sm text-muted-foreground">&ldquo;{ping.message}&rdquo;</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(ping.createdAt)}</span>
                </div>
                <div className="mt-2 flex gap-2">
                  {respondingTo?.id === ping.id ? null : (
                    <>
                      <Button type="button" size="sm" disabled={isPending} onClick={() => setRespondingTo(ping)}>
                        Reply
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => dismiss(ping)}
                      >
                        Dismiss
                      </Button>
                    </>
                  )}
                </div>
                {respondingTo?.id === ping.id ? (
                  <div className="mt-2 grid gap-2 border-t border-border/70 pt-3 sm:grid-cols-2">
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
          <EmptyState
            icon={CalendarCheck2}
            className="!shadow-none"
            title="No meeting pings yet"
            description="When a Muddy wants to meet up, their ping will show up here."
          />
        )
      ) : null}

      {tab === "sent" ? (
        pings.filter((ping) => ping.direction === "sent" && ping.status === "pending").length > 0 ? (
          <PingRows pings={pings.filter((ping) => ping.direction === "sent" && ping.status === "pending")} />
        ) : <EmptyState
          icon={MessageCircle}
          className="!shadow-none"
          title="You haven't sent a ping yet"
          description="Send a meeting ping to a Muddy and it'll show up here while you wait for a reply."
        />
      ) : null}

      {tab === "history" ? (
        pings.filter((ping) => ping.status !== "pending").length > 0 ? (
          <PingRows pings={pings.filter((ping) => ping.status !== "pending")} />
        ) : <EmptyState
          icon={CalendarCheck2}
          className="!shadow-none"
          title="No past pings"
          description="Pings you've sent or replied to will move here once they're resolved."
        />
      ) : null}

      <Modal
        open={newPingOpen}
        onOpenChange={setNewPingOpen}
        title="New meeting ping"
        description="Choose a Muddy and send them a quick invite to meet up."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setNewPingOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={!selectedFriend || isSendingPing} onClick={sendNewPing}>
              <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Send ping
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={friendQuery}
              onChange={(event) => setFriendQuery(event.target.value)}
              placeholder="Search your Muddies"
              className="pl-9"
            />
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto">
            {!friendsLoaded ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Loading your Muddies…</p>
            ) : filteredFriends.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No Muddies match that search.</p>
            ) : (
              filteredFriends.map((friend) => {
                const isDuplicateName = (duplicateNameCounts.get(friend.displayName.toLowerCase()) ?? 0) > 1;
                const isSelected = selectedFriend?.friendId === friend.friendId;
                return (
                  <button
                    key={friend.friendId}
                    type="button"
                    onClick={() => setSelectedFriend(friend)}
                    className={cn(
                      "focus-ring safe-motion flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left",
                      isSelected ? "bg-primary/10" : "hover:bg-secondary/60"
                    )}
                  >
                    <GlowAvatar name={friend.displayName} src={friend.avatarUrl} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{friend.displayName}</span>
                      {isDuplicateName ? (
                        <span className="block truncate text-xs text-muted-foreground">@{friend.username}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {selectedFriend ? (
            <div>
              <label htmlFor="ping-message" className="text-sm font-medium">
                Message <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="ping-message"
                value={pingMessage}
                onChange={(event) => setPingMessage(event.target.value)}
                placeholder="e.g. Free for a coffee this weekend?"
                maxLength={180}
                className="mt-1.5"
              />
            </div>
          ) : null}

          {sendPingError ? <p className="text-sm text-destructive">{sendPingError}</p> : null}
        </div>
      </Modal>
    </div>
  );
}

function PingRows({ pings }: { pings: MeetingPingListItem[] }) {
  return <div className="divide-y divide-border/70">{pings.map((ping) => (
    <article key={ping.id} className="flex items-start justify-between gap-4 py-4">
      <div><p className="text-sm font-semibold">{ping.direction === "sent" ? `To ${ping.counterpartyName}` : `From ${ping.counterpartyName}`}</p><p className="mt-1 text-sm text-muted-foreground">{ping.message}</p></div>
      <div className="shrink-0 text-right"><p className="text-xs capitalize text-muted-foreground">{ping.status}</p><p className="mt-1 text-xs text-muted-foreground">{formatRelativeTime(ping.createdAt)}</p></div>
    </article>
  ))}</div>;
}
