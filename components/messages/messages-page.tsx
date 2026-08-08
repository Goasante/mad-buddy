"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarCheck2, ChevronLeft, Info, MessagesSquare, PenSquare, Plus, Search, Star, UsersRound, VolumeX, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { TrustedMemberMark } from "@/components/trust/trusted-member-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useDismissOnBack } from "@/hooks/use-dismiss-on-back";
import { QUICK_ACTIONS, quickActionLabel, DELETED_MESSAGE_PLACEHOLDER } from "@/lib/messaging/rules";
import { authenticateRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useImmersiveWhile } from "@/components/app-shell/immersive-mode";
import {
  conversationContext,
  dayLabel,
  startsNewDay,
  startsNewRun
} from "@/lib/messaging/conversation-presence";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import { PageHeader } from "@/components/app-shell/page-header";
import { MessageAttachmentImage } from "@/components/messaging/message-attachment-image";
import { MessageComposer } from "@/components/messaging/message-composer";
import { MessageMediaViewer } from "@/components/messaging/message-media-viewer";
import type { AttachmentView } from "@/lib/messaging/attachments";

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

/** Conversation ids are UUIDs; anything else is not worth opening. */
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shape check only, never an authorisation check.
 *
 * It exists to discard obvious junk (a username, a truncated link) before a
 * request. Whether the viewer may actually open the conversation is decided
 * server-side by getMessagesAction, which fails closed.
 */
function isLikelyConversationId(value: string | null): value is string {
  return Boolean(value) && CONVERSATION_ID.test(value as string);
}

