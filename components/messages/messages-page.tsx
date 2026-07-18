"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, Info, MessagesSquare, PenSquare, Search, Send, VolumeX } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  deleteMessageAction,
  editMessageAction,
  getMessageableFriendsAction,
  getMessagesAction,
  markConversationReadAction,
  muteConversationAction,
  openDirectConversationAction,
  reactToMessageAction,
  sendMessageAction,
  type ChatMessageView,
  type ConversationView,
  type MessageableFriend
} from "@/app/(app)/messaging-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { QUICK_ACTIONS, quickActionLabel, DELETED_MESSAGE_PLACEHOLDER } from "@/lib/messaging/rules";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn, formatRelativeTime } from "@/lib/utils";

const tabs = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  // "Plans" filters conversation_type === "plan" (the group chat attached to
  // a specific Plan), a real, working filter linked to existing plans.
  { id: "plans", label: "Plans" }
] as const;

type TabId = (typeof tabs)[number]["id"];

const REACTIONS = [
  { id: "heart", emoji: "❤️" },
  { id: "laugh", emoji: "😂" },
  { id: "thumbs_up", emoji: "👍" },
  { id: "wave", emoji: "👋" },
  { id: "fire", emoji: "🔥" },
  { id: "wow", emoji: "😮" }
] as const;

