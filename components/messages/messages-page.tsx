"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarCheck2,
  ChevronLeft,
  Clock3,
  Info,
  MapPin,
  MessagesSquare,
  PenSquare,
  Plus,
  Search,
  Send,
  Star,
  UsersRound,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  setConversationPinnedAction
} from "@/app/(app)/messaging-actions";
import type { ChatMessageView, ConversationView, MessageableFriend } from "@/lib/messaging/mobile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useDismissOnBack } from "@/hooks/use-dismiss-on-back";
import { QUICK_ACTIONS, quickActionLabel, DELETED_MESSAGE_PLACEHOLDER } from "@/lib/messaging/rules";
import { authenticateRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
import { cn, formatRelativeTime } from "@/lib/utils";

// "Groups" filters conversation_type === "group"; "Plans" filters
// conversation_type === "plan" (the group chat attached to a specific Plan).
// Both are real, working filters over data already loaded.
const tabs: Array<{ id: "all" | "unread" | "groups" | "plans"; label: string; icon: LucideIcon | null }> = [
  { id: "all", label: "All", icon: null },
  { id: "unread", label: "Unread", icon: null },
  { id: "groups", label: "Groups", icon: UsersRound },
  { id: "plans", label: "Plans", icon: CalendarCheck2 }
];

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

function messageFailure(error: unknown) {
  return isRequestTimeoutError(error)
    ? "Messages took too long to respond. Try again."
    : "Messages could not be updated. Try again.";
}

const MESSAGE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit"
});

const MESSAGE_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric"
});

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function formatMessageTime(createdAt: string) {
  return MESSAGE_TIME_FORMATTER.format(new Date(createdAt));
}

function formatMessageDayLabel(createdAt: string) {
  const now = new Date();
  const messageDate = new Date(createdAt);
  const dayDiff = Math.round((startOfLocalDay(now) - startOfLocalDay(messageDate)) / (24 * 60 * 60 * 1000));
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  return MESSAGE_DAY_FORMATTER.format(messageDate);
}

function isSameMessageDay(previous: ChatMessageView | null, current: ChatMessageView) {
  if (!previous) return false;
  const previousDate = new Date(previous.createdAt);
  const currentDate = new Date(current.createdAt);
  return startOfLocalDay(previousDate) === startOfLocalDay(currentDate);
}

function isGroupedMessage(previous: ChatMessageView | null, current: ChatMessageView) {
  if (!previous || previous.messageType === "system" || current.messageType === "system") return false;
  if (previous.senderId !== current.senderId) return false;
  if (previous.isMine !== current.isMine) return false;
  const previousDate = new Date(previous.createdAt).getTime();
  const currentDate = new Date(current.createdAt).getTime();
  return isSameMessageDay(previous, current) && currentDate - previousDate <= 10 * 60 * 1000;
}

function quickReplyMeta(actionId: string): { icon: LucideIcon; className: string } {
  switch (actionId) {
    case "on_my_way":
      return { icon: Send, className: "text-primary" };
    case "im_here":
      return { icon: MapPin, className: "text-primary" };
    case "running_late":
      return { icon: Clock3, className: "text-primary" };
    default:
      return { icon: Send, className: "text-muted-foreground" };
  }
}

