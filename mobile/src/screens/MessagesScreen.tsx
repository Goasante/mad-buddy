import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PenSquare, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
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

type Friend = { friendId: string; displayName: string; username: string };

export function MessagesScreen() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await api.get<{ conversations: Conversation[] }>("/api/messages/conversations");
    setLoading(false);
    if (result.ok) setConversations(result.data.conversations);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (composing) {
    return <NewMessage onBack={() => setComposing(false)} onOpened={(id) => navigate(`/messages/${id}`)} />;
  }

  return (
    <Screen
      title="Messages"
      action={
        <Button size="sm" onClick={() => setComposing(true)}>
          <PenSquare className="h-4 w-4" aria-hidden="true" />
          New
        </Button>
      }
    >
      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : conversations.length === 0 ? (
        <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
          No conversations yet. Tap “New” to message a Muddy.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border">
          {conversations.map((conversation, index) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => navigate(`/messages/${conversation.id}`)}
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
    </Screen>
  );
}

function NewMessage({ onBack, onOpened }: { onBack: () => void; onOpened: (id: string) => void }) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const result = await api.get<{ friends: Friend[] }>("/api/messages/friends");
      setLoading(false);
      if (result.ok) setFriends(result.data.friends);
    })();
  }, []);

  async function open(friend: Friend) {
    const result = await api.post<{ ok: boolean; conversationId?: string; message: string }>("/api/messages/open", {
      recipientId: friend.friendId
    });
    if (result.ok && result.data.conversationId) onOpened(result.data.conversationId);
    else setError(result.ok ? result.data.message : result.error);
  }

  return (
    <Screen
      title="New message"
      action={
        <Button size="sm" variant="outline" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
      }
    >
      {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : friends.length === 0 ? (
        <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
          Add some Muddies first — you can only message your Muddies.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border">
          {friends.map((friend, index) => (
            <li key={friend.friendId}>
              <button
                type="button"
                onClick={() => void open(friend)}
                className={`focus-ring flex w-full items-center gap-3 bg-card/40 px-4 py-3 text-left active:bg-secondary ${
                  index > 0 ? "border-t border-border" : ""
                }`}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
                  {friend.displayName.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{friend.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">@{friend.username}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