function reactionEmoji(id: string | null): string | null {
  return REACTIONS.find((reaction) => reaction.id === id)?.emoji ?? null;
}

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function react(messageId: string, reaction: string) {
    if (!selectedId) return;
    setReactingId(null);
    startTransition(async () => {
      const result = await reactToMessageAction(messageId, reaction);
      if (!result.ok) setFeedback(result.message);
      setMessages(await getMessagesAction(selectedId));
    });
  }

  function saveEdit(messageId: string) {
    if (!selectedId || !editDraft.trim()) return;
    startTransition(async () => {
      const result = await editMessageAction(messageId, editDraft.trim());
      if (!result.ok) setFeedback(result.message);
      setEditingId(null);
      setMessages(await getMessagesAction(selectedId));
    });
  }

  function remove(messageId: string) {
    if (!selectedId) return;
    startTransition(async () => {
      const result = await deleteMessageAction(messageId, true);
      if (!result.ok) setFeedback(result.message);
      setMessages(await getMessagesAction(selectedId));
    });
  }

  // Defensive de-dup by conversation id, a row should never render twice
  // for the same real conversation, whatever produced the raw list.
  const uniqueConversations = useMemo(() => {
    const seen = new Set<string>();
    return conversations.filter((conversation) => {
      if (seen.has(conversation.id)) return false;
      seen.add(conversation.id);
      return true;
    });
  }, [conversations]);

  // Duplicate display names (two different conversations both titled
  // "Kofi") get their @username shown for disambiguation.
  const duplicateTitles = useMemo(() => {
    const seen = new Map<string, number>();
    for (const conversation of uniqueConversations) {
      const key = conversation.title.trim().toLowerCase();
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [uniqueConversations]);

  const selected = uniqueConversations.find((conversation) => conversation.id === selectedId) ?? null;

  // Realtime (spec §64): subscribe to the open thread's messages instead of
  // only reloading after our own sends. Authorization is server-side, RLS on
  // messages means a non-member subscription simply receives nothing. If the
  // subscription isn't available, the existing reload-after-send still works.
  useEffect(() => {
    if (!selectedId) return;
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return;
    }
    const channel = supabase
      .channel(`messages:${selectedId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${selectedId}` },
        () => {
          // Refetch through the server action so blocks, hides, and receipt
          // preferences are re-applied, never trust the raw event payload.
          void getMessagesAction(selectedId).then(setMessages);
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedId]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return uniqueConversations.filter((conversation) => {
      if (activeTab === "unread" && conversation.unreadCount === 0) return false;
      if (activeTab === "plans" && conversation.kind !== "plan") return false;
      if (term && !conversation.title.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [uniqueConversations, activeTab, query]);

  /**
   * Opening a conversation is an event, not a render side effect, so the load
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

  /** Reuses the existing no-manual-create-step flow (spec §4): opening a
   * direct conversation server-side either finds the existing one or creates
   * it, re-validating eligibility regardless of what this picker shows. */
  function startConversationWith(friendId: string) {
    setNewMessageOpen(false);
    startTransition(async () => {
      const result = await openDirectConversationAction(friendId);
      if (!result.ok || !result.conversationId) {
        setFeedback(result.message);
        return;
      }
      router.refresh();
      openConversation(result.conversationId);
    });
  }

  const hasAnyConversations = uniqueConversations.length > 0;

  return (
    <div className="mx-auto max-w-[1200px] pt-6">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Messages</h1>
          <p className="mt-2 text-sm text-muted-foreground">Chat privately with your approved Muddies.</p>
        </div>
        <Button type="button" onClick={() => setNewMessageOpen(true)} aria-label="New message" title="New message">
          <PenSquare className="h-4 w-4" aria-hidden="true" />
          New message
        </Button>
      </header>

      {feedback ? (
        <div className="mb-4 rounded-[1rem] border border-orange-400/20 bg-orange-400/10 p-3 text-sm text-orange-800 dark:text-orange-50" role="status">
          {feedback}
        </div>
      ) : null}

      {!hasAnyConversations ? (
        // One compact, centred empty state, no search, filters, list, or
        // right panel until there's something for them to operate on.
        <EmptyState
          icon={MessagesSquare}
          className="!min-h-0 mx-auto max-w-md !shadow-none py-4"
          title="No conversations yet"
          description="Message an approved Muddy to start one."
          action={
            <Button type="button" onClick={() => setNewMessageOpen(true)} aria-label="New message">
              <PenSquare className="h-4 w-4" aria-hidden="true" />
              New message
            </Button>
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className={cn("space-y-3", selectedId && "hidden lg:block")}>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search messages"
                aria-label="Search messages"
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
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                <span className="block font-medium text-foreground">No conversations found</span>
                Try another name or keyword.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {visible.map((conversation) => {
                  const isSelected = selectedId === conversation.id;
                  const showUsername =
                    conversation.otherUsername && duplicateTitles.has(conversation.title.trim().toLowerCase());
                  return (
                    <li key={conversation.id}>
                      <button
                        type="button"
                        onClick={() => openConversation(conversation.id)}
                        aria-current={isSelected}
                        className={cn(
                          "focus-ring safe-motion flex min-h-[72px] w-full items-center gap-3 rounded-xl border border-l-2 p-3 text-left transition-colors active:bg-secondary/70",
                          isSelected
                            ? "border-transparent border-l-primary bg-primary/5"
                            : "border-transparent border-l-transparent hover:bg-secondary"
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
                          {showUsername ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              @{conversation.otherUsername}
                            </span>
                          ) : null}
                          {conversation.lastMessagePreview ? (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {conversation.lastMessagePreview}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          {conversation.lastMessageAt ? (
                            <span className="text-[10px] text-muted-foreground">
                              {formatRelativeTime(conversation.lastMessageAt)}
                            </span>
                          ) : null}
                          {conversation.unreadCount > 0 ? (
                            <span
                              className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-white"
                              aria-label={`${conversation.unreadCount} unread`}
                            >
                              {conversation.unreadCount}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div
            className={cn(
              "flex h-[calc(100dvh-13rem)] max-h-[720px] min-h-[420px] flex-col rounded-2xl border border-border/70 bg-card/40",
              !selectedId && "hidden lg:flex"
            )}
          >
            {!selected ? (
              // Centred directly in the panel, no oversized empty-state card.
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-secondary text-muted-foreground">
                  <MessagesSquare className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-semibold">Select a conversation</p>
                <p className="mt-1 text-sm text-muted-foreground">Choose a Muddy to view your conversation.</p>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex min-h-[68px] items-center gap-2 border-b border-border/70 px-3">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    aria-label="Back to conversations"
                    title="Back to conversations"
                    className="focus-ring safe-motion -ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground lg:hidden"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <GlowAvatar name={selected.title} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{selected.title}</span>
                  <Popover.Root open={infoOpen} onOpenChange={setInfoOpen}>
                    <Popover.Trigger asChild>
                      <button
                        type="button"
                        aria-label="Message information"
                        title="Message information"
                        className="focus-ring safe-motion grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <Info className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content
                        align="end"
                        sideOffset={8}
                        collisionPadding={12}
                        className="z-50 w-[min(280px,calc(100vw-1.5rem))] rounded-xl border border-border/70 bg-card p-3 shadow-lg outline-none"
                      >
                        <p className="text-sm font-semibold">Message information</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Messages are protected in transit but aren&apos;t end-to-end encrypted.
                        </p>
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                  <button
                    type="button"
                    onClick={toggleMute}
                    disabled={isPending}
                    aria-label={selected.muted ? "Unmute conversation" : "Mute conversation"}
                    title={selected.muted ? "Unmute conversation" : "Mute conversation"}
                    className="focus-ring safe-motion grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                  >
                    <VolumeX className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                  {loadingMessages ? (
                    <p className="text-center text-xs text-muted-foreground">Loading…</p>
                  ) : messages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center text-center">
                      <p className="text-sm font-semibold">Start the conversation</p>
                      <p className="mt-1 text-xs text-muted-foreground">Send a message to {selected.title}.</p>
                    </div>
                  ) : (
                    messages.map((message) =>
                      message.messageType === "system" ? (
                        <p key={message.id} className="py-1 text-center text-xs text-muted-foreground">
                          {message.text}
                        </p>
                      ) : (
                        <div
                          key={message.id}
                          className={cn("group flex", message.isMine ? "justify-end" : "justify-start")}
                        >
                          <div className={cn("max-w-[75%]", message.isMine && "flex flex-col items-end")}>
                            <div
                              className={cn(
                                "rounded-2xl px-3 py-2",
                                message.isMine ? "bg-primary text-white" : "bg-secondary"
                              )}
                            >
                              {editingId === message.id ? (
                                <form
                                  className="flex items-center gap-1.5"
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    saveEdit(message.id);
                                  }}
                                >
                                  <Input
                                    value={editDraft}
                                    maxLength={2000}
                                    autoFocus
                                    onChange={(event) => setEditDraft(event.target.value)}
                                    aria-label="Edit message"
                                    className="h-7 bg-white text-sm text-foreground"
                                  />
                                  <Button type="submit" size="sm" disabled={!editDraft.trim() || isPending}>
                                    Save
                                  </Button>
                                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                                    Cancel
                                  </Button>
                                </form>
                              ) : (
                                <p className={cn("text-sm", message.deleted && "italic opacity-70")}>
                                  {message.deleted
                                    ? DELETED_MESSAGE_PLACEHOLDER
                                    : message.quickActionType
                                      ? quickActionLabel(message.quickActionType)
                                      : message.text}
                                </p>
                              )}
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

                            {message.myReaction ? (
                              <button
                                type="button"
                                onClick={() => react(message.id, message.myReaction as string)}
                                title="Remove reaction"
                                className="focus-ring -mt-1 w-fit rounded-full border border-border bg-card px-1.5 text-xs"
                              >
                                {reactionEmoji(message.myReaction)}
                              </button>
                            ) : null}

                            {!message.deleted ? (
                              <div
                                className={cn(
                                  "mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
                                  message.isMine ? "justify-end" : "justify-start"
                                )}
                              >
                                {reactingId === message.id ? (
                                  REACTIONS.map((reaction) => (
                                    <button
                                      key={reaction.id}
                                      type="button"
                                      onClick={() => react(message.id, reaction.id)}
                                      aria-label={`React with ${reaction.id}`}
                                      className="focus-ring rounded px-0.5 text-sm hover:scale-110"
                                    >
                                      {reaction.emoji}
                                    </button>
                                  ))
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => setReactingId(message.id)}
                                      className="focus-ring rounded px-1 hover:text-foreground"
                                    >
                                      React
                                    </button>
                                    {message.isMine && message.messageType === "text" ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingId(message.id);
                                            setEditDraft(message.text ?? "");
                                          }}
                                          className="focus-ring rounded px-1 hover:text-foreground"
                                        >
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => remove(message.id)}
                                          className="focus-ring rounded px-1 hover:text-destructive"
                                        >
                                          Delete
                                        </button>
                                      </>
                                    ) : null}
                                  </>
                                )}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )
                    )
                  )}
                </div>

                {/* Quick coordination actions (spec §39), no location attached. */}
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
                    placeholder={`Message ${selected.title}`}
                    aria-label={`Message ${selected.title}`}
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
      )}

      <NewMessageModal open={newMessageOpen} onOpenChange={setNewMessageOpen} onSelect={startConversationWith} />
    </div>
  );
}

function NewMessageModal({
  open,
  onOpenChange,
  onSelect
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (friendId: string) => void;
}) {
  const [friends, setFriends] = useState<MessageableFriend[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || friends !== null) return;
    void getMessageableFriendsAction().then(setFriends);
  }, [open, friends]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!friends) return [];
    if (!term) return friends;
    return friends.filter(
      (friend) => friend.displayName.toLowerCase().includes(term) || friend.username.toLowerCase().includes(term)
    );
  }, [friends, query]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New message" compact>
      <div className="space-y-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Muddies"
            aria-label="Search Muddies"
            className="pl-9"
            autoFocus
          />
        </div>

        {friends === null ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {friends.length === 0 ? "Add a Muddy first to start messaging." : "No Muddies match your search."}
          </p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {visible.map((friend) => (
              <li key={friend.friendId}>
                <button
                  type="button"
                  onClick={() => onSelect(friend.friendId)}
                  className="focus-ring safe-motion flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-secondary"
                >
                  <GlowAvatar name={friend.displayName} src={friend.avatarUrl} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{friend.displayName}</span>
                    <span className="block truncate text-xs text-muted-foreground">@{friend.username}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
