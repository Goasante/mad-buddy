"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageActionsMenu } from "@/components/messaging/message-actions-menu";
import { LongPressActions } from "@/components/ui/long-press-actions";
import type { MessageActionId } from "@/lib/messaging/message-actions";
import { CalendarCheck2, ChevronLeft, Info, Loader2, MessagesSquare, PenSquare, Plus, Search, Star, UsersRound, VolumeX, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  deleteMessageAction,
  editMessageAction,
  getConversationsAction,
  getMessageableFriendsAction,
  getMessagesAction,
  markConversationReadAction,
  muteConversationAction,
  openDirectConversationAction,
  reactToMessageAction,
  sendMessageAction,
  setConversationHiddenAction,
  setConversationPinnedAction
} from "@/app/(app)/messaging-actions";
import type { ChatMessageView, ConversationView, MessageableFriend } from "@/lib/messaging/mobile";
import { mergeConversations } from "@/lib/messaging/conversation-sync";
import {
  discardOptimistic,
  markFailed,
  markRetrying,
  pruneConfirmed,
  type OptimisticMessage
} from "@/lib/messaging/optimistic-messages";
import type { OptimisticSendDraft } from "@/components/messaging/message-composer";
import {
  eligibleQuickActions,
  type ConversationContext,
  type MeetingPhase
} from "@/lib/messaging/quick-action-eligibility";
import { isTransientConfirmation, useTransientFeedback } from "@/hooks/use-transient-feedback";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { TrustedMemberMark } from "@/components/trust/trusted-member-mark";
import { VerifiedAccountMark } from "@/components/trust/verified-account-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { UserAvatar } from "@/components/ui/user-avatar";
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
import { SafeMessageText } from "@/components/messages/safe-message-text";
import { MessageComposer } from "@/components/messaging/message-composer";
import { VoiceMessageBubble } from "@/components/messaging/voice-message-bubble";
import type { VoiceRecorderConfig } from "@/lib/messaging/voice-recording";
import { MessageMediaViewer } from "@/components/messaging/message-media-viewer";
import type { AttachmentView } from "@/lib/messaging/attachments";
import { MESSAGES_UPDATED_EVENT } from "@/hooks/use-unread-message-count";