function messageFailure(error: unknown) {
  return isRequestTimeoutError(error)
    ? "Messages took too long to respond. Try again."
    : "Messages could not be updated. Try again.";
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
  /* ?conversation= is a SERVER-VALIDATED id: openDirectConversationAction
   * resolved or created it and re-checked eligibility. It is deliberately NOT
   * required to appear in initialConversations — a conversation created
   * moments ago does not exist in the list the server rendered before it, and
   * requiring membership silently dropped the user on the inbox instead of the
   * conversation they asked for. loadConversation re-authorises server-side
   * regardless, so an id the viewer may not open still fails closed. */
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    isLikelyConversationId(requestedConversationId) ? requestedConversationId : null
  );
  const openedRequestedConversation = useRef(false);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [viewerMessageId, setViewerMessageId] = useState<string | null>(null);
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

  // Conversation Mode: a conversation owns the whole screen, so the global
  // bottom navigation steps aside while one is open. Mobile only in effect —
  // the bar is md:hidden anyway — and cleared automatically on unmount.
  useImmersiveWhile(Boolean(selectedId));

  // Why this conversation exists, derived from what the server already sent.

  const context = selected ? conversationContext(selected) : { subtitle: null, shared: false };

  const dismissConversation = useCallback(() => {
    openedRequestedConversation.current = true;
    setSelectedId(null);
    setMessages([]);
    // Clearing the param is what makes Back/close return to the inbox rather
    // than immediately reopening the conversation on the next render.
    if (requestedConversationId) router.replace("/messages", { scroll: false });
  }, [requestedConversationId, router]);

  /* A conversation is page-level UI inside /messages, not a separate route.
   * Give it one same-URL history entry so browser swipe-back and Android/PWA
   * Back close the chat before leaving Messages. Preserve Next's existing
   * history state, and ignore the first pop when a nested info sheet closes. */
  useEffect(() => {
    if (!selectedId || typeof window === "undefined") return;

    window.history.pushState({ ...window.history.state, mbConversation: true }, "");

    const handlePopState = (event: PopStateEvent) => {
      if (event.state?.mbConversation) return;
      dismissConversation();
    };
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (window.history.state?.mbConversation) {
        const nextState = { ...window.history.state };
        delete nextState.mbConversation;
        window.history.replaceState(nextState, "");
      }
    };
  }, [dismissConversation, selectedId]);

  const closeConversation = useCallback(() => {
    if (typeof window !== "undefined" && window.history.state?.mbConversation) {
      window.history.back();
      return;
    }
    dismissConversation();
  }, [dismissConversation]);

  useEffect(() => {
    if (openedRequestedConversation.current || !isLikelyConversationId(requestedConversationId)) {
      return;
    }
    openedRequestedConversation.current = true;
    setSelectedId(requestedConversationId);
    setMessages([]);
    void loadConversation(requestedConversationId);
  }, [loadConversation, requestedConversationId]);

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
    setSelectedId(conversationId);
    setMessages([]);
    void loadConversation(conversationId);
  }

  function sendQuickAction(quickActionType: string) {
    if (!selectedId) return;

    // Idempotency key: a retry can never create a second message (spec §7).
    const clientMessageId = crypto.randomUUID();
    startTransition(async () => {
      try {
        const result = await withTimeout(sendMessageAction({
          conversationId: selectedId,
          text: undefined,
          quickActionType,
          clientMessageId
        }), {
          operation: "send message"
        });
        if (!result.ok) {
          setFeedback(result.message);
          return;
        }
        await refreshMessages(selectedId);
        router.refresh();
      } catch (error) {
        setFeedback(messageFailure(error));
      }
    });
  }

  const updateMessageAttachment = useCallback((messageId: string, attachment: AttachmentView) => {
    setMessages((current) => current.map((message) =>
      message.id === messageId ? { ...message, attachment } : message
    ));
  }, []);

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
    <div data-tour-id={TOUR_TARGET_IDS.MESSAGES_INBOX} className="mx-auto w-full min-w-0 max-w-[1200px] md:pt-6">
      {/* Inbox only. On mobile an open conversation replaces the list, and
          that view keeps its own contextual header (participant avatar,
          premium ring, name, plan badge, mute/info) — a Menu button has no
          place inside a conversation, and the canonical header's controlled
          API cannot carry participant identity. Desktop shows both panes at
          once, so the shared header stays hidden there too. */}
      <div className={cn(selectedId && "hidden")}>
        <PageHeader title="Messages" />
      </div>

      <header className={cn("mb-4 flex items-start justify-between gap-3 pt-1 md:pt-0", selectedId && "hidden lg:flex")}>
        <div className="min-w-0">
          {/* Hidden on mobile: the shared header carries the title there. */}
          <h1 className="hidden items-center gap-2 text-2xl font-semibold tracking-tight md:flex sm:text-3xl">
            <MessagesSquare className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
            Messages
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Chat privately with your approved Muddies.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0 rounded-full"
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
          className="!min-h-0 mx-auto max-w-md !shadow-none py-4"
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
        <div className="grid min-w-0 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className={cn("min-w-0 space-y-3", selectedId && "hidden lg:block")}>
            <div data-tour-id={TOUR_TARGET_IDS.MESSAGES_SEARCH} className="relative">
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

            <nav
              data-tour-id={TOUR_TARGET_IDS.MESSAGES_FILTERS}
              className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4"
              aria-label="Message filters"
            >
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
              <section data-tour-id={TOUR_TARGET_IDS.MESSAGES_PINNED} aria-label="Pinned conversations">
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
                <ul className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 pt-1">
                  {pinnedConversations.map((conversation) => (
                    <li key={conversation.id} className="shrink-0">
                      <div className="relative w-[64px]">
                        <button
                          type="button"
                          onClick={() => openConversation(conversation.id)}
                          className="focus-ring safe-motion flex w-full flex-col items-center gap-1.5 rounded-xl text-center"
                          aria-label={`Open ${conversation.title}`}
                        >
                          <GlowAvatar name={conversation.title} src={conversation.avatarUrl} size="md" membershipTier={publicMembershipTier(conversation.otherPlan)} />
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
              <ul data-tour-id={TOUR_TARGET_IDS.MESSAGES_CONVERSATIONS} className="space-y-1.5">
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
                        <GlowAvatar name={conversation.title} src={conversation.avatarUrl} size="sm" membershipTier={publicMembershipTier(conversation.otherPlan)} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-semibold">{conversation.title}</span>
                            <PremiumPlanBadge plan={conversation.otherPlan} compact />
                            <TrustedMemberMark trustedSince={conversation.otherTrustedSince} compact />
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
              // Mobile: the conversation IS the screen — full height, no card,
              // no border, nothing containing it. Desktop keeps the panel so
              // the two-pane layout still reads as one surface.
              "flex min-w-0 flex-col",
              "conversation-canvas fixed inset-0 z-30 h-[100dvh] lg:static lg:z-auto",
              "lg:h-[calc(100dvh-13rem)] lg:max-h-[720px] lg:min-h-[420px] lg:rounded-2xl lg:border lg:border-border/70 lg:bg-card/40",
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
                <div
                  data-tour-id={TOUR_TARGET_IDS.MESSAGES_CHAT_HEADER}
                  className="flex min-h-[64px] shrink-0 items-center gap-2.5 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] lg:pt-0"
                >
                  <button
                    type="button"
                    onClick={closeConversation}
                    aria-label="Back to conversations"
                    title="Back to conversations"
                    className="focus-ring safe-motion -ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground lg:hidden"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  {/* The identity opens the profile. A group has no single
                      person behind it, so it stays plain text rather than
                      linking somewhere that does not exist. */}
                  <ConversationIdentity
                    conversation={selected}
                    subtitle={context.subtitle}
                    subtitleIsShared={context.shared}
                  />
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
                    className="focus-ring safe-motion grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                  >
                    <VolumeX className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="flex-1 space-y-0.5 overflow-y-auto px-4 py-3">
                  {loadingMessages ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
                  ) : messages.length === 0 ? (
                    // Whitespace instead of a box: the avatar and one line, with
                    // the screen left mostly empty on purpose.
                    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                      <GlowAvatar
                        name={selected.title}
                        src={selected.avatarUrl}
                        size="lg"
                        membershipTier={publicMembershipTier(selected.otherPlan)}
                      />
                      <p className="mt-4 text-[0.9375rem] font-semibold">{selected.title}</p>
                      <p className="mt-1 max-w-[22rem] text-sm leading-relaxed text-muted-foreground">
                        {context.shared && context.subtitle
                          ? `${context.subtitle}. Say hello.`
                          : "Say hello and start the conversation."}
                      </p>
                    </div>
                  ) : (
                    messages.map((message, messageIndex) => (
                      <Fragment key={message.id}>
                        {/* Day divider: quiet, uppercase, no rule — the same
                            calm register as the system lines. */}
                        {startsNewDay(message.createdAt, messages[messageIndex - 1]?.createdAt) ? (
                          <p className="py-3 text-center text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">
                            {dayLabel(message.createdAt)}
                          </p>
                        ) : null}
                        {message.messageType === "system" ? (
                        <p className="py-2 text-center text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                          {message.text}
                        </p>
                      ) : (
                        <div
                          className={cn(
                            "group flex",
                            message.isMine ? "justify-end" : "justify-start",
                            // Air between speakers, tight within one run.
                            startsNewRun(message, messages[messageIndex - 1]) ? "mt-3 first:mt-0" : "mt-0.5"
                          )}
                        >
                          <div className={cn("max-w-[78%]", message.isMine && "flex flex-col items-end")}>
                            <div
                              className={cn(
                                "px-3.5 py-2 text-[0.9375rem] leading-snug",
                                // Soft, generous corners; the trailing corner
                                // tightens on the last of a run so a run reads
                                // as one shape rather than separate pills.
                                "rounded-[1.25rem]",
                                message.isMine
                                  ? "bg-primary text-white shadow-[0_1px_2px_hsl(var(--shadow)/0.10)]"
                                  : "bg-secondary/70 text-foreground"
                              )}
                            >
                              {!message.deleted && message.attachment ? (
                                <MessageAttachmentImage
                                  conversationId={selected.id}
                                  message={message}
                                  onOpen={() => setViewerMessageId(message.id)}
                                  onRefreshed={(attachment) => updateMessageAttachment(message.id, attachment)}
                                />
                              ) : null}
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
                                <p className={cn("whitespace-pre-wrap", message.deleted && "italic opacity-70")}>
                                  {message.deleted
                                    ? DELETED_MESSAGE_PLACEHOLDER
                                    : message.quickActionType
                                      ? quickActionLabel(message.quickActionType)
                                      : message.text ?? (message.attachment ? null : "Message")}
                                </p>
                              )}
                              {/* One timestamp per run, on its last message:
                                  repeating it on every line is what made the
                                  thread feel like a table of records. */}
                              {startsNewRun(messages[messageIndex + 1] ?? { isMine: !message.isMine, createdAt: message.createdAt }, message) ? (
                                <p
                                  className={cn(
                                    "mt-1 text-[0.625rem] font-medium",
                                    message.isMine ? "text-white/65" : "text-muted-foreground/80"
                                  )}
                                >
                                  {formatRelativeTime(message.createdAt)}
                                  {message.editedAt ? " · edited" : ""}
                                  {message.isMine ? ` · ${stateLabel(message.state)}` : ""}
                                </p>
                              ) : null}
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
                        )}
                      </Fragment>
                    ))
                  )}
                </div>

                {/* Quick coordination actions (spec §39), no location attached. */}
                <div
                  data-tour-id={TOUR_TARGET_IDS.MESSAGES_QUICK_REPLIES}
                  className="flex shrink-0 flex-wrap gap-1.5 px-4 pb-1 pt-2"
                >
                  {QUICK_ACTIONS.slice(0, 3).map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => sendQuickAction(action.id)}
                      disabled={isPending}
                      className="focus-ring safe-motion rounded-full bg-secondary/60 px-3 py-1.5 text-[0.75rem] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground active:scale-[0.97] motion-reduce:active:scale-100"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>

                <div
                  data-tour-id={TOUR_TARGET_IDS.MESSAGES_COMPOSER}
                  className="shrink-0"
                >
                  <MessageComposer
                    key={selected.id}
                    conversationId={selected.id}
                    placeholder={`Message ${selected.title}`}
                    onFeedback={setFeedback}
                    onSent={async () => {
                      await refreshMessages(selected.id);
                      router.refresh();
                    }}
                    className="w-full border-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:pb-0"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <NewMessageModal open={newMessageOpen} onOpenChange={setNewMessageOpen} onSelect={startConversationWith} />
      <MessageMediaViewer
        message={messages.find((message) => message.id === viewerMessageId) ?? null}
        open={Boolean(viewerMessageId)}
        onClose={() => setViewerMessageId(null)}
      />
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

