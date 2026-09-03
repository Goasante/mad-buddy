"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BellOff,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  EllipsisVertical,
  Loader2,
  MessageCircle,
  MessagesSquare,
  PenSquare,
  Search,
  Star,
  UsersRound,
  X
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  deleteMessageAction,
  editMessageAction,
  getConversationsAction,
  getMessageableFriendsAction,
  getMessagesAction,
  getMentionCandidatesAction,
  markConversationReadAction,
  muteConversationAction,
  openDirectConversationAction,
  reactToMessageAction,
  sendMessageAction,
  setConversationHiddenAction,
  setConversationPinnedAction
} from "@/app/(app)/messaging-actions";
import { useImmersiveWhile } from "@/components/app-shell/immersive-mode";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { MessageActionsMenu } from "@/components/messaging/message-actions-menu";
import { MessageAttachmentImage } from "@/components/messaging/message-attachment-image";
import { MessageComposer, type OptimisticSendDraft } from "@/components/messaging/message-composer";
import { MessageMediaViewer } from "@/components/messaging/message-media-viewer";
import { VoiceMessageBubble } from "@/components/messaging/voice-message-bubble";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { SafeMessageText } from "@/components/messages/safe-message-text";
import { TrustedMemberMark } from "@/components/trust/trusted-member-mark";
import { VerifiedAccountMark } from "@/components/trust/verified-account-mark";
import { AppMenu } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useDismissOnBack } from "@/hooks/use-dismiss-on-back";
import { MESSAGES_UPDATED_EVENT } from "@/hooks/use-unread-message-count";
import {
  conversationContext,
  dayLabel,
  startsNewDay,
  startsNewRun
} from "@/lib/messaging/conversation-presence";
import { mergeConversations } from "@/lib/messaging/conversation-sync";
import type { AttachmentView } from "@/lib/messaging/attachments";
import type { MessageActionId } from "@/lib/messaging/message-actions";
import type { ChatMessageView, ConversationView, MessageableFriend } from "@/lib/messaging/mobile";
import type { MentionCandidate } from "@/lib/messaging/mentions";
import {
  discardOptimistic,
  markFailed,
  markRetrying,
  pruneConfirmed,
  type OptimisticMessage
} from "@/lib/messaging/optimistic-messages";
import {
  eligibleQuickActions,
  type ConversationContext,
  type MeetingPhase
} from "@/lib/messaging/quick-action-eligibility";
import { QUICK_ACTIONS, DELETED_MESSAGE_PLACEHOLDER } from "@/lib/messaging/rules";
import type { VoiceRecorderConfig } from "@/lib/messaging/voice-recording";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
import { authenticateRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import { cn, formatRelativeTime } from "@/lib/utils";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "favorites", label: "Favorites" },
  { id: "groups", label: "Groups" },
  { id: "plans", label: "Plans" }
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

const REACTIONS = [
  { id: "heart", emoji: "❤️" },
  { id: "laugh", emoji: "😂" },
  { id: "thumbs_up", emoji: "👍" },
  { id: "wave", emoji: "👋" },
  { id: "fire", emoji: "🔥" },
  { id: "wow", emoji: "😮" }
] as const;

const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLikelyConversationId(value: string | null): value is string {
  return Boolean(value) && CONVERSATION_ID.test(value as string);
}

function messageFailure(error: unknown) {
  return isRequestTimeoutError(error)
    ? "Messages took too long to respond. Try again."
    : "Messages could not be updated. Try again.";
}

function reactionEmoji(id: string | null): string | null {
  return REACTIONS.find((reaction) => reaction.id === id)?.emoji ?? null;
}

function stateIcon(state: string) {
  if (state === "seen") return <CheckCheck className="h-3.5 w-3.5 text-[#E88C2B]" aria-label="Seen" />;
  if (state === "delivered") return <CheckCheck className="h-3.5 w-3.5" aria-label="Delivered" />;
  if (state === "sent") return <Check className="h-3.5 w-3.5" aria-label="Sent" />;
  return null;
}

function planLabel(conversation: ConversationView) {
  if (!conversation.planStartAt) return conversation.contextBadge ?? null;
  const date = new Date(conversation.planStartAt);
  if (Number.isNaN(date.getTime())) return conversation.contextBadge ?? null;
  return `${conversation.contextBadge ?? "Plan"} · ${new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date)}`;
}