// "Groups" filters conversation_type === "group"; "Plans" filters
// conversation_type === "plan" (the group chat attached to a specific Plan).
// Both are real, working filters over data already loaded.
const tabs: Array<{ id: "all" | "unread" | "groups" | "plans"; label: string; icon: LucideIcon | null }> = [
  { id: "all", label: "All", icon: null },
  { id: "unread", label: "Unread", icon: null },
  { id: "groups", label: "Circles", icon: UsersRound },
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
  initialConversations = [],
  voiceRecorderConfig = { enabled: false, maxDurationSeconds: 0 },
}: {
  initialConversations?: ConversationView[];
  voiceRecorderConfig?: VoiceRecorderConfig;
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
  /**
   * Messages drawn before the server has them (spec R2 §8).
   *
   * Held next to `messages` rather than merged into it, so the canonical list
   * stays exactly what the server returned. Reconciliation is a render-time
   * decision, which means a refetch can never overwrite a pending row and a
   * pending row can never masquerade as server truth.
   */
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);
  /** The last draft for each pending key, so Retry can resend it unchanged. */
  const retryDraftsRef = useRef<Map<string, OptimisticSendDraft>>(new Map());
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [viewerMessageId, setViewerMessageId] = useState<string | null>(null);
  /* Confirmations clear themselves; failures stay until something replaces
     them. "Sent" used to sit above the inbox indefinitely, surviving both
     navigation and reload. */
  const [feedback, setFeedback] = useTransientFeedback();
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
  /* Eligibility depends on message age, but reading Date.now() during render
   * would make every keystroke recompute it. Sampled when the thread loads,
   * which is accurate enough for a 10-minute edit and 1-hour delete window. */
  const [actionsNowMs, setActionsNowMs] = useState(() => Date.now());

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

      const readResult = await withTimeout(markConversationReadAction(conversationId), {
        operation: "mark conversation read"
      });
      if (requestId !== loadRequestIdRef.current) return;
      if (!readResult.ok) setFeedback(readResult.message);
      // Remember the read locally: a list fetch already in flight carries the
      // pre-read count, and without this the badge would clear and then flick
      // straight back when that older response landed.
      locallyReadIds.current.add(conversationId);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation
        )
      );
      window.dispatchEvent(new Event(MESSAGES_UPDATED_EVENT));
    } catch (error) {
      if (requestId === loadRequestIdRef.current) {
        setFeedback(messageFailure(error));
      }
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoadingMessages(false);
      }
    }
  }, [setFeedback]);

  const refreshMessages = useCallback(async (conversationId: string) => {
    try {
      const loaded = await withTimeout(getMessagesAction(conversationId), {
        operation: "refresh conversation"
      });
      setMessages(loaded);
    } catch (error) {
      setFeedback(messageFailure(error));
    }
  }, [setFeedback]);

  /** Draws a message the instant Send is pressed, before any request. */
  const addOptimistic = useCallback((draft: OptimisticSendDraft) => {
    retryDraftsRef.current.set(draft.clientMessageId, draft);
    setOptimistic((current) => [
      ...current.filter((message) => message.clientMessageId !== draft.clientMessageId),
      {
        clientMessageId: draft.clientMessageId,
        text: draft.text,
        kind: draft.kind,
        durationSeconds: draft.durationSeconds,
        /* The moment Send was pressed. This is what orders a burst of
         * messages, so acknowledgement order never reaches the screen. */
        createdAt: new Date().toISOString(),
        status: "pending"
      }
    ]);
  }, []);

  /**
   * Resolves a pending row.
   *
   * A confirmed row is NOT removed here: it is removed at render time once the
   * canonical message carrying its key arrives, so the bubble never blinks out
   * in the gap between the response and the refetch that follows it.
   */
  const settleOptimistic = useCallback((clientMessageId: string, outcome: "sent" | "failed") => {
    if (outcome === "failed") {
      setOptimistic((current) => markFailed(current, clientMessageId));
      return;
    }
    setOptimistic((current) => markRetrying(current, clientMessageId));
  }, []);

  /**
   * Resends a failed message under its ORIGINAL key (spec R2 §18).
   *
   * Reusing the key is the whole point: the server dedupes on
   * (sender_id, client_message_id), so a retry that races a send which
   * actually succeeded returns the first message instead of creating a second.
   */
  const retryOptimistic = useCallback((clientMessageId: string) => {
    const draft = retryDraftsRef.current.get(clientMessageId);
    if (!draft || !selectedId) return;
    /* Voice retries belong to the composer, which still holds the recording;
     * only text can be replayed from here. */
    if (draft.kind !== "text") return;
    setOptimistic((current) => markRetrying(current, clientMessageId));
    startTransition(async () => {
      try {
        const result = await withTimeout(
          sendMessageAction({ conversationId: selectedId, text: draft.text ?? "", clientMessageId }),
          { operation: "send message" }
        );
        if (!result.ok) {
          setOptimistic((current) => markFailed(current, clientMessageId));
          setFeedback(result.message);
          return;
        }
        /* The thread is the surface the person is looking at, so it is the
         * one refreshed here. The inbox row follows on the next ordinary
         * send or sync -- a retry is a recovery path, not a reason to re-read
         * the whole conversation list. */
        await refreshMessages(selectedId);
      } catch (error) {
        setOptimistic((current) => markFailed(current, clientMessageId));
        setFeedback(messageFailure(error));
      }
    });
  }, [refreshMessages, selectedId, setFeedback]);

  /** Drops a failed message the person chose not to send. */
  const removeOptimistic = useCallback((clientMessageId: string) => {
    retryDraftsRef.current.delete(clientMessageId);
    setOptimistic((current) => discardOptimistic(current, clientMessageId));
  }, []);

  /**
   * What is still genuinely pending, given what the server has returned.
   *
   * Computed at render rather than stored, so there is one rule and no state
   * to fall out of step with the canonical list.
   */
  const pendingMessages = useMemo(() => pruneConfirmed(optimistic, messages), [optimistic, messages]);

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
        /* Mentions carried through unchanged.
         *
         * This pane only ever opens DIRECT conversations -- a Circle routes to
         * its own page -- so these messages have no mentions to reconcile.
         * Passing what the message already names, rather than the empty
         * default, means the edit cannot silently un-mention anyone if a
         * Circle thread is ever opened here. */
        const existingMentions = messages.find((message) => message.id === messageId)?.mentions ?? [];
        const result = await withTimeout(
          editMessageAction(
            messageId,
            editDraft.trim(),
            existingMentions.map((mention) => mention.userId)
          ),
          { operation: "edit message" }
        );
        if (!result.ok) setFeedback(result.message);
        setEditingId(null);
        await refreshMessages(selectedId);
      } catch (error) {
        setFeedback(messageFailure(error));
      }
    });
  }

  /**
   * @param forEveryone true tombstones the message for every participant;
   *   false hides only this person's copy. Never optimistic -- the thread is
   *   re-read from the server, so a refused delete cannot leave a message
   *   looking gone when it is not.
   */
  function remove(messageId: string, forEveryone = true) {
    if (!selectedId) return;
    startTransition(async () => {
      try {
        const result = await withTimeout(deleteMessageAction(messageId, forEveryone), {
          operation: "delete message"
        });
        if (!result.ok) setFeedback(result.message);
        await refreshMessages(selectedId);
      } catch (error) {
        setFeedback(messageFailure(error));
      }
    });
  }

  /**
   * Conversations this client has marked read, and ones it created moments ago.
   *
   * Both are refs rather than state: they exist only to tell a merge which
   * local facts outrank an older server response, and changing them must never
   * itself trigger a render.
   */
  const locallyReadIds = useRef<Set<string>>(new Set());
  const pendingConversationIds = useRef<Set<string>>(new Set());

  /**
   * Pull the canonical list and merge it into local state.
   *
   * THE FIX FOR THE RESTART-TO-SEE-YOUR-MESSAGES BUG. `conversations` was
   * seeded once by useState, which ignores later props, and every writer was a
   * `.map()` over existing rows -- so a newly created conversation had no way
   * into the list and only a fresh page load could show it.
   *
   * getConversationsAction is the SAME server read that produced
   * initialConversations, so this introduces no second source of truth: it
   * re-reads the canonical one and reconciles field-by-field.
   */
  const syncConversations = useCallback(async () => {
    try {
      const server = await withTimeout(getConversationsAction(), { operation: "refresh conversations" });
      setConversations((current) =>
        mergeConversations(current, server, {
          locallyReadIds: locallyReadIds.current,
          pendingIds: pendingConversationIds.current
        })
      );
      // Rows the server has now confirmed are no longer "too new to know
      // about", so they stop being exempt from removal.
      for (const row of server) pendingConversationIds.current.delete(row.id);
    } catch {
      // A failed refresh must never empty the inbox: keeping the list the user
      // can already see is strictly better than replacing it with nothing.
    }
  }, []);

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

  /**
   * Coordination actions for the open conversation, or none.
   *
   * contextBadge is the projection's existing answer to "is this conversation
   * about a dated thing" -- "Plan", "Event", "Safe Arrival", or null for an
   * ordinary chat. Reused rather than adding a parallel signal.
   */
  const visibleQuickActions = useMemo(() => {
    const context: ConversationContext =
      selected?.contextBadge === "Plan"
        ? "plan"
        : selected?.contextBadge === "Event"
          ? "event"
          : selected?.contextBadge === "Safe Arrival"
            ? "safe_arrival"
            : "none";
    /* REAL TIMING, no placeholder.
     *
     * The server resolves planPhase() against the Plan's own start and end and
     * sends the answer; this maps it onto the coordination vocabulary. A
     * conversation with no Plan behind it has a null phase -- an Event or a
     * Circle carries its own context and is treated as ongoing coordination
     * rather than borrowing a Plan's lifecycle. */
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
                : // Not a Plan Chat: Events and Safe Arrival threads coordinate
                  // for as long as they exist, and a DM is excluded by context.
                  "active";

    const allowed = new Set(
      eligibleQuickActions({
        context,
        phase,
        actionIds: QUICK_ACTIONS.map((action) => action.id)
      })
    );
    return QUICK_ACTIONS.filter((action) => allowed.has(action.id)).slice(0, 3);
  }, [selected]);

  // Conversation Mode: a conversation owns the whole screen, so the global
  // bottom navigation steps aside while one is open. Mobile only in effect —
  // the bar is md:hidden anyway — and cleared automatically on unmount.
  useImmersiveWhile(Boolean(selectedId));

  // Why this conversation exists, derived from what the server already sent.

  const context = selected ? conversationContext(selected) : { subtitle: null, shared: false };
  /* More than two people can speak here, so a message needs to say who sent
   * it. Keyed on the conversation KIND rather than a head-count, so the answer
   * cannot flip as members come and go mid-thread. */
  const hasMultipleSpeakers = Boolean(selected && selected.kind !== "direct");

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

  /**
   * Re-sync when the app comes back to the foreground.
   *
   * A phone suspends the tab: sockets die quietly and any message that arrived
   * meanwhile is simply missed, because a realtime subscription replays
   * nothing. Returning to a stale inbox is what made "close and reopen the app"
   * feel like the fix -- the reopen was doing this fetch by hand.
   *
   * Both events are needed and they are not redundant: visibilitychange covers
   * tab switches and the phone being unlocked, focus covers returning from
   * another window on desktop where visibility never changed.
   */
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
    if (openedRequestedConversation.current || !isLikelyConversationId(requestedConversationId)) {
      return;
    }
    openedRequestedConversation.current = true;
    setSelectedId(requestedConversationId);
    setMessages([]);
    void loadConversation(requestedConversationId);
    /* A deep link can name a conversation this page's list does not contain --
     * one created moments ago on another surface, or simply newer than the
     * server render. Without this the row never arrived and the fullscreen pane
     * had no title, no avatar and no way back. */
    void syncConversations();
  }, [loadConversation, requestedConversationId, syncConversations]);

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
        if (!disposed) {
          setMessages(loaded);
          window.dispatchEvent(new Event(MESSAGES_UPDATED_EVENT));
        }
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
  }, [selectedId, setFeedback]);

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
   *
   * A CIRCLE IS NOT A DIRECT CHAT. This inline pane is the direct-message
   * thread: one peer, no member list, no Circle management. Opening a Circle
   * here presented a shared multi-person space as if it were a DM -- the
   * conversation's own `kind` was carried all the way to the client and then
   * used only for tab filtering, never for routing. Circles have a canonical
   * page that knows about members and roles, so they go there.
   */
  function openConversation(conversationId: string) {
    const conversation = uniqueConversations.find((row) => row.id === conversationId);
    if (conversation?.kind === "group") {
      router.push(`/groups/${conversationId}` as Route);
      return;
    }
    setSelectedId(conversationId);
    setMessages([]);
    /* Pending rows belong to the thread they were composed in. Carrying them
     * across would draw one conversation's unsent message inside another. */
    setOptimistic([]);
    retryDraftsRef.current.clear();
    void loadConversation(conversationId);
  }

  /**
   * Dispatches a contextual action to the path that already implements it.
   *
   * Nothing new is invented here: Copy uses the clipboard, React and Edit open
   * the controls that already exist, and both deletes call the canonical
   * server action. Eligibility was decided by `messageActions`, and the server
   * re-checks it regardless.
   */
  function runMessageAction(action: MessageActionId, message: ChatMessageView) {
    switch (action) {
      case "copy":
        void navigator.clipboard?.writeText(message.text ?? "");
        return;
      case "react":
        setReactingId(message.id);
        return;
      case "edit":
        setEditingId(message.id);
        setEditDraft(message.text ?? "");
        return;
      case "delete_for_me":
        remove(message.id, false);
        return;
      case "delete_for_everyone":
        remove(message.id, true);
        return;
    }
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
        // router.refresh() re-renders the server component but cannot reach
        // this client list, so the inbox row kept its old preview and position
        // until a full page load. Sync explicitly.
        router.refresh();
        void syncConversations();
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

  /**
   * @param target defaults to the open conversation, so the header control is
   *   unchanged. Passing a row lets the inbox mute without opening it first.
   */
  function toggleMute(target: ConversationView | null = selected) {
    if (!target) return;
    startTransition(async () => {
      try {
        const result = await withTimeout(muteConversationAction(target.id, target.muted ? 0 : 8), {
          operation: "update conversation mute"
        });
        setFeedback(result.message);
        if (result.ok) {
          setConversations((current) =>
            current.map((conversation) =>
              conversation.id === target.id ? { ...conversation, muted: !conversation.muted } : conversation
            )
          );
        }
      } catch (error) {
        setFeedback(messageFailure(error));
      }
    });
  }

  /**
   * Hide a conversation from this inbox.
   *
   * Optimistic: the row disappears immediately, because the server is only
   * being told what the person already decided. On failure it comes back and
   * says why -- losing a conversation silently would be far worse than a
   * moment's delay.
   */
  function hideConversation(conversationId: string) {
    const previous = conversations;
    setConversations((current) => current.filter((row) => row.id !== conversationId));
    // Hiding the conversation you are reading has to close it too, or the
    // thread stays open on a row that is no longer in the list.
    if (selectedId === conversationId) dismissConversation();
    startTransition(async () => {
      try {
        const result = await withTimeout(setConversationHiddenAction(conversationId, true), {
          operation: "hide conversation"
        });
        if (!result.ok) {
          setConversations(previous);
          setFeedback(result.message);
          return;
        }
        setFeedback(result.message);
      } catch (error) {
        setConversations(previous);
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
        const conversationId = result.conversationId;

        /* THE DEAD END THIS REPLACES. This used to call router.refresh() and
         * then open the conversation immediately. refresh() does not block, and
         * `conversations` was seeded by a useState initialiser that ignores the
         * refreshed props anyway -- so the row was never in the list. The thread
         * pane went fullscreen on mobile (it keys off selectedId) while
         * `selected` stayed null, rendering "Select a conversation. Choose a
         * Muddy to view your conversation." over a hidden inbox. The person had
         * just chosen a Muddy, and was now stuck being asked to choose one.
         *
         * So the conversation is made part of client state BEFORE the thread
         * opens. It is marked pending first, so a list fetch already in flight
         * -- which cannot know about a conversation created a moment ago --
         * cannot delete it on arrival. */
        pendingConversationIds.current.add(conversationId);
        openConversation(conversationId);
        // Canonical row, same server read the page was seeded from. Awaited so
        // an existing conversation is reconciled rather than duplicated.
        await syncConversations();
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
          {/* This page holds Circles and Plan Chats as well as direct
              messages, so "privately with your approved Muddies" was making a
              promise the group rooms below it do not keep. It now names what
              is actually here. */}
          <p className="mt-1 text-sm text-muted-foreground">
            Your conversations with Muddies, Circles and Plans.
          </p>
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

      {/* A confirmation and a failure are not the same event, so they do not
          get the same furniture. "Sent" is a quiet line that removes itself;
          a failure keeps the bordered panel, because it has to be noticed and
          it stays until something replaces it. Both are role="status" so a
          screen reader hears them without stealing focus. */}
      {feedback ? (
        isTransientConfirmation(feedback) ? (
          <p className="mb-3 text-sm text-muted-foreground" role="status">
            {feedback}
          </p>
        ) : (
          <div
            className="mb-4 rounded-[1rem] border border-orange-400/20 bg-orange-400/10 p-3 text-sm text-orange-800 dark:text-orange-50"
            role="status"
          >
            {feedback}
          </div>
        )
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
                      {/* Type-aware, because a Circle and a direct chat do not
                          offer the same things. A Circle opens its own page,
                          which owns members and roles; a direct chat offers the
                          other person's profile.

                          NO DELETE HERE, deliberately. Nothing in the codebase
                          implements deleting, hiding or archiving a
                          conversation for one participant -- conversations.status
                          has 'archived' and 'deleted' values, but no action ever
                          writes them. A "Delete chat" item would either do
                          nothing or destroy a row shared with somebody else, so
                          the menu offers only what the backend genuinely
                          supports. */}
                      <LongPressActions
                        label={`Actions for ${conversation.title}`}
                        items={[
                          {
                            id: "mute",
                            label: conversation.muted ? "Unmute" : "Mute",
                            onSelect: () => toggleMute(conversation)
                          },
                          {
                            id: "pin",
                            label: conversation.pinned ? "Unpin" : "Pin",
                            onSelect: () => togglePin(conversation.id, !conversation.pinned)
                          },
                          ...(conversation.kind === "group"
                            ? [
                                {
                                  id: "open-circle",
                                  label: "View Circle",
                                  onSelect: () => router.push(`/groups/${conversation.id}` as Route)
                                }
                              ]
                            : [
                                ...(conversation.otherUsername
                                  ? [
                                      {
                                        id: "view-profile",
                                        label: "View profile",
                                        onSelect: () =>
                                          router.push(`/friends/${conversation.otherUsername}` as Route)
                                      }
                                    ]
                                  : []),
                                /* DIRECT CHATS ONLY, and it is not a delete.
                                   The conversation is shared: this hides it
                                   from your inbox and leaves the other
                                   person's untouched. A Circle offers Leave
                                   Circle instead, which is a different act
                                   with consequences for other people. */
                                {
                                  id: "hide",
                                  label: "Hide chat",
                                  onSelect: () => hideConversation(conversation.id)
                                }
                              ])
                        ]}
                      >
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
          <VerifiedAccountMark isVerifiedAccount={conversation.otherIsVerifiedAccount} compact />
                            <VerifiedAccountMark isVerifiedAccount={conversation.otherIsVerifiedAccount} compact />
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
                      </LongPressActions>
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
              /* Two different states used to render the same copy, and one of
                 them was a trap. With no selectedId this pane is the desktop
                 resting state and "Select a conversation" is right. But when a
                 selectedId IS set and its row has not arrived yet, this pane is
                 FULLSCREEN on mobile (see the fixed inset-0 above) and the
                 inbox behind it is hidden -- so telling the person to choose a
                 Muddy, right after they chose one, left them with nothing to
                 tap and no way back. That case now shows progress and, always,
                 a way out. */
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                {selectedId ? (
                  <>
                    <Loader2
                      className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                    <p className="mt-3 text-sm font-semibold">Opening conversation…</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      This should only take a moment.
                    </p>
                    {/* The escape hatch. Present even while loading, because a
                        fullscreen pane with no exit is the dead end itself. */}
                    <Button type="button" size="sm" variant="outline" className="mt-4" onClick={closeConversation}>
                      Back to conversations
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-secondary text-muted-foreground">
                      <MessagesSquare className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <p className="mt-3 text-sm font-semibold">Select a conversation</p>
                    <p className="mt-1 text-sm text-muted-foreground">Choose a Muddy to view your conversation.</p>
                  </>
                )}
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
                    onClick={() => toggleMute()}
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
                            {/* WHO SAID IT, ONCE PER RUN.
                              *
                              * A direct chat needs no name: "not mine" already
                              * identifies the only other person. A Plan Chat
                              * with three people does -- without this, two
                              * Muddies' messages were visually identical, and
                              * the thread said what was decided without saying
                              * who decided it.
                              *
                              * Shown only at the top of an incoming run, so a
                              * burst from one person stays one block. Never on
                              * your own messages: you know who you are, and
                              * repeating it wastes the row. UserAvatar, not
                              * GlowAvatar -- who is speaking in a Plan has
                              * nothing to do with who is nearby. */}
                            {!message.isMine &&
                            hasMultipleSpeakers &&
                            startsNewRun(message, messages[messageIndex - 1]) ? (
                              <div className="mb-1 flex items-center gap-1.5">
                                <UserAvatar
                                  src={message.senderAvatarUrl}
                                  name={message.senderName}
                                  size="xs"
                                  decorative
                                />
                                <span className="text-xs font-medium text-muted-foreground">
                                  {message.senderName}
                                </span>
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
                              {!message.deleted && message.voice ? (
                                <VoiceMessageBubble
                                  conversationId={selected.id}
                                  messageId={message.id}
                                  senderName={message.isMine ? "you" : message.senderName}
                                  asset={message.voice}
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
                                      : message.text
                                        ? <SafeMessageText text={message.text} />
                                        : (message.attachment || message.voice ? null : "Message")}
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
                            </MessageActionsMenu>

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
                                      </>
                                    ) : null}
                                    {message.isMine ? (
                                      <button
                                        type="button"
                                        onClick={() => remove(message.id)}
                                        className="focus-ring rounded px-1 hover:text-destructive"
                                      >
                                        Delete
                                      </button>
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

                  {/* PENDING AND FAILED MESSAGES (spec R2 §8-§10, §17).
                    *
                    * Rendered after the canonical list because they are the
                    * newest thing in the conversation, and rendered SEPARATELY
                    * because they are not server truth -- they carry no id, no
                    * reactions and no actions. Each disappears from here the
                    * moment the canonical message bearing its key arrives.
                    *
                    * Deliberately plain: the same bubble geometry as a sent
                    * message so nothing jumps when it is confirmed, with only
                    * the status line distinguishing it. */}
                  {pendingMessages.map((message) => (
                    <div key={message.clientMessageId} className="flex flex-col items-end">
                      <div
                        className={cn(
                          "max-w-[78%] rounded-2xl rounded-br-md px-3 py-2 text-[0.9375rem] leading-relaxed",
                          "bg-primary text-primary-foreground",
                          // Pending is quietly de-emphasised; failed is not,
                          // because it needs to be noticed and acted on.
                          message.status === "pending" ? "opacity-70" : "opacity-100"
                        )}
                      >
                        {message.kind === "voice" ? (
                          <span className="flex items-center gap-2">
                            <MessagesSquare className="h-4 w-4" aria-hidden="true" />
                            {message.durationSeconds
                              ? `Voice message · 0:${String(Math.round(message.durationSeconds)).padStart(2, "0")}`
                              : "Voice message"}
                          </span>
                        ) : (
                          message.text
                        )}
                      </div>
                      {message.status === "failed" ? (
                        <p className="mt-1 flex items-center gap-2 text-[0.625rem] font-medium text-destructive">
                          <span>Not sent</span>
                          <button
                            type="button"
                            onClick={() => retryOptimistic(message.clientMessageId)}
                            className="focus-ring rounded px-1 underline hover:text-foreground"
                          >
                            Retry
                          </button>
                          <button
                            type="button"
                            onClick={() => removeOptimistic(message.clientMessageId)}
                            className="focus-ring rounded px-1 underline hover:text-foreground"
                          >
                            Delete
                          </button>
                        </p>
                      ) : (
                        <p className="mt-1 text-[0.625rem] font-medium text-muted-foreground/80">
                          {/* Accessible name carries the real state; the glyph
                            * alone would tell a screen reader nothing (§29). */}
                          <span aria-hidden="true">◷</span>
                          <span className="sr-only">Sending</span>
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Quick coordination actions (spec §39), no location attached.
                  *
                  * ONLY WHERE THERE IS SOMETHING TO COORDINATE. This used to
                  * render QUICK_ACTIONS.slice(0, 3) unconditionally, so every
                  * ordinary direct message offered "I'm on my way", "I'm here"
                  * and "Running late" -- arrival language for a meeting that
                  * did not exist. They now appear only in conversations that
                  * are ABOUT a dated thing: a Plan Chat, an Event, an Event
                  * Circle or a Safe Arrival thread.
                  *
                  * KNOWN LIMITATION, deliberately not faked: the conversation
                  * projection carries no start time, so this cannot yet tell
                  * "hours away" from "happening now" and passes "active" for a
                  * coordination context. Phase-accurate gating needs
                  * ConversationView to carry the plan/event timing;
                  * meetingPhase() in quick-action-eligibility.ts is written and
                  * tested for the moment it does. */}
                <div
                  data-tour-id={TOUR_TARGET_IDS.MESSAGES_QUICK_REPLIES}
                  className="flex shrink-0 flex-wrap gap-1.5 px-4 pb-1 pt-2"
                >
                  {visibleQuickActions.map((action) => (
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
                    voiceRecorderConfig={voiceRecorderConfig}
                    placeholder={`Message ${selected.title}`}
                    onFeedback={setFeedback}
                    onOptimisticSend={addOptimistic}
                    onOptimisticSettled={settleOptimistic}
                    onSent={async () => {
                      await refreshMessages(selected.id);
                      /* THE STALE-INBOX FIX. This used to call only
                       * refreshMessages + router.refresh(), so the open thread
                       * showed the new message while the inbox row kept its old
                       * preview, its old timestamp and its old position -- a
                       * conversation last used five days ago still read "5 days
                       * ago" and stayed down the list after you had just
                       * replied to it.
                       *
                       * router.refresh() re-renders the server component but
                       * cannot write this client list. syncConversations()
                       * re-reads the canonical projection, where the server has
                       * already advanced last_message_at and ordered by it, so
                       * preview, time and position all move together. */
                      router.refresh();
                      await syncConversations();
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