export function MessagesPageContent({
  initialConversations = []
}: {
  initialConversations?: ConversationView[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedConversationId = searchParams.get("conversation");
  const [conversations, setConversations] = useState(initialConversations);
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    initialConversations.some((conversation) => conversation.id === requestedConversationId)
      ? requestedConversationId
      : null
  );
  const openedRequestedConversation = useRef(false);
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
  useDismissOnBack(infoOpen, () => setInfoOpen(false));
  const [pinEditMode, setPinEditMode] = useState(false);
  const [pinPickerOpen, setPinPickerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const loadRequestIdRef = useRef(0);
  const messageListRef = useRef<HTMLDivElement>(null);
  const stayAtLatestRef = useRef(true);

  const loadConversation = useCallback(async (conversationId: string) => {
    const requestId = ++loadRequestIdRef.current;
    setLoadingMessages(true);
    setFeedback("");

    try {
      const loaded = await withTimeout(getMessagesAction(conversationId), {
        operation: "load conversation"
      });
      if (requestId !== loadRequestIdRef.current) return;
      setMessages(loaded);

      const readResult = await withTimeout(markConversationReadAction(conversationId), {
        operation: "mark conversation read"
      });
      if (requestId !== loadRequestIdRef.current) return;
      if (!readResult.ok) setFeedback(readResult.message);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation
        )
      );
    } catch (error) {
      if (requestId === loadRequestIdRef.current) {
        setFeedback(messageFailure(error));
      }
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoadingMessages(false);
      }
    }
  }, []);

  const refreshMessages = useCallback(async (conversationId: string) => {
    try {
      const loaded = await withTimeout(getMessagesAction(conversationId), {
        operation: "refresh conversation"
      });
      setMessages(loaded);
    } catch (error) {
      setFeedback(messageFailure(error));
    }
  }, []);

  function react(messageId: string, reaction: string) {
    if (!selectedId) return;
    setReactingId(null);
    startTransition(async () => {
      try {
        const result = await withTimeout(reactToMessageAction(messageId, reaction), {
          operation: "react to message"
        });
        if (!result.ok) setFeedback(result.message);
        await refreshMessages(selectedId);
      } catch (error) {
        setFeedback(messageFailure(error));
      }
    });
  }

  function saveEdit(messageId: string) {
    if (!selectedId || !editDraft.trim()) return;
    startTransition(async () => {
      try {
        const result = await withTimeout(editMessageAction(messageId, editDraft.trim()), {
          operation: "edit message"
        });
        if (!result.ok) setFeedback(result.message);
        setEditingId(null);
        await refreshMessages(selectedId);
      } catch (error) {
        setFeedback(messageFailure(error));
      }
    });
  }

  function remove(messageId: string) {
    if (!selectedId) return;
    startTransition(async () => {
      try {
        const result = await withTimeout(deleteMessageAction(messageId, true), {
          operation: "delete message"
        });
        if (!result.ok) setFeedback(result.message);
        await refreshMessages(selectedId);
      } catch (error) {
        setFeedback(messageFailure(error));
      }
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
  const latestMessageId = messages.at(-1)?.id ?? null;

  useEffect(() => {
    if (!selectedId || loadingMessages || !stayAtLatestRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const list = messageListRef.current;
      if (!list) return;
      list.scrollTop = list.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [latestMessageId, loadingMessages, selectedId]);

  useEffect(() => {
    if (
      openedRequestedConversation.current ||
      !requestedConversationId ||
      !uniqueConversations.some((conversation) => conversation.id === requestedConversationId)
    ) {
      return;
    }
    openedRequestedConversation.current = true;
    setSelectedId(requestedConversationId);
    setMessages([]);
    void loadConversation(requestedConversationId);
  }, [loadConversation, requestedConversationId, uniqueConversations]);

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
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshInFlight = false;
    let refreshQueued = false;
    let disposed = false;

    const performRefresh = async () => {
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      refreshInFlight = true;
      try {
        const loaded = await withTimeout(getMessagesAction(selectedId), {
          operation: "realtime message refresh"
        });
        if (!disposed) setMessages(loaded);
      } catch (error) {
        if (!disposed) setFeedback(messageFailure(error));
      } finally {
        refreshInFlight = false;
        if (refreshQueued && !disposed) {
          refreshQueued = false;
          refreshTimer = setTimeout(() => void performRefresh(), 150);
        }
      }
    };

    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void performRefresh(), 150);
    };

    const channel = supabase
      .channel(`messages:${selectedId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${selectedId}` },
        () => {
          // Refetch through the server action so blocks, hides, and receipt
          // preferences are re-applied, never trust the raw event payload.
          scheduleRefresh();
        }
      );

    // Authenticate the socket before subscribing: this filter is on an
    // RLS-protected table, and a socket carrying only the publishable key sees
    // nothing through RLS and is closed with CHANNEL_ERROR.
    void authenticateRealtime(supabase).then(() => {
      if (disposed) return;
      channel.subscribe();
    });

    return () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [selectedId]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return uniqueConversations.filter((conversation) => {
      if (activeTab === "unread" && conversation.unreadCount === 0) return false;
      if (activeTab === "groups" && conversation.kind !== "group") return false;
      if (activeTab === "plans" && conversation.kind !== "plan") return false;
      if (term && !conversation.title.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [uniqueConversations, activeTab, query]);

  const pinnedConversations = useMemo(
    () => uniqueConversations.filter((conversation) => conversation.pinned),
    [uniqueConversations]
  );
  const unpinnedConversations = useMemo(
    () => uniqueConversations.filter((conversation) => !conversation.pinned),
    [uniqueConversations]
  );
  const unreadConversationCount = useMemo(
    () => uniqueConversations.filter((conversation) => conversation.unreadCount > 0).length,
    [uniqueConversations]
  );

  /**
   * Opening a conversation is an event, not a render side effect, so the load
   * lives in the handler. Loads the thread, then marks it read.
   */
  function openConversation(conversationId: string) {
    stayAtLatestRef.current = true;
    setSelectedId(conversationId);
    setMessages([]);
    void loadConversation(conversationId);
  }

  function send(text: string, quickActionType?: string) {
    if (!selectedId) return;
    const body = text.trim();
    if (!body && !quickActionType) return;

    // Idempotency key: a retry can never create a second message (spec §7).
    const clientMessageId = crypto.randomUUID();
    stayAtLatestRef.current = true;
    setDraft("");
    startTransition(async () => {
      try {
        const result = await withTimeout(sendMessageAction({
          conversationId: selectedId,
          text: quickActionType ? undefined : body,
          quickActionType,
          clientMessageId
        }), {
          operation: "send message"
        });
        if (!result.ok) {
          setFeedback(result.message);
          if (!quickActionType) setDraft(body);
          return;
        }
        await refreshMessages(selectedId);
        router.refresh();
      } catch (error) {
        setFeedback(messageFailure(error));
        if (!quickActionType) setDraft(body);
      }
    });
  }

  function toggleMute() {
    if (!selected) return;
    startTransition(async () => {
      try {
        const result = await withTimeout(muteConversationAction(selected.id, selected.muted ? 0 : 8), {
          operation: "update conversation mute"
        });
        setFeedback(result.message);
        if (result.ok) {
          setConversations((current) =>
            current.map((conversation) =>
              conversation.id === selected.id ? { ...conversation, muted: !conversation.muted } : conversation
            )
          );
        }
      } catch (error) {
        setFeedback(messageFailure(error));
      }
    });
  }

  function togglePin(conversationId: string, next: boolean) {
    // Optimistic; revert on failure.
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, pinned: next } : conversation
      )
    );
    startTransition(async () => {
      try {
        const result = await withTimeout(setConversationPinnedAction(conversationId, next), {
          operation: "pin conversation"
        });
        if (!result.ok) {
          setFeedback(result.message);
          setConversations((current) =>
            current.map((conversation) =>
              conversation.id === conversationId ? { ...conversation, pinned: !next } : conversation
            )
          );
        }
      } catch (error) {
        setFeedback(messageFailure(error));
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === conversationId ? { ...conversation, pinned: !next } : conversation
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
      try {
        const result = await withTimeout(openDirectConversationAction(friendId), {
          operation: "open direct conversation"
        });
        if (!result.ok || !result.conversationId) {
          setFeedback(result.message);
          return;
        }
        router.refresh();
        openConversation(result.conversationId);
      } catch (error) {
        setFeedback(messageFailure(error));
      }
    });
  }

  const hasAnyConversations = uniqueConversations.length > 0;

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-6 pt-5 sm:px-6 lg:px-8">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-foreground sm:text-[2.2rem]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-orange-400/25 bg-orange-500/10 text-orange-400 shadow-[0_0_0_1px_rgba(249,115,22,0.08)]">
              <MessagesSquare className="h-5 w-5" aria-hidden="true" />
            </span>
            Messages
          </h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-[0.98rem]">Chat privately with your approved Muddies.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="safe-motion shrink-0 rounded-full border-orange-400/20 bg-orange-500/10 text-orange-400 hover:bg-orange-500/15 hover:text-orange-300"
          onClick={() => setNewMessageOpen(true)}
          aria-label="New message"
          title="New message"
        >
          <PenSquare className="h-4 w-4" aria-hidden="true" />
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
          className="mx-auto max-w-md !min-h-0 !shadow-none py-4"
          title="No conversations yet"
          description="Message an approved Muddy to start one."
          action={
            <Button type="button" className="whitespace-nowrap" onClick={() => setNewMessageOpen(true)} aria-label="New message">
              <PenSquare className="h-4 w-4" aria-hidden="true" />
              New message
            </Button>
          }
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          <div className={cn("space-y-3", selectedId && "hidden xl:block")}>
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

            <nav className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1" aria-label="Message filters">
              {tabs.map((tab) => {
                const active = activeTab === tab.id;
                const Icon = tab.icon;
                const showCount = tab.id === "unread" && unreadConversationCount > 0;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "focus-ring safe-motion inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/70 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                    )}
                  >
                    {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                    {tab.label}
                    {showCount ? (
                      <span className="grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-primary px-1 text-[11px] font-bold leading-none text-primary-foreground">
                        {unreadConversationCount}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            {/* Pinned strip — the user's pinned conversations, plus "Pin more". */}
            {pinnedConversations.length > 0 || unpinnedConversations.length > 0 ? (
              <section aria-label="Pinned conversations">
                <div className="mb-1.5 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Pinned</h2>
                  {pinnedConversations.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setPinEditMode((value) => !value)}
                      className="focus-ring safe-motion rounded text-sm font-medium text-primary hover:underline"
                    >
                      {pinEditMode ? "Done" : "Edit"}
                    </button>
                  ) : null}
                </div>
                <ul className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1 pt-1">
                  {pinnedConversations.map((conversation) => (
                    <li key={conversation.id} className="shrink-0">
                      <div className="relative w-[64px]">
                        <button
                          type="button"
                          onClick={() => openConversation(conversation.id)}
                          className="focus-ring safe-motion flex w-full flex-col items-center gap-1.5 rounded-xl text-center"
                          aria-label={`Open ${conversation.title}`}
                        >
                          <GlowAvatar name={conversation.title} src={conversation.avatarUrl} size="md" />
                          <span className="w-full truncate text-xs font-medium">{conversation.title}</span>
                        </button>
                        {pinEditMode ? (
                          <button
                            type="button"
                            onClick={() => togglePin(conversation.id, false)}
                            aria-label={`Unpin ${conversation.title}`}
                            title="Unpin"
                            className="focus-ring absolute -right-0.5 -top-0.5 grid h-6 w-6 place-items-center rounded-full border-2 border-background bg-secondary text-foreground hover:bg-destructive/15 hover:text-destructive"
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                  {!pinEditMode && unpinnedConversations.length > 0 ? (
                    <li className="shrink-0">
                      <button
                        type="button"
                        onClick={() => setPinPickerOpen(true)}
                        className="focus-ring safe-motion flex w-[64px] flex-col items-center gap-1.5 text-center"
                        aria-label="Pin more conversations"
                      >
                        <span className="grid h-14 w-14 place-items-center rounded-full border-2 border-dashed border-border/70 text-muted-foreground">
                          <Plus className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <span className="w-full truncate text-xs text-muted-foreground">Pin more</span>
                      </button>
                    </li>
                  ) : null}
                </ul>
              </section>
            ) : null}

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
                            : conversation.pinned || conversation.unreadCount > 0
                              ? "border-transparent border-l-primary/70 hover:bg-secondary"
                              : "border-transparent border-l-transparent hover:bg-secondary"
                        )}
                      >
                        <GlowAvatar name={conversation.title} src={conversation.avatarUrl} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-semibold">{conversation.title}</span>
                            {conversation.pinned ? (
                              <Star className="h-3 w-3 shrink-0 fill-primary text-primary" aria-label="Pinned" />
                            ) : null}
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
              "-mx-4 flex h-[calc(100dvh-13rem)] min-h-0 flex-col overflow-hidden border-y border-border/60 bg-background/35 shadow-[0_18px_48px_rgba(0,0,0,0.12)] backdrop-blur-[2px] sm:mx-0 sm:rounded-[1.75rem] sm:border xl:h-[calc(100dvh-9.5rem)] xl:min-h-[34rem] xl:max-h-[780px]",
              !selectedId && "hidden xl:flex"
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
                <div className="flex min-h-[76px] items-center gap-2.5 border-b border-border/50 bg-background/60 px-3 py-2.5 backdrop-blur-md sm:gap-3 sm:px-4">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    aria-label="Back to conversations"
                    title="Back to conversations"
                    className="focus-ring safe-motion -ml-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary/80 hover:text-foreground xl:hidden"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <GlowAvatar name={selected.title} src={selected.avatarUrl} size="lg" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold leading-tight sm:text-lg">{selected.title}</span>
                    {selected.otherUsername || selected.contextBadge ? (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {selected.otherUsername ? `@${selected.otherUsername}` : selected.contextBadge}
                      </span>
                    ) : null}
                  </span>
                  <Popover.Root open={infoOpen} onOpenChange={setInfoOpen}>
                    <Popover.Trigger asChild>
                      <button
                        type="button"
                        aria-label="Message information"
                        title="Message information"
                        className="focus-ring safe-motion grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60 bg-background/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <Info className="h-5 w-5" aria-hidden="true" />
                      </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content
                        align="end"
                        sideOffset={8}
                        collisionPadding={12}
                        className="compact-drop-popover app-dropdown-content w-[min(280px,calc(100vw-1.5rem))] p-3"
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
                    className="focus-ring safe-motion grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60 bg-background/60 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                  >
                    {selected.muted ? <VolumeX className="h-5 w-5" aria-hidden="true" /> : <Volume2 className="h-5 w-5" aria-hidden="true" />}
                  </button>
                </div>
                <div
                  ref={messageListRef}
                  onScroll={(event) => {
                    const list = event.currentTarget;
                    stayAtLatestRef.current =
                      list.scrollHeight - list.scrollTop - list.clientHeight < 96;
                  }}
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background/10 px-3 py-4 sm:px-5"
                  aria-label={`Conversation with ${selected.title}`}
                  aria-live="polite"
                >
                  {loadingMessages ? (
                    <div className="space-y-3" aria-label="Loading messages" role="status">
                      <span className="sr-only">Loading messages</span>
                      <div className="h-14 w-2/5 rounded-[1.35rem] rounded-bl-md bg-secondary/70 motion-safe:animate-pulse" />
                      <div className="ml-auto h-16 w-3/5 rounded-[1.35rem] rounded-br-md bg-primary/25 motion-safe:animate-pulse" />
                      <div className="h-12 w-1/3 rounded-[1.35rem] rounded-bl-md bg-secondary/70 motion-safe:animate-pulse" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex h-full min-h-40 flex-col items-center justify-center px-6 text-center">
                      <span className="grid h-12 w-12 place-items-center rounded-full bg-secondary/80 text-primary">
                        <MessagesSquare className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <p className="mt-3 text-sm font-semibold">No messages yet</p>
                      <p className="mt-1 text-xs text-muted-foreground">Say hi to {selected.title}.</p>
                    </div>
                  ) : (
                    <>
                      {messages.map((message, index) => {
                        const previous = index > 0 ? messages[index - 1] : null;
                        const showDay = !previous || !isSameMessageDay(previous, message);
                        const grouped = isGroupedMessage(previous, message);

                        return (
                          <div key={message.id}>
                            {showDay ? (
                              <div className="py-4 text-center">
                                <span className="inline-flex items-center rounded-full border border-white/8 bg-background/60 px-4 py-1 text-sm text-muted-foreground shadow-sm">
                                  {formatMessageDayLabel(message.createdAt)}
                                </span>
                              </div>
                            ) : null}
                            {message.messageType === "system" ? (
                              <p className="py-2 text-center text-xs text-muted-foreground">{message.text}</p>
                            ) : (
                              <div className={cn("group flex", message.isMine ? "justify-end" : "justify-start", grouped ? "mt-1" : "mt-3")}>
                                <div className={cn("max-w-[84%] sm:max-w-[72%]", message.isMine && "flex flex-col items-end")}>
                                  <div
                                    className={cn(
                                      "min-w-[4.5rem] rounded-[1.35rem] px-3.5 py-2.5 shadow-sm",
                                      message.isMine
                                        ? "rounded-br-md bg-primary text-primary-foreground"
                                        : "rounded-bl-md border border-border/35 bg-secondary/90 text-secondary-foreground"
                                    )}
                                  >
                                    {editingId === message.id ? (
                                      <form
                                        className="flex items-center gap-2"
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
                                          className="h-9 bg-white text-sm text-foreground"
                                        />
                                        <Button type="submit" size="sm" disabled={!editDraft.trim() || isPending}>
                                          Save
                                        </Button>
                                        <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                                          Cancel
                                        </Button>
                                      </form>
                                    ) : (
                                      <p className={cn("whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed", message.deleted && "italic opacity-70")}>
                                        {message.deleted
                                          ? DELETED_MESSAGE_PLACEHOLDER
                                          : message.quickActionType
                                            ? quickActionLabel(message.quickActionType)
                                            : message.text}
                                      </p>
                                    )}
                                    <p
                                      className={cn(
                                        "mt-1 text-[11px] leading-none",
                                        message.isMine ? "text-primary-foreground/70" : "text-muted-foreground"
                                      )}
                                    >
                                      {formatMessageTime(message.createdAt)}
                                      {message.editedAt ? " • edited" : ""}
                                      {message.isMine ? ` • ${stateLabel(message.state)}` : ""}
                                    </p>
                                  </div>

                                  {message.myReaction ? (
                                    <button
                                      type="button"
                                      onClick={() => react(message.id, message.myReaction as string)}
                                      title="Remove reaction"
                                      className="focus-ring -mt-2 w-fit rounded-full border border-border/80 bg-card px-2 py-0.5 text-xs shadow-sm"
                                    >
                                      {reactionEmoji(message.myReaction)}
                                    </button>
                                  ) : null}

                                  {!message.deleted ? (
                                    <div
                                      className={cn(
                                        "mt-1 flex items-center gap-1 text-[11px] text-muted-foreground opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100",
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
                                            className="focus-ring grid min-h-8 min-w-8 place-items-center rounded-full text-sm hover:bg-secondary"
                                          >
                                            {reaction.emoji}
                                          </button>
                                        ))
                                      ) : (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => setReactingId(message.id)}
                                            className="focus-ring min-h-8 rounded-full px-2 hover:bg-secondary hover:text-foreground"
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
                                                className="focus-ring min-h-8 rounded-full px-2 hover:bg-secondary hover:text-foreground"
                                              >
                                                Edit
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => remove(message.id)}
                                                className="focus-ring min-h-8 rounded-full px-2 hover:bg-destructive/10 hover:text-destructive"
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
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>

                {/* Quick coordination actions (spec §39), no location attached. */}
                <div className="border-t border-border/40 bg-background/45 px-3 pb-2 pt-3 backdrop-blur-sm sm:px-4">
                  <div className="no-scrollbar flex gap-2 overflow-x-auto">
                    {QUICK_ACTIONS.slice(0, 3).map((action) => {
                      const meta = quickReplyMeta(action.id);
                      const Icon = meta.icon;
                      return (
                        <button
                          key={action.id}
                          type="button"
                          onClick={() => send("", action.id)}
                          disabled={isPending}
                          className="focus-ring safe-motion inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3.5 py-2 text-sm font-medium text-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-primary disabled:opacity-60"
                        >
                          <Icon className={cn("h-4 w-4", meta.className)} aria-hidden="true" />
                          {action.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <form
                  className="message-composer flex items-center gap-2 border-t border-border/40 bg-background/70 px-3 py-3 backdrop-blur-md sm:gap-3 sm:px-4"
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
                    className="h-12 min-w-0 flex-1 rounded-full border-border/70 bg-background/75 px-4 text-[0.98rem]"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!draft.trim() || isPending}
                    aria-label="Send message"
                    title="Send message"
                    className="focus-ring safe-motion grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_10px_28px_hsl(var(--primary)/0.3)] hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Send className="h-5 w-5" aria-hidden="true" />
                  </Button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      <NewMessageModal open={newMessageOpen} onOpenChange={setNewMessageOpen} onSelect={startConversationWith} />
      <PinPickerModal
        open={pinPickerOpen}
        onOpenChange={setPinPickerOpen}
        conversations={unpinnedConversations}
        onPin={(id) => {
          togglePin(id, true);
          setPinPickerOpen(false);
        }}
      />
    </div>
  );
}

function PinPickerModal({
  open,
  onOpenChange,
  conversations,
  onPin
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: ConversationView[];
  onPin: (conversationId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const visible = term
    ? conversations.filter((conversation) => conversation.title.toLowerCase().includes(term))
    : conversations;

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Pin a conversation" compact>
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations to pin"
            className="pl-9"
          />
        </div>
        {visible.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {conversations.length === 0 ? "Every conversation is already pinned." : "No conversations match your search."}
          </p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {visible.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onPin(conversation.id)}
                  className="focus-ring safe-motion flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-secondary"
                >
                  <GlowAvatar name={conversation.title} src={conversation.avatarUrl} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{conversation.title}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                    <Star className="h-3.5 w-3.5" aria-hidden="true" />
                    Pin
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
