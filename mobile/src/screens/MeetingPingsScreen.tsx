import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck2, HelpCircle, MessageCircle, Plus, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { connectionResponsesFor } from "@/lib/meetups/connection-prompts";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Spinner } from "../components/Spinner";
import { Modal } from "../components/Modal";
import { useOverlayDismiss } from "../lib/overlay";
import { api } from "../lib/api";

type Ping = {
  id: string;
  direction: "received" | "sent";
  counterpartyName: string;
  message: string;
  status: "pending" | "accepted" | "declined" | "expired";
  createdAt: string;
};
type Friend = { friendId: string; displayName: string; username: string; avatarUrl: string | null };
type Tab = "received" | "sent" | "history";

const tabs: { id: Tab; label: string }[] = [
  { id: "received", label: "Received" },
  { id: "sent", label: "Sent" },
  { id: "history", label: "History" }
];

const howItWorks = [
  { step: "1", title: "Send a ping", description: "Choose time & place." },
  { step: "2", title: "They respond", description: "Accept or suggest." },
  { step: "3", title: "Plan it", description: "Turn it into a plan." }
];

export function MeetingPingsScreen() {
  const [pings, setPings] = useState<Ping[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("received");
  const [respondingTo, setRespondingTo] = useState<Ping | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  useOverlayDismiss(helpOpen, () => setHelpOpen(false));

  const load = useCallback(async () => {
    const result = await api.get<{ pings: Ping[] }>("/api/pings");
    setLoading(false);
    if (result.ok) setPings(result.data.pings);
    else setFeedback(result.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const received = pings.filter((p) => p.direction === "received" && p.status === "pending");
  const sent = pings.filter((p) => p.direction === "sent" && p.status === "pending");
  const history = pings.filter((p) => p.status !== "pending");

  async function respond(ping: Ping, message: string) {
    setBusy(true);
    const result = await api.post<{ ok: boolean; message: string }>("/api/pings/respond", { requestId: ping.id, message });
    setBusy(false);
    setFeedback(result.ok ? "Reply sent" : result.error);
    if (result.ok) {
      setRespondingTo(null);
      void load();
    }
  }

  async function dismiss(ping: Ping) {
    setBusy(true);
    const result = await api.del<{ ok: boolean }>("/api/pings", { id: ping.id });
    setBusy(false);
    if (result.ok) setPings((current) => current.map((p) => (p.id === ping.id ? { ...p, status: "declined" } : p)));
    else setFeedback(result.error);
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 px-4 pt-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Meeting Pings</h1>
          <p className="mt-2 text-sm text-muted-foreground">Make plans with your Muddies.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative">
            <button
              type="button"
              aria-label="How it works"
              onClick={() => setHelpOpen((v) => !v)}
              className="focus-ring grid h-10 w-10 place-items-center rounded-full border border-border/70 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <HelpCircle className="h-4 w-4" aria-hidden="true" />
            </button>
            {helpOpen ? (
              <>
                <div className="fixed inset-0 z-[90]" onClick={() => setHelpOpen(false)} aria-hidden="true" />
                <div className="absolute right-0 top-full z-[100] mt-2 w-64 rounded-xl border border-border bg-card p-3 shadow-[0_18px_45px_rgba(0,0,0,0.5)]">
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
                </div>
              </>
            ) : null}
          </div>
          <Button type="button" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New ping
          </Button>
        </div>
      </header>

      <div className="flex gap-1 border-b border-border/70">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium",
              tab === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
            )}
          >
            {item.id === "received" ? `Received (${received.length})` : item.label}
          </button>
        ))}
      </div>

      {feedback ? <p className="text-sm text-muted-foreground" role="status">{feedback}</p> : null}

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : tab === "received" ? (
        received.length === 0 ? (
          <PingEmpty icon={CalendarCheck2} title="No meeting pings yet" description="When a Muddy wants to meet up, their ping will show up here." />
        ) : (
          <div className="divide-y divide-border/70">
            {received.map((ping) => (
              <div key={ping.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{ping.counterpartyName} wants to connect</p>
                    <p className="mt-1 truncate text-sm text-muted-foreground">&ldquo;{ping.message}&rdquo;</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(ping.createdAt)}</span>
                </div>
                {respondingTo?.id === ping.id ? (
                  <div className="mt-2 grid gap-2 border-t border-border/70 pt-3">
                    {connectionResponsesFor(ping.message).quickReplies.map((reply) => (
                      <Button key={reply} type="button" variant="outline" size="sm" className="justify-start" disabled={busy} onClick={() => void respond(ping, reply)}>
                        {reply}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" disabled={busy} onClick={() => setRespondingTo(ping)}>
                      Reply
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void dismiss(ping)}>
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : tab === "sent" ? (
        sent.length === 0 ? (
          <PingEmpty icon={MessageCircle} title="You haven't sent a ping yet" description="Send a meeting ping to a Muddy and it'll show up here while you wait for a reply." />
        ) : (
          <PingRows pings={sent} />
        )
      ) : history.length === 0 ? (
        <PingEmpty icon={CalendarCheck2} title="No past pings" description="Pings you've sent or replied to will move here once they're resolved." />
      ) : (
        <PingRows pings={history} />
      )}

      <NewPingModal open={newOpen} onOpenChange={setNewOpen} onSent={() => { setNewOpen(false); setFeedback("Meeting ping sent"); void load(); }} />
    </div>
  );
}

function PingEmpty({ icon: Icon, title, description }: { icon: typeof CalendarCheck2; title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/40 px-6 py-10 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-secondary text-primary">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function PingRows({ pings }: { pings: Ping[] }) {
  return (
    <div className="divide-y divide-border/70">
      {pings.map((ping) => (
        <article key={ping.id} className="flex items-start justify-between gap-4 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{ping.direction === "sent" ? `To ${ping.counterpartyName}` : `From ${ping.counterpartyName}`}</p>
            <p className="mt-1 truncate text-sm text-muted-foreground">{ping.message}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs capitalize text-muted-foreground">{ping.status}</p>
            <p className="mt-1 text-xs text-muted-foreground">{formatRelativeTime(ping.createdAt)}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function NewPingModal({ open, onOpenChange, onSent }: { open: boolean; onOpenChange: (open: boolean) => void; onSent: () => void }) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Friend | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || loaded) return;
    void api.get<{ friends: Friend[] }>("/api/messages/friends").then((result) => {
      if (result.ok) setFriends(result.data.friends);
      setLoaded(true);
    });
  }, [open, loaded]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) => f.displayName.toLowerCase().includes(q) || f.username.toLowerCase().includes(q));
  }, [friends, query]);

  async function send() {
    if (!selected) return;
    setBusy(true);
    setError("");
    const result = await api.post<{ ok: boolean; message: string }>("/api/pings", {
      receiverId: selected.friendId,
      message: message.trim() || undefined
    });
    setBusy(false);
    if (result.ok) {
      setSelected(null);
      setMessage("");
      setQuery("");
      onSent();
    } else setError(result.error);
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setSelected(null);
          setMessage("");
          setQuery("");
          setError("");
        }
      }}
      title="New meeting ping"
      description="Choose a Muddy and send them a quick invite to meet up."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!selected || busy} onClick={send}>
            <Send className="h-4 w-4" aria-hidden="true" />
            Send ping
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your Muddies" className="pl-9" />
        </div>

        <div className="max-h-64 space-y-1 overflow-y-auto">
          {!loaded ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Loading your Muddies…</p>
          ) : filtered.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No Muddies match that search.</p>
          ) : (
            filtered.map((friend) => {
              const isSelected = selected?.friendId === friend.friendId;
              return (
                <button
                  key={friend.friendId}
                  type="button"
                  onClick={() => setSelected(friend)}
                  className={cn(
                    "focus-ring flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left",
                    isSelected ? "bg-primary/10" : "active:bg-secondary"
                  )}
                >
                  <GlowAvatar name={friend.displayName} src={friend.avatarUrl} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{friend.displayName}</span>
                    <span className="block truncate text-xs text-muted-foreground">@{friend.username}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {selected ? (
          <div className="space-y-1.5">
            <label htmlFor="ping-message" className="text-sm font-medium">
              Message <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input id="ping-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Free for a coffee this weekend?" maxLength={180} />
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </Modal>
  );
}