/**
 * The person (or group) this conversation is with.
 *
 * Links to the existing /friends/[username] profile when there is one — the
 * same route the Muddies list uses, not a new destination. Groups and any
 * conversation without a resolved username render the identical markup
 * without a link, so the header never points at a profile that is not there.
 */
function ConversationIdentity({
  conversation,
  subtitle,
  subtitleIsShared
}: {
  conversation: ConversationView;
  subtitle: string | null;
  subtitleIsShared: boolean;
}) {
  const body = (
    <>
      <GlowAvatar
        name={conversation.title}
        src={conversation.avatarUrl}
        size="sm"
        membershipTier={publicMembershipTier(conversation.otherPlan)}
      />
      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[0.9375rem] font-semibold leading-tight">{conversation.title}</span>
          <PremiumPlanBadge plan={conversation.otherPlan} compact />
          {/* THE DM identity surface.
              A direct chat has one other person, established once at the top,
              so the mark belongs here and nowhere else in the thread. Putting
              it on every bubble would repeat a fact that does not change
              between messages — which is why groups differ: there, the sender
              changes line to line, so the mark travels with the sender. */}
          <TrustedMemberMark trustedSince={conversation.otherTrustedSince} compact />
        </span>
        {/* Why this conversation exists — a shared plan, an event — or the
            handle. Never a guessed distance or availability. */}
        {subtitle ? (
          <span
            className={cn(
              "truncate text-[0.6875rem] font-medium leading-tight",
              subtitleIsShared ? "text-[var(--color-brand-orange)]" : "text-muted-foreground"
            )}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </>
  );

  if (!conversation.otherUsername) {
    return <span className="flex min-w-0 flex-1 items-center gap-2.5">{body}</span>;
  }

  return (
    <Link
      href={`/friends/${conversation.otherUsername}` as Route}
      prefetch={false}
      aria-label={`View ${conversation.title}'s profile`}
      className="focus-ring safe-motion -mx-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-1 py-1 transition-colors hover:bg-secondary/50 active:bg-secondary/70"
    >
      {body}
    </Link>
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
                  <GlowAvatar name={conversation.title} src={conversation.avatarUrl} size="sm" membershipTier={publicMembershipTier(conversation.otherPlan)} />
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
                  <GlowAvatar name={friend.displayName} src={friend.avatarUrl} size="sm" membershipTier={publicMembershipTier(friend.plan)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="block truncate text-sm font-semibold">{friend.displayName}</span>
                      <PremiumPlanBadge plan={friend.plan} compact />
                    </span>
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
