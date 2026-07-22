import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PenSquare, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { formatRelativeTime } from "@/lib/utils";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
import { Modal } from "../components/Modal";
import { api } from "../lib/api";

type Conversation = {
  id: string;
  title: string;
  otherUsername: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  contextBadge: string | null;
};

type Friend = { friendId: string; displayName: string; username: string; avatarUrl: string | null };

export function MessagesScreen() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "unread" | "plans">("all");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await api.get<{ conversations: Conversation[] }>("/api/messages/conversations");
    setLoading(false);
    if (result.ok) setConversations(result.data.conversations);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen
      title="Messages"
      action={
        <Button size="sm" onClick={() => setComposing(true)}>
          <PenSquare className="h-4 w-4" aria-hidden="true" />
          New message
        </Button>
      }
    >
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">Chat privately with your approved Muddies.</p>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input className="pl-9" placeholder="Search messages" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <nav className="mb-4 border-b border-border/70" aria-label="Messages tabs">
        <div className="flex gap-1">
          {(["all", "unread", "plans"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={`focus-ring safe-motion border-b-2 px-4 py-2.5 text-sm font-medium capitalize ${
                activeTab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </nav>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : conversations.length === 0 ? (
        <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
          No conversations yet. Tap “New message” to message a Muddy.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border">
          {conversations
            .filter((c) => query.trim().length === 0 || c.title.toLowerCase().includes(query.toLowerCase()))
            .filter((c) => (activeTab === "unread" ? c.unreadCount > 0 : activeTab === "plans" ? c.contextBadge === "Plan" : true))
            .map((conversation, index) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => navigate(`/messages/${conversation.id}`, { state: { title: conversation.title } })}
                className={`focus-ring flex w-full items-center gap-3 bg-card/40 px-4 py-3 text-left active:bg-secondary ${
                  index > 0 ? "border-t border-border" : ""
                }`}
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
                  {conversation.title.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">{conversation.title}</p>
                    {conversation.contextBadge ? (
                      <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {conversation.contextBadge}
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {conversation.lastMessagePreview ?? "No messages yet"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {conversation.lastMessageAt ? (
                    <span className="text-[10px] text-muted-foreground">
                      {formatRelativeTime(conversation.lastMessageAt)}
                    </span>
                  ) : null}
                  {conversation.unreadCount > 0 ? (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                      {conversation.unreadCount}
                    </span>
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <NewMessageModal open={composing} onOpenChange={setComposing} onOpened={(id, title) => navigate(`/messages/${id}`, { state: { title } })} />
    </Screen>
  );
}

function NewMessageModal({
  open,
  onOpenChange,
  onOpened
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpened: (id: string, title: string) => void;
}) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
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

  async function openConversation(friend: Friend) {
    const result = await api.post<{ ok: boolean; conversationId?: string; message: string }>("/api/messages/open", {
      recipientId: friend.friendId
    });
    if (result.ok && result.data.conversationId) onOpened(result.data.conversationId, friend.displayName);
    else setError(result.ok ? result.data.message : result.error);
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setQuery("");
          setError("");
        }
      }}
      title="New message"
    >
      <div className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Muddies" className="pl-9" />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {!loaded ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {friends.length === 0 ? "Add some Muddies first — you can only message your Muddies." : "No Muddies match that search."}
            </p>
          ) : (
            filtered.map((friend) => (
              <button
                key={friend.friendId}
                type="button"
                onClick={() => void openConversation(friend)}
                className="focus-ring flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left active:bg-secondary"
              >
                <GlowAvatar name={friend.displayName} src={friend.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{friend.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">@{friend.username}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