export function MessagesPageV2({
  initialConversations = [],
  voiceRecorderConfig = { enabled: false, maxDurationSeconds: 0 }
}: {
  initialConversations?: ConversationView[];
  voiceRecorderConfig?: VoiceRecorderConfig;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedConversationId = searchParams.get("conversation");

  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    isLikelyConversationId(requestedConversationId) ? requestedConversationId : null
  );
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterId>("all");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadQuery, setThreadQuery] = useState("");
  const [viewerMessageId, setViewerMessageId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);
  const [isPending, startTransition] = useTransition();

  const retryDraftsRef = useRef<Map<string, OptimisticSendDraft>>(new Map());
  const locallyReadIds = useRef<Set<string>>(new Set());
  const pendingConversationIds = useRef<Set<string>>(new Set());
  const openedRequestedConversation = useRef(false);
  const loadRequestIdRef = useRef(0);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const [actionsNowMs, setActionsNowMs] = useState(() => Date.now());

  useDismissOnBack(threadSearchOpen, () => {
    setThreadSearchOpen(false);
    setThreadQuery("");
  });
  useImmersiveWhile(Boolean(selectedId));

  const syncConversations = useCallback(async () => {
    try {
      const server = await withTimeout(getConversationsAction(), { operation: "refresh conversations" });
      setConversations((current) =>
        mergeConversations(current, server, {
          locallyReadIds: locallyReadIds.current,
          pendingIds: pendingConversationIds.current
        })
      );
      for (const row of server) pendingConversationIds.current.delete(row.id);
    } catch {
      // Keep the visible inbox if a background refresh fails.
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
      setActionsNowMs(Date.now());
      const people = await getMentionCandidatesAction(conversationId).catch(() => []);
      if (requestId === loadRequestIdRef.current) setMentionCandidates(people);

      const readResult = await withTimeout(markConversationReadAction(conversationId), {
        operation: "mark conversation read"
      });
      if (requestId !== loadRequestIdRef.current) return;
      if (!readResult.ok) setFeedback(readResult.message);
      locallyReadIds.current.add(conversationId);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation
        )
      );
      window.dispatchEvent(new Event(MESSAGES_UPDATED_EVENT));
    } catch (error) {
      if (requestId === loadRequestIdRef.current) setFeedback(messageFailure(error));
    } finally {
      if (requestId === loadRequestIdRef.current) setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    void syncConversations();
  }, [syncConversations]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const resync = () => {
      if (document.visibilityState === "visible") void syncConversations();
    };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    return () => {
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
    };
  }, [syncConversations]);

  useEffect(() => {
    if (openedRequestedConversation.current || !isLikelyConversationId(requestedConversationId)) return;
    openedRequestedConversation.current = true;
    setSelectedId(requestedConversationId);
    setMessages([]);
    void loadConversation(requestedConversationId);
    void syncConversations();
  }, [loadConversation, requestedConversationId, syncConversations]);

  useEffect(() => {
    if (!selectedId) return;
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const channel = supabase
      .channel(`messages-v2:${selectedId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${selectedId}` },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            if (disposed) return;
            void refreshMessages(selectedId).then(() => {
              window.dispatchEvent(new Event(MESSAGES_UPDATED_EVENT));
              void syncConversations();
            });
          }, 140);
        }
      );

    void authenticateRealtime(supabase).then(() => {
      if (!disposed) channel.subscribe();
    });

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [refreshMessages, selectedId, syncConversations]);

  useEffect(() => {
    if (!selectedId || loadingMessages) return;
    requestAnimationFrame(() => {
      const node = threadRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
  }, [selectedId, loadingMessages]);

  const uniqueConversations = useMemo(() => {
    const seen = new Set<string>();
    return conversations.filter((conversation) => {
      if (seen.has(conversation.id)) return false;
      seen.add(conversation.id);
      return true;
    });
  }, [conversations]);

  const selected = uniqueConversations.find((conversation) => conversation.id === selectedId) ?? null;
  const selectedContext = selected ? conversationContext(selected) : { subtitle: null, shared: false };
  const hasMultipleSpeakers = Boolean(selected && selected.kind !== "direct");

  const unreadCount = useMemo(
    () => uniqueConversations.filter((conversation) => conversation.unreadCount > 0).length,
    [uniqueConversations]
  );

  const filteredConversations = useMemo(() => {
    const term = query.trim().toLowerCase();
    return uniqueConversations.filter((conversation) => {
      if (activeFilter === "unread" && conversation.unreadCount === 0) return false;
      if (activeFilter === "favorites" && !conversation.pinned) return false;
      if (activeFilter === "groups" && conversation.kind !== "group") return false;
      if (activeFilter === "plans" && conversation.kind !== "plan") return false;
      if (term) {
        const haystack = `${conversation.title} ${conversation.lastMessagePreview ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [activeFilter, query, uniqueConversations]);

  const pendingMessages = useMemo(() => pruneConfirmed(optimistic, messages), [optimistic, messages]);

  const visibleQuickActions = useMemo(() => {
    const context: ConversationContext =
      selected?.contextBadge === "Plan"
        ? "plan"
        : selected?.contextBadge === "Event"
          ? "event"
          : selected?.contextBadge === "Safe Arrival"
            ? "safe_arrival"
            : "none";
    const phase: MeetingPhase =
      selected?.planPhase === "upcoming"
        ? "upcoming"
        : selected?.planPhase === "near_start"
          ? "near_start"
          : selected?.planPhase === "active"
            ? "active"
            : selected?.planPhase === "past" || selected?.planPhase === "archived_unscheduled"
              ? "ended"
              : selected?.planPhase === "unscheduled"
                ? "undated"
                : "active";
    const allowed = new Set(
      eligibleQuickActions({
        context,
        phase,
        actionIds: QUICK_ACTIONS.map((action) => action.id)
      })
    );
    return QUICK_ACTIONS.filter((action) => allowed.has(action.id)).slice(0, 3);
  }, [selected]);

  const matchingMessageIds = useMemo(() => {
    const term = threadQuery.trim().toLowerCase();
    if (!term) return new Set<string>();
    return new Set(
      messages
        .filter((message) => (message.text ?? "").toLowerCase().includes(term))
        .map((message) => message.id)
    );
  }, [messages, threadQuery]);

  function openConversation(conversationId: string) {
    setSelectedId(conversationId);
    setMessages([]);
    setOptimistic([]);
    retryDraftsRef.current.clear();
    setThreadSearchOpen(false);
    setThreadQuery("");
    void loadConversation(conversationId);
  }

  const dismissConversation = useCallback(() => {
    openedRequestedConversation.current = true;
    setSelectedId(null);
    setMessages([]);
    setMentionCandidates([]);
    setThreadSearchOpen(false);
    setThreadQuery("");
    if (requestedConversationId) router.replace("/messages", { scroll: false });
  }, [requestedConversationId, router]);

  useEffect(() => {
    if (!selectedId || typeof window === "undefined") return;
    window.history.pushState({ ...window.history.state, mbMessagingV2Conversation: true }, "");
    const handlePopState = (event: PopStateEvent) => {
      if (event.state?.mbMessagingV2Conversation) return;
      dismissConversation();
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (window.history.state?.mbMessagingV2Conversation) {
        const nextState = { ...window.history.state };
        delete nextState.mbMessagingV2Conversation;
        window.history.replaceState(nextState, "");
      }
    };
  }, [dismissConversation, selectedId]);

  const closeConversation = useCallback(() => {
    if (typeof window !== "undefined" && window.history.state?.mbMessagingV2Conversation) {
      window.history.back();
      return;
    }
    dismissConversation();
  }, [dismissConversation]);

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
        pendingConversationIds.current.add(result.conversationId);
        openConversation(result.conversationId);
        await syncConversations();
      } catch (error) {
        setFeedback(messageFailure(error));
      }
    });
  }

  function toggleFavorite(conversation: ConversationView) {
    const next = !conversation.pinned;
    setConversations((current) =>
      current.map((row) => (row.id === conversation.id ? { ...row, pinned: next } : row))
    );
    startTransition(async () => {
      try {
        const result = await withTimeout(setConversationPinnedAction(conversation.id, next), {
          operation: "favorite conversation"
        });
        if (!result.ok) {
          setFeedback(result.message);
          setConversations((current) =>
            current.map((row) => (row.id === conversation.id ? { ...row, pinned: !next } : row))
          );
        }
      } catch (error) {
        setFeedback(messageFailure(error));
        setConversations((current) =>
          current.map((row) => (row.id === conversation.id ? { ...row, pinned: !next } : row))
        );
      }
    });
  }

  function toggleMute(conversation: ConversationView) {
    startTransition(async () => {
      try {
        const result = await withTimeout(muteConversationAction(conversation.id, conversation.muted ? 0 : 8), {
          operation: "mute conversation"
        });
        if (!result.ok) {
          setFeedback(result.message);
          return;
        }
        setConversations((current) =>
          current.map((row) =>
            row.id === conversation.id ? { ...row, muted: !conversation.muted } : row
          )
        );
      } catch (error) {
        setFeedback(messageFailure(error));
      }
    });
  }

  function hideConversation(conversation: ConversationView) {
    const previous = conversations;
    setConversations((current) => current.filter((row) => row.id !== conversation.id));
    if (selectedId === conversation.id) closeConversation();
    startTransition(async () => {
      try {
        const result = await withTimeout(setConversationHiddenAction(conversation.id, true), {
          operation: "hide conversation"
        });
        if (!result.ok) {
          setConversations(previous);
          setFeedback(result.message);
        }
      } catch (error) {
        setConversations(previous);
        setFeedback(messageFailure(error));
      }
    });
  }

  const addOptimistic = useCallback((draft: OptimisticSendDraft) => {
    retryDraftsRef.current.set(draft.clientMessageId, draft);
    setOptimistic((current) => [
      ...current.filter((message) => message.clientMessageId !== draft.clientMessageId),
      {
        clientMessageId: draft.clientMessageId,
        text: draft.text,
        kind: draft.kind,
        durationSeconds: draft.durationSeconds,
        createdAt: new Date().toISOString(),
        status: "pending"
      }
    ]);
  }, []);

  const settleOptimistic = useCallback((clientMessageId: string, outcome: "sent" | "failed" | "pending") => {
    setOptimistic((current) =>
      outcome === "pending" ? current : outcome === "failed" ? markFailed(current, clientMessageId) : markRetrying(current, clientMessageId)
    );
  }, []);

  function retryOptimistic(clientMessageId: string) {
    const draft = retryDraftsRef.current.get(clientMessageId);
    if (!draft || !selectedId || draft.kind !== "text") return;
    setOptimistic((current) => markRetrying(current, clientMessageId));
    startTransition(async () => {
      try {
        const result = await withTimeout(
          sendMessageAction({
            conversationId: selectedId,
            text: draft.text ?? "",
            clientMessageId
          }),
          { operation: "retry message" }
        );
        if (!result.ok) {
          setOptimistic((current) => markFailed(current, clientMessageId));
          setFeedback(result.message);
          return;
        }
        await refreshMessages(selectedId);
        await syncConversations();
      } catch (error) {
        setOptimistic((current) => markFailed(current, clientMessageId));
        setFeedback(messageFailure(error));
      }
    });
  }

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
    const existingMentions = messages.find((message) => message.id === messageId)?.mentions ?? [];
    startTransition(async () => {
      try {
        const result = await withTimeout(
          editMessageAction(messageId, editDraft.trim(), existingMentions.map((mention) => mention.userId)),
          { operation: "edit message" }
        );
        if (!result.ok) setFeedback(result.message);
        setEditingId(null);
        await refreshMessages(selectedId);
        await syncConversations();
      } catch (error) {
        setFeedback(messageFailure(error));
      }
    });
  }

  function removeMessage(messageId: string, forEveryone = true) {
    if (!selectedId) return;
    startTransition(async () => {
      try {
        const result = await withTimeout(deleteMessageAction(messageId, forEveryone), {
          operation: "delete message"
        });
        if (!result.ok) setFeedback(result.message);
        await refreshMessages(selectedId);
        await syncConversations();
      } catch (error) {
        setFeedback(messageFailure(error));
      }
    });
  }

  function runMessageAction(action: MessageActionId, message: ChatMessageView) {
    if (action === "copy") {
      void navigator.clipboard?.writeText(message.text ?? "");
      return;
    }
    if (action === "react") {
      setReactingId(message.id);
      return;
    }
    if (action === "edit") {
      setEditingId(message.id);
      setEditDraft(message.text ?? "");
      return;
    }
    if (action === "delete_for_me") {
      removeMessage(message.id, false);
      return;
    }
    if (action === "delete_for_everyone") removeMessage(message.id, true);
  }

  function sendQuickAction(quickActionType: string) {
    if (!selectedId) return;
    const clientMessageId = crypto.randomUUID();
    startTransition(async () => {
      try {
        const result = await withTimeout(
          sendMessageAction({ conversationId: selectedId, quickActionType, clientMessageId }),
          { operation: "send quick action" }
        );
        if (!result.ok) {
          setFeedback(result.message);
          return;
        }
        await refreshMessages(selectedId);
        await syncConversations();
      } catch (error) {
        setFeedback(messageFailure(error));
      }
    });
  }

  const updateMessageAttachment = useCallback((messageId: string, attachment: AttachmentView) => {
    setMessages((current) =>
      current.map((message) => (message.id === messageId ? { ...message, attachment } : message))
    );
  }, []);

  const threadMenuItems = selected
    ? [
        {
          id: "favorite",
          label: selected.pinned ? "Remove from favorites" : "Add to favorites",
          onSelect: () => toggleFavorite(selected)
        },
        {
          id: "mute",
          label: selected.muted ? "Unmute" : "Mute for 8 hours",
          onSelect: () => toggleMute(selected)
        },
        ...(selected.kind === "group"
          ? [
              {
                id: "group",
                label: "Group details",
                onSelect: () => router.push(`/groups/${selected.id}` as Route)
              }
            ]
          : []),
        ...(selected.kind === "plan" && selected.planId
          ? [
              {
                id: "plan",
                label: "Open plan",
                onSelect: () => router.push(`/plans/${selected.planId}` as Route)
              }
            ]
          : []),
        ...(selected.otherUsername
          ? [
              {
                id: "profile",
                label: "View profile",
                onSelect: () => router.push(`/friends/${selected.otherUsername}` as Route)
              }
            ]
          : []),
        ...(selected.kind === "direct"
          ? [
              {
                id: "hide",
                label: "Hide chat",
                onSelect: () => hideConversation(selected)
              }
            ]
          : [])
      ]
    : [];

  return (
    <div
      data-tour-id={TOUR_TARGET_IDS.MESSAGES_INBOX}
      className="mx-auto w-full max-w-[1240px] pb-4 md:px-2 md:pt-5"
    >
      {feedback ? (
        <div
          role="status"
          className="mb-3 rounded-2xl border border-[#E88C2B]/20 bg-[#E88C2B]/10 px-4 py-3 text-sm text-[#4E0401] dark:text-orange-100"
        >
          {feedback}
        </div>
      ) : null}

      {uniqueConversations.length === 0 ? (
        <section className="rounded-[28px] border border-border/60 bg-card/70 p-5 shadow-sm">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#E88C2B]">Mad Buddy</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">Messages</h1>
            </div>
            <button
              type="button"
              onClick={() => setNewMessageOpen(true)}
              className="focus-ring grid h-12 w-12 place-items-center rounded-full bg-[#E88C2B] text-white shadow-[0_8px_24px_rgba(232,140,43,0.28)]"
              aria-label="New message"
            >
              <PenSquare className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <EmptyState
            icon={MessagesSquare}
            title="Your conversations will live here"
            description="Message a Muddy, join a Group, or make a Plan and its conversation will appear here."
            action={
              <Button type="button" onClick={() => setNewMessageOpen(true)}>
                <PenSquare className="h-4 w-4" aria-hidden="true" />
                New message
              </Button>
            }
          />
        </section>
      ) : (
        <div className="grid min-h-[620px] overflow-hidden md:rounded-[30px] md:border md:border-border/60 md:bg-card/45 md:shadow-[0_24px_80px_rgba(78,4,1,0.08)] lg:grid-cols-[390px_minmax(0,1fr)]">
          <aside
            className={cn(
              "min-w-0 bg-[#FEFBF3] dark:bg-background lg:border-r lg:border-border/60",
              selectedId && "hidden lg:flex lg:flex-col"
            )}
          >
            <div className="sticky top-0 z-10 border-b border-black/[0.04] bg-[#FEFBF3]/95 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-xl dark:border-white/[0.06] dark:bg-background/95 md:px-5 md:pt-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-[#4E0401] text-[#FEFBF3] shadow-sm">
                      <MessageCircle className="h-4.5 w-4.5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#E88C2B]">Mad Buddy</p>
                      <h1 className="text-[1.7rem] font-semibold leading-none tracking-[-0.035em]">Messages</h1>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setNewMessageOpen(true)}
                  className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#E88C2B] text-white shadow-[0_8px_22px_rgba(232,140,43,0.28)] transition-transform active:scale-95"
                  aria-label="New message"
                  title="New message"
                >
                  <PenSquare className="h-4.5 w-4.5" aria-hidden="true" />
                </button>
              </div>

              <div data-tour-id={TOUR_TARGET_IDS.MESSAGES_SEARCH} className="relative mt-4">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search conversations"
                  aria-label="Search conversations"
                  className="h-11 rounded-2xl border-transparent bg-black/[0.035] pl-10 shadow-none placeholder:text-muted-foreground/70 focus-visible:border-[#E88C2B]/30 focus-visible:ring-[#E88C2B]/15 dark:bg-white/[0.055]"
                />
              </div>

              <nav
                data-tour-id={TOUR_TARGET_IDS.MESSAGES_FILTERS}
                aria-label="Message filters"
                className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1"
              >
                {FILTERS.map((filter) => {
                  const active = activeFilter === filter.id;
                  const showUnread = filter.id === "unread" && unreadCount > 0;
                  return (
                    <button
                      key={filter.id}
                      type="button"
                      onClick={() => setActiveFilter(filter.id)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "focus-ring inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition",
                        active
                          ? "border-[#E88C2B]/35 bg-[#E88C2B]/12 text-[#4E0401] shadow-sm dark:text-orange-100"
                          : "border-black/[0.06] bg-white/60 text-muted-foreground hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.03]"
                      )}
                    >
                      {filter.label}
                      {showUnread ? (
                        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#E88C2B] px-1 text-[10px] font-bold text-white">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 md:px-3">
              {filteredConversations.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <p className="text-sm font-semibold">No conversations found</p>
                  <p className="mt-1 text-sm text-muted-foreground">Try another filter or search term.</p>
                </div>
              ) : (
                <ul data-tour-id={TOUR_TARGET_IDS.MESSAGES_CONVERSATIONS} className="space-y-1">
                  {filteredConversations.map((conversation) => {
                    const active = selectedId === conversation.id;
                    return (
                      <li key={conversation.id}>
                        <div
                          className={cn(
                            "group relative flex items-center rounded-[20px] transition",
                            active ? "bg-white shadow-sm dark:bg-white/[0.06]" : "hover:bg-white/70 dark:hover:bg-white/[0.035]"
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => openConversation(conversation.id)}
                            className="focus-ring flex min-h-[76px] min-w-0 flex-1 items-center gap-3 rounded-[20px] px-3 py-2.5 text-left"
                            aria-current={active}
                          >
                            <div className="relative shrink-0">
                              <GlowAvatar
                                name={conversation.title}
                                src={conversation.avatarUrl}
                                size="sm"
                              />
                              {conversation.kind === "group" ? (
                                <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border-2 border-[#FEFBF3] bg-[#4E0401] text-[#FEFBF3] dark:border-background">
                                  <UsersRound className="h-2.5 w-2.5" aria-hidden="true" />
                                </span>
                              ) : null}
                            </div>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className={cn("truncate text-[0.95rem]", conversation.unreadCount > 0 ? "font-bold" : "font-semibold")}>{conversation.title}</span>
                                <PremiumPlanBadge plan={conversation.otherPlan} compact />
                                <TrustedMemberMark trustedSince={conversation.otherTrustedSince} compact />
                                <VerifiedAccountMark isVerifiedAccount={conversation.otherIsVerifiedAccount} compact />
                                {conversation.pinned ? <Star className="h-3 w-3 shrink-0 fill-[#E88C2B] text-[#E88C2B]" aria-label="Favorite" /> : null}
                                {conversation.muted ? <BellOff className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Muted" /> : null}
                              </span>
                              <span className={cn("mt-1 block truncate text-[0.82rem]", conversation.unreadCount > 0 ? "font-medium text-foreground/75" : "text-muted-foreground")}>{conversation.lastMessagePreview ?? "No messages yet"}</span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1.5 pl-1">
                              <span className={cn("text-[10px]", conversation.unreadCount > 0 ? "font-semibold text-[#E88C2B]" : "text-muted-foreground")}>{conversation.lastMessageAt ? formatRelativeTime(conversation.lastMessageAt) : ""}</span>
                              {conversation.unreadCount > 0 ? (
                                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#E88C2B] px-1.5 text-[10px] font-bold text-white" aria-label={`${conversation.unreadCount} unread`}>
                                  {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                                </span>
                              ) : null}
                            </span>
                          </button>

                          <AppMenu
                            label={`Actions for ${conversation.title}`}
                            side="bottom"
                            align="end"
                            items={[
                              { id: "favorite", label: conversation.pinned ? "Remove favorite" : "Favorite", onSelect: () => toggleFavorite(conversation) },
                              { id: "mute", label: conversation.muted ? "Unmute" : "Mute for 8 hours", onSelect: () => toggleMute(conversation) },
                              ...(conversation.kind === "group"
                                ? [{ id: "group", label: "Group details", onSelect: () => router.push(`/groups/${conversation.id}` as Route) }]
                                : conversation.otherUsername
                                  ? [{ id: "profile", label: "View profile", onSelect: () => router.push(`/friends/${conversation.otherUsername}` as Route) }]
                                  : []),
                              ...(conversation.kind === "direct" ? [{ id: "hide", label: "Hide chat", onSelect: () => hideConversation(conversation) }] : [])
                            ]}
                            trigger={
                              <button
                                type="button"
                                className="focus-ring mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
                                aria-label={`Actions for ${conversation.title}`}
                              >
                                <EllipsisVertical className="h-4 w-4" aria-hidden="true" />
                              </button>
                            }
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          <main
            className={cn(
              "min-w-0 bg-[#FFFDFC] dark:bg-background",
              "fixed inset-0 z-30 flex h-[100dvh] flex-col lg:static lg:z-auto lg:h-[min(780px,calc(100dvh-9rem))]",
              !selectedId && "hidden lg:flex"
            )}
          >
            {!selected ? (
              <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
                {selectedId ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin text-[#E88C2B] motion-reduce:animate-none" aria-hidden="true" />
                    <p className="mt-3 text-sm font-semibold">Opening conversation…</p>
                    <Button type="button" variant="outline" className="mt-4" onClick={closeConversation}>Back</Button>
                  </>
                ) : (
                  <>
                    <div className="grid h-20 w-20 place-items-center rounded-[28px] bg-[#E88C2B]/10 text-[#E88C2B] shadow-inner">
                      <MessagesSquare className="h-8 w-8" aria-hidden="true" />
                    </div>
                    <h2 className="mt-5 text-xl font-semibold tracking-tight">Choose a conversation</h2>
                    <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Message a Muddy, keep a Group moving, or continue a Plan chat without leaving Messages.</p>
                  </>
                )}
              </div>
            ) : (
              <>
                <header data-tour-id={TOUR_TARGET_IDS.MESSAGES_CHAT_HEADER} className="shrink-0 border-b border-black/[0.05] bg-[#FFFDFC]/95 pt-[env(safe-area-inset-top)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-background/95 lg:pt-0">
                  <div className="flex min-h-[68px] items-center gap-2 px-2.5 md:px-4">
                    <button type="button" onClick={closeConversation} aria-label="Back to messages" className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.06] lg:hidden">
                      <ArrowLeft className="h-5 w-5" aria-hidden="true" />
                    </button>

                    <ConversationIdentityV2 conversation={selected} subtitle={selectedContext.subtitle} subtitleIsShared={selectedContext.shared} />

                    <button
                      type="button"
                      onClick={() => {
                        setThreadSearchOpen((open) => !open);
                        if (threadSearchOpen) setThreadQuery("");
                      }}
                      className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"
                      aria-label="Search conversation"
                    >
                      <Search className="h-4.5 w-4.5" aria-hidden="true" />
                    </button>

                    <AppMenu
                      label="Conversation options"
                      side="bottom"
                      align="end"
                      items={threadMenuItems}
                      trigger={
                        <button type="button" className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]" aria-label="Conversation options">
                          <EllipsisVertical className="h-4.5 w-4.5" aria-hidden="true" />
                        </button>
                      }
                    />
                  </div>

                  {threadSearchOpen ? (
                    <div className="flex items-center gap-2 px-3 pb-3 md:px-4">
                      <div className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input autoFocus value={threadQuery} onChange={(event) => setThreadQuery(event.target.value)} placeholder={`Search ${selected.title}`} className="h-10 rounded-2xl border-transparent bg-black/[0.04] pl-10 shadow-none dark:bg-white/[0.055]" />
                      </div>
                      {threadQuery.trim() ? <span className="shrink-0 text-xs font-medium text-muted-foreground">{matchingMessageIds.size} found</span> : null}
                      <button type="button" onClick={() => { setThreadSearchOpen(false); setThreadQuery(""); }} className="focus-ring grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" aria-label="Close search"><X className="h-4 w-4" /></button>
                    </div>
                  ) : null}
                </header>

                {selected.contextBadge ? (
                  <div className="shrink-0 px-3 pt-2 md:px-4">
                    <button
                      type="button"
                      onClick={() => {
                        if (selected.kind === "group") router.push(`/groups/${selected.id}` as Route);
                        else if (selected.planId) router.push(`/plans/${selected.planId}` as Route);
                      }}
                      className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-[#E88C2B]/16 bg-[#E88C2B]/8 px-3.5 py-2.5 text-left hover:bg-[#E88C2B]/12"
                    >
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-[#E88C2B]/15 text-[#E88C2B]">
                        {selected.kind === "group" ? <UsersRound className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold uppercase tracking-[0.12em] text-[#E88C2B]">{selected.contextBadge}</span>
                        <span className="block truncate text-sm font-medium text-[#4E0401] dark:text-orange-100">{planLabel(selected) ?? selectedContext.subtitle ?? "Shared conversation"}</span>
                      </span>
                      <ChevronDown className="h-4 w-4 -rotate-90 text-muted-foreground" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}

                <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-3 md:px-5 md:pt-4">
                  {loadingMessages ? (
                    <div className="grid h-full place-items-center"><Loader2 className="h-5 w-5 animate-spin text-[#E88C2B] motion-reduce:animate-none" aria-label="Loading messages" /></div>
                  ) : messages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                      <GlowAvatar name={selected.title} src={selected.avatarUrl} size="lg" />
                      <h2 className="mt-4 text-lg font-semibold">{selected.title}</h2>
                      <p className="mt-1 max-w-[22rem] text-sm leading-relaxed text-muted-foreground">{selectedContext.subtitle ? `${selectedContext.subtitle}. Say hello.` : "Say hello and start the conversation."}</p>
                    </div>
                  ) : (
                    messages.map((message, index) => {
                      const previous = messages[index - 1];
                      const startsRun = startsNewRun(message, previous);
                      const searchMatch = matchingMessageIds.has(message.id);
                      return (
                        <Fragment key={message.id}>
                          {startsNewDay(message.createdAt, previous?.createdAt) ? (
                            <div className="my-4 flex justify-center"><span className="rounded-full border border-black/[0.05] bg-white/75 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground shadow-sm dark:border-white/[0.06] dark:bg-white/[0.04]">{dayLabel(message.createdAt)}</span></div>
                          ) : null}

                          {message.messageType === "system" ? (
                            <p className="mx-auto my-3 max-w-lg text-center text-[11px] font-medium leading-relaxed text-muted-foreground/80">{message.text}</p>
                          ) : (
                            <div className={cn("flex", message.isMine ? "justify-end" : "justify-start", startsRun ? "mt-3" : "mt-1")}>
                              <div className={cn("max-w-[84%] sm:max-w-[76%]", message.isMine && "flex flex-col items-end")}>
                                {!message.isMine && hasMultipleSpeakers && startsRun ? (
                                  <div className="mb-1 flex items-center gap-2 px-1">
                                    <UserAvatar src={message.senderAvatarUrl} name={message.senderName} size="xs" decorative />
                                    <span className="text-[11px] font-semibold text-muted-foreground">{message.senderName}</span>
                                    <TrustedMemberMark trustedSince={message.senderTrustedSince} compact />
                                    <VerifiedAccountMark isVerifiedAccount={message.senderIsVerifiedAccount} compact />
                                  </div>
                                ) : null}

                                <MessageActionsMenu
                                  subject={{
                                    isMine: message.isMine,
                                    messageType: message.messageType,
                                    isDeleted: Boolean(message.deleted),
                                    createdAtMs: Date.parse(message.createdAt),
                                    text: message.text ?? null
                                  }}
                                  nowMs={actionsNowMs}
                                  onAction={(action) => runMessageAction(action, message)}
                                >
                                  <div
                                    className={cn(
                                      "relative overflow-hidden rounded-[21px] px-3.5 py-2.5 text-[0.94rem] leading-[1.42] shadow-[0_1px_2px_rgba(78,4,1,0.07)] transition",
                                      message.isMine
                                        ? "rounded-br-[7px] bg-[#4E0401] text-[#FEFBF3]"
                                        : "rounded-bl-[7px] border border-black/[0.035] bg-white text-foreground dark:border-white/[0.055] dark:bg-white/[0.07]",
                                      searchMatch && "ring-2 ring-[#E88C2B]/70 ring-offset-2 ring-offset-[#FFFDFC] dark:ring-offset-background"
                                    )}
                                  >
                                    {!message.deleted && message.attachment ? (
                                      <MessageAttachmentImage conversationId={selected.id} message={message} onOpen={() => setViewerMessageId(message.id)} onRefreshed={(attachment) => updateMessageAttachment(message.id, attachment)} />
                                    ) : null}
                                    {!message.deleted && message.voice ? (
                                      <VoiceMessageBubble conversationId={selected.id} messageId={message.id} senderName={message.isMine ? "you" : message.senderName} asset={message.voice} />
                                    ) : null}

                                    {editingId === message.id ? (
                                      <form method="post" className="flex min-w-[230px] items-center gap-2" onSubmit={(event) => { event.preventDefault(); saveEdit(message.id); }}>
                                        <Input value={editDraft} onChange={(event) => setEditDraft(event.target.value)} autoFocus maxLength={2000} className="h-8 bg-white text-foreground" aria-label="Edit message" />
                                        <Button type="submit" size="sm" disabled={!editDraft.trim() || isPending}>Save</Button>
                                      </form>
                                    ) : (
                                      <>
                                        {message.messageType === "quick_action" && message.quickActionType ? <span className="font-semibold">{QUICK_ACTIONS.find((action) => action.id === message.quickActionType)?.label ?? message.quickActionType}</span> : null}
                                        {message.text ? <SafeMessageText text={message.deleted ? DELETED_MESSAGE_PLACEHOLDER : message.text} mentions={message.mentions} /> : null}
                                        {message.editedAt && !message.deleted ? <span className={cn("ml-1 text-[10px]", message.isMine ? "text-white/55" : "text-muted-foreground")}>edited</span> : null}
                                      </>
                                    )}

                                    <div className={cn("mt-1 flex items-center justify-end gap-1 text-[9px] font-medium", message.isMine ? "text-white/55" : "text-muted-foreground/75")}>
                                      <span>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(message.createdAt))}</span>
                                      {message.isMine ? stateIcon(message.state) : null}
                                    </div>
                                  </div>
                                </MessageActionsMenu>

                                {message.myReaction ? (
                                  <button type="button" onClick={() => react(message.id, message.myReaction as string)} title="Remove reaction" className="focus-ring -mt-2 mx-2 grid h-7 min-w-7 place-items-center rounded-full border border-black/[0.06] bg-white px-1.5 text-sm shadow-sm dark:border-white/[0.08] dark:bg-[#241f1c]">{reactionEmoji(message.myReaction)}</button>
                                ) : null}

                                {reactingId === message.id ? (
                                  <div className={cn("mt-1 flex items-center gap-0.5 rounded-full border border-black/[0.05] bg-white p-1 shadow-lg dark:border-white/[0.08] dark:bg-[#241f1c]", message.isMine && "self-end")}>
                                    {REACTIONS.map((reaction) => (
                                      <button key={reaction.id} type="button" onClick={() => react(message.id, reaction.id)} className="focus-ring grid h-9 w-9 place-items-center rounded-full text-base hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" aria-label={`React ${reaction.emoji}`}>{reaction.emoji}</button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          )}
                        </Fragment>
                      );
                    })
                  )}

                  {pendingMessages.map((message) => (
                    <div key={message.clientMessageId} className="mt-2 flex flex-col items-end">
                      <div className={cn("max-w-[84%] rounded-[21px] rounded-br-[7px] bg-[#4E0401] px-3.5 py-2.5 text-[0.94rem] text-[#FEFBF3]", message.status === "pending" && "opacity-65")}>{message.kind === "voice" ? `Voice message${message.durationSeconds ? ` · ${Math.round(message.durationSeconds)}s` : ""}` : message.text}</div>
                      <div className="mt-1 flex items-center gap-2 px-1 text-[10px] font-medium text-muted-foreground">
                        {message.status === "failed" ? (
                          <><span className="text-destructive">Not sent</span><button type="button" onClick={() => retryOptimistic(message.clientMessageId)} className="focus-ring rounded underline">Retry</button><button type="button" onClick={() => setOptimistic((current) => discardOptimistic(current, message.clientMessageId))} className="focus-ring rounded underline">Delete</button></>
                        ) : <span>Sending…</span>}
                      </div>
                    </div>
                  ))}
                </div>

                {visibleQuickActions.length > 0 ? (
                  <div data-tour-id={TOUR_TARGET_IDS.MESSAGES_QUICK_REPLIES} className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto px-3 py-2 md:px-4">
                    {visibleQuickActions.map((action) => (
                      <button key={action.id} type="button" onClick={() => sendQuickAction(action.id)} disabled={isPending} className="focus-ring shrink-0 rounded-full border border-[#E88C2B]/16 bg-[#E88C2B]/8 px-3 py-1.5 text-xs font-semibold text-[#4E0401] hover:bg-[#E88C2B]/14 disabled:opacity-50 dark:text-orange-100">{action.label}</button>
                    ))}
                  </div>
                ) : null}

                <div data-tour-id={TOUR_TARGET_IDS.MESSAGES_COMPOSER} className="shrink-0 border-t border-black/[0.045] bg-[#FFFDFC]/96 backdrop-blur-xl dark:border-white/[0.06] dark:bg-background/96">
                  <MessageComposer
                    key={selected.id}
                    conversationId={selected.id}
                    isGroup={selected.kind !== "direct"}
                    mentionCandidates={mentionCandidates}
                    voiceRecorderConfig={voiceRecorderConfig}
                    placeholder={`Message ${selected.title}`}
                    onFeedback={setFeedback}
                    onOptimisticSend={addOptimistic}
                    onOptimisticSettled={settleOptimistic}
                    onSent={async () => {
                      await refreshMessages(selected.id);
                      await syncConversations();
                    }}
                    className="w-full border-0 bg-transparent pb-[max(0.6rem,env(safe-area-inset-bottom))] lg:pb-1"
                  />
                </div>
              </>
            )}
          </main>
        </div>
      )}

      <NewMessageModalV2 open={newMessageOpen} onOpenChange={setNewMessageOpen} onSelect={startConversationWith} onOpenGroups={() => { setNewMessageOpen(false); router.push("/groups" as Route); }} />
      <MessageMediaViewer message={messages.find((message) => message.id === viewerMessageId) ?? null} open={Boolean(viewerMessageId)} onClose={() => setViewerMessageId(null)} />
    </div>
  );
}

function ConversationIdentityV2({
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
      <GlowAvatar name={conversation.title} src={conversation.avatarUrl} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[0.98rem] font-bold tracking-[-0.01em]">{conversation.title}</span>
          <PremiumPlanBadge plan={conversation.otherPlan} compact />
          <TrustedMemberMark trustedSince={conversation.otherTrustedSince} compact />
          <VerifiedAccountMark isVerifiedAccount={conversation.otherIsVerifiedAccount} compact />
        </span>
        <span className={cn("mt-0.5 truncate text-[11px] font-medium", subtitleIsShared ? "text-[#E88C2B]" : "text-muted-foreground")}>
          {subtitle ?? (conversation.kind === "group" ? "Group conversation" : conversation.otherUsername ? `@${conversation.otherUsername}` : "Conversation")}
        </span>
      </span>
    </>
  );

  if (conversation.kind === "group") {
    return (
      <Link href={`/groups/${conversation.id}` as Route} prefetch={false} className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl p-1 hover:bg-black/[0.035] dark:hover:bg-white/[0.05]" aria-label={`Open ${conversation.title} group details`}>
        {body}
      </Link>
    );
  }
  if (conversation.otherUsername) {
    return (
      <Link href={`/friends/${conversation.otherUsername}` as Route} prefetch={false} className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl p-1 hover:bg-black/[0.035] dark:hover:bg-white/[0.05]" aria-label={`View ${conversation.title}'s profile`}>
        {body}
      </Link>
    );
  }
  return <div className="flex min-w-0 flex-1 items-center gap-2.5 p-1">{body}</div>;
}

function NewMessageModalV2({
  open,
  onOpenChange,
  onSelect,
  onOpenGroups
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (friendId: string) => void;
  onOpenGroups: () => void;
}) {
  const [friends, setFriends] = useState<MessageableFriend[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || friends !== null) return;
    void getMessageableFriendsAction().then(setFriends);
  }, [friends, open]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!friends) return [];
    if (!term) return friends;
    return friends.filter((friend) => `${friend.displayName} ${friend.username}`.toLowerCase().includes(term));
  }, [friends, query]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New message" compact>
      <div className="space-y-3">
        <button type="button" onClick={onOpenGroups} className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-[#E88C2B]/15 bg-[#E88C2B]/8 p-3 text-left hover:bg-[#E88C2B]/12">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-[#4E0401] text-[#FEFBF3]"><UsersRound className="h-4 w-4" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Groups</span><span className="block text-xs text-muted-foreground">Create a group or open an existing one</span></span>
          <ChevronDown className="h-4 w-4 -rotate-90 text-muted-foreground" aria-hidden="true" />
        </button>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Muddies" aria-label="Search Muddies" autoFocus className="h-11 rounded-2xl pl-10" />
        </div>

        {friends === null ? (
          <div className="grid py-8 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-[#E88C2B]" aria-label="Loading Muddies" /></div>
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{friends.length === 0 ? "Add a Muddy first to start a direct chat." : "No Muddies match your search."}</p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {visible.map((friend) => (
              <li key={friend.friendId}>
                <button type="button" onClick={() => onSelect(friend.friendId)} className="focus-ring flex w-full items-center gap-3 rounded-2xl p-2.5 text-left hover:bg-secondary/70">
                  <GlowAvatar name={friend.displayName} src={friend.avatarUrl} size="sm" />
                  <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold">{friend.displayName}</span><PremiumPlanBadge plan={friend.plan} compact /></span><span className="block truncate text-xs text-muted-foreground">@{friend.username}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
