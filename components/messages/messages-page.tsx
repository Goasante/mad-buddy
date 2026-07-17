"use client";

import { useRouter } from "next/navigation";
import { MessagesSquare, Search, Send, VolumeX } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import {
  getMessagesAction,
  markConversationReadAction,
  muteConversationAction,
  sendMessageAction,
  type ChatMessageView,
  type ConversationView
} from "@/app/(app)/messaging-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Input } from "@/components/ui/input";
import { QUICK_ACTIONS, quickActionLabel, DELETED_MESSAGE_PLACEHOLDER } from "@/lib/messaging/rules";
import { cn, formatRelativeTime } from "@/lib/utils";

const tabs = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "plans", label: "Plans" }
] as const;

type TabId = (typeof tabs)[number]["id"];

function stateLabel(state: string): string {
  switch (state) {
    case "seen":
      return "Seen";
    case "delivered":
      return "Delivered";
    case "failed":
      return "Failed to send";
    default:
      return "Sent";
  }
}

export function MessagesPageContent({
  initialConversations = []
}: {
  initialConversations?: ConversationView[];
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState(initialConversations);
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (activeTab === "unread" && conversation.unreadCount === 0) return false;
      if (activeTab === "plans" && conversation.kind !== "plan") return false;
      if (term && !conversation.title.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [conversations, activeTab, query]);

  /**
   * Opening a conversation is an event, not a render side effect — so the load
   * lives in the handler. Loads the thread, then marks it read.
   */
  function openConversation(conversationId: string) {
    setSelectedId(conversationId);
    setMessages([]);
    setLoadingMessages(true);
    startTransition(async () => {
      const loaded = await getMessagesAction(conversationId);
      setMessages(loaded);
      setLoadingMessages(false);
      await markConversationReadAction(conversationId);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation
        )
      );
    });
  }

  function send(text: string, quickActionType?: string) {
    if (!selectedId) return;
    const body = text.trim();
    if (!body && !quickActionType) return;

    // Idempotency key: a retry can never create a second message (spec §7).
    const clientMessageId = crypto.randomUUID();
    setDraft("");
    startTransition(async () => {
      const result = await sendMessageAction({
        conversationId: selectedId,
        text: quickActionType ? undefined : body,
        quickActionType,
        clientMessageId
      });
      if (!result.ok) {
        setFeedback(result.message);
        return;
      }
      const refreshed = await getMessagesAction(selectedId);
      setMessages(refreshed);
      router.refresh();
    });
  }

  function toggleMute() {
    if (!selected) return;
    startTransition(async () => {
      const result = await muteConversationAction(selected.id, selected.muted ? 0 : 8);
      setFeedback(result.message);
      if (result.ok) {
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === selected.id ? { ...conversation, muted: !conversation.muted } : conversation
          )
        );
      }
    });
  }

  return (
    <div className="mx-auto max-w-[1100px] pt-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Messages</h1>
        <p className="mt-2 text-sm text-muted-foreground">Private conversations with your approved Muddies.</p>
      </header>

      {feedback ? (
        <div className="mb-4 rounded-[1rem] border border-orange-400/20 bg-orange-400/10 p-3 text-sm text-orange-800 dark:text-orange-50" role="status">
          {feedback}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
              className="pl-9"
            />
          </div>

          <nav className="flex gap-1 border-b border-border/70" aria-label="Message filters">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "focus-ring safe-motion border-b-2 px-3 py-2 text-sm font-medium",
                  activeTab === tab.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {visible.length === 0 ? (
            <EmptyState
              icon={MessagesSquare}
              className="!min-h-0 !shadow-none p-5"
              title="No conversations"
              description="Message a Muddy from their profile or a Wave to start one."
            />
          ) : (
            <ul className="space-y-1.5">
              {visible.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => openConversation(conversation.id)}
                    aria-current={selectedId === conversation.id}
                    className={cn(
                      "focus-ring safe-motion flex w-full items-center gap-3 rounded-xl border p-3 text-left",
                      selectedId === conversation.id
                        ? "border-primary bg-primary/5"
                        : "border-border/70 hover:bg-secondary"
                    )}
                  >
                    <GlowAvatar name={conversation.title} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold">{conversation.title}</span>
                        {conversation.contextBadge ? <Badge variant="violet">{conversation.contextBadge}</Badge> : null}
                        {conversation.muted ? (
                          <VolumeX className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Muted" />
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {conversation.lastMessagePreview ?? "No messages yet"}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {conversation.lastMessageAt ? (
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelativeTime(conversation.lastMessageAt)}
                        </span>
                      ) : null}
                      {conversation.unreadCount > 0 ? (
                        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-white">
                          {conversation.unreadCount}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/40">
          {!selected ? (
            <EmptyState
              icon={MessagesSquare}
              className="!min-h-[400px] !shadow-none"
              title="Select a conversation"
              description="Choose a conversation to read and reply."
            />
          ) : (
            <div className="flex h-[560px] flex-col">
              <div className="flex items-center gap-3 border-b border-border/70 p-3">
                <GlowAvatar name={selected.title} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{selected.title}</span>
                <Button type="button" variant="ghost" size="sm" onClick={toggleMute} disabled={isPending}>
                  <VolumeX className="h-4 w-4" aria-hidden="true" />
                  {selected.muted ? "Unmute" : "Mute"}
                </Button>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {loadingMessages ? (
                  <p className="text-center text-xs text-muted-foreground">Loading…</p>
                ) : messages.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground">No messages yet. Say hello.</p>
                ) : (
                  messages.map((message) =>
                    message.messageType === "system" ? (
                      <p key={message.id} className="py-1 text-center text-xs text-muted-foreground">
                        {message.text}
                      </p>
                    ) : (
                      <div key={message.id} className={cn("flex", message.isMine ? "justify-end" : "justify-start")}>
                        <div
                          className={cn(
                            "max-w-[75%] rounded-2xl px-3 py-2",
                            message.isMine ? "bg-primary text-white" : "bg-secondary"
                          )}
                        >
                          <p className={cn("text-sm", message.deleted && "italic opacity-70")}>
                            {message.deleted
                              ? DELETED_MESSAGE_PLACEHOLDER
                              : message.quickActionType
                                ? quickActionLabel(message.quickActionType)
                                : message.text}
                          </p>
                          <p
                            className={cn(
                              "mt-0.5 text-[10px]",
                              message.isMine ? "text-white/70" : "text-muted-foreground"
                            )}
                          >
                            {formatRelativeTime(message.createdAt)}
                            {message.editedAt ? " · edited" : ""}
                            {message.isMine ? ` · ${stateLabel(message.state)}` : ""}
                          </p>
                        </div>
                      </div>
                    )
                  )
                )}
              </div>

              {/* Quick coordination actions (spec §39) — no location attached. */}
              <div className="flex flex-wrap gap-1.5 border-t border-border/70 px-3 pt-2">
                {QUICK_ACTIONS.slice(0, 3).map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => send("", action.id)}
                    disabled={isPending}
                    className="focus-ring safe-motion rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary"
                  >
                    {action.label}
                  </button>
                ))}
              </div>

              <form
                className="flex items-center gap-2 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  send(draft);
                }}
              >
                <Input
                  value={draft}
                  maxLength={2000}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Message"
                  aria-label="Message"
                  className="flex-1"
                />
                <Button type="submit" size="sm" disabled={!draft.trim() || isPending}>
                  <Send className="h-4 w-4" aria-hidden="true" />
                  Send
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Honest crypto language (spec §62) — never claim end-to-end. */}
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Messages are protected in transit and access-controlled. They are not end-to-end encrypted.
      </p>
    </div>
  );
}
