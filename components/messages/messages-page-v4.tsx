"use client";

import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageCircle,
  PenSquare,
  Pin,
  Plus,
  Search,
  Send,
  UsersRound,
  X
} from "lucide-react";
import type { CSSProperties } from "react";
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
  setConversationPinnedAction
} from "@/app/(app)/messaging-actions";
import { forwardMessageAction } from "@/app/(app)/messaging-forward-actions";
import { getInboxConversationPreferencesAction } from "@/app/(app)/messaging-inbox-v4-actions";
import { getConversationViewerRoleAction } from "@/app/(app)/messaging-role-action";
import {
  createChatPollAction,
  getUltimateConversationStateAction,
  heartbeatConversationPresenceAction,
  leaveConversationPresenceAction,
  setPinnedMessageAction,
  setSavedMessageAction,
  updateConversationUserPreferencesAction
} from "@/app/(app)/messaging-ultimate-actions";
import { getReplyContextsAction } from "@/app/(app)/messaging-v3-actions";
import { useImmersiveWhile } from "@/components/app-shell/immersive-mode";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { ChatSettingsV4 } from "@/components/messaging/chat-settings-v4";
import { ConversationRowV4 } from "@/components/messaging/conversation-row-v4";
import { MessageBubbleV4 } from "@/components/messaging/message-bubble-v4";
import { MessageComposerV4Shell } from "@/components/messaging/message-composer-v4-shell";
import { MessageMediaViewer } from "@/components/messaging/message-media-viewer";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import { MESSAGES_UPDATED_EVENT } from "@/hooks/use-unread-message-count";
import { conversationContext, dayLabel, startsNewDay, startsNewRun } from "@/lib/messaging/conversation-presence";
import type { AttachmentView } from "@/lib/messaging/attachments";
import type { ChatMessageView, ConversationView, MessageableFriend } from "@/lib/messaging/mobile";
import type { MentionCandidate } from "@/lib/messaging/mentions";
import {
  discardOptimistic,
  markFailed,
  markRetrying,
  pruneConfirmed,
  type OptimisticMessage
} from "@/lib/messaging/optimistic-messages";
import type { UltimateConversationState } from "@/lib/messaging/ultimate-types";
import type { VoiceRecorderConfig } from "@/lib/messaging/voice-recording";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
import { authenticateRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "favorites", label: "Favorites" },
  { id: "groups", label: "Groups" },
  { id: "plans", label: "Plans" },
  { id: "archived", label: "Archived" }
] as const;

type FilterId = (typeof FILTERS)[number]["id"];
type ReplyContext = { replyToMessageId: string; senderName: string; text: string };
type ViewerRole = "owner" | "admin" | "moderator" | "member" | null;
type InboxPreference = {
  archivedAt: string | null;
  markedUnreadAt: string | null;
  favoriteRank: number | null;
  draftText: string | null;
  draftUpdatedAt: string | null;
};
type InboxPreferenceMap = Record<string, Partial<InboxPreference>>;
type DeleteTarget = { message: ChatMessageView } | null;
type ForwardTarget = { message: ChatMessageView } | null;

const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isConversationId(value: string | null): value is string {
  return Boolean(value) && CONVERSATION_ID.test(value as string);
}

function failureMessage(error: unknown) {
  return isRequestTimeoutError(error)
    ? "Chats took too long to respond. Try again."
    : "Chats could not be updated. Try again.";
}

function messagePreview(message: ChatMessageView) {
  if (message.deleted) return "Message removed";
  if (message.voice) return "Voice message";
  if (message.attachment) return "Photo";
  if (message.messageType === "poll") return "Poll";
  if (message.messageType === "video") return "Video";
  if (message.messageType === "file") return "File";
  return message.text?.trim() || "Message";
}

function themeStyle(themeKey: string | null | undefined): CSSProperties {
  switch (themeKey) {
    case "apricot":
      return { background: "radial-gradient(circle at 20% 0%, rgba(232,140,43,.13), transparent 38%), #fffaf3" };
    case "maroon":
      return { background: "radial-gradient(circle at 85% 10%, rgba(232,140,43,.08), transparent 28%), linear-gradient(180deg,#2d0806,#160c0b)" };
    case "sunset":
      return { background: "radial-gradient(circle at 25% 0%, rgba(245,168,90,.2), transparent 36%), radial-gradient(circle at 85% 80%, rgba(217,102,85,.12), transparent 35%), #fff9f4" };
    case "forest":
      return { background: "radial-gradient(circle at 20% 0%, rgba(92,130,102,.16), transparent 38%), #f8faf6" };
    default:
      return { background: "#FFFDFC" };
  }
}

function presenceLabel(ultimate: UltimateConversationState | null, isGroup: boolean, fallback: string) {
  const typing = ultimate?.presence.filter((person) => person.isTyping) ?? [];
  if (typing.length === 1) return `${typing[0].displayName} is typing…`;
  if (typing.length === 2) return `${typing[0].displayName} and ${typing[1].displayName} are typing…`;
  if (typing.length > 2) return `${typing[0].displayName} and ${typing.length - 1} others are typing…`;
  const here = ultimate?.presence.filter((person) => person.isInChat) ?? [];
  if (here.length > 0) return isGroup ? `${here.length} ${here.length === 1 ? "person" : "people"} here` : "In this chat now";
  return fallback;
}

export function MessagesPageV4({
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
  const [inboxPreferences, setInboxPreferences] = useState<InboxPreferenceMap>({});
  const [selectedId, setSelectedId] = useState<string | null>(() => isConversationId(requestedConversationId) ? requestedConversationId : null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [replyContexts, setReplyContexts] = useState<Record<string, ReplyContext>>({});
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
  const [ultimate, setUltimate] = useState<UltimateConversationState | null>(null);
  const [viewerRole, setViewerRole] = useState<ViewerRole>(null);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterId>("all");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadQuery, setThreadQuery] = useState("");
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [viewerMessageId, setViewerMessageId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<ChatMessageView | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [forwardTarget, setForwardTarget] = useState<ForwardTarget>(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [unseenIncoming, setUnseenIncoming] = useState(0);
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);
  const [isPending, startTransition] = useTransition();

  const retryDraftsRef = useRef<Map<string, { clientMessageId: string; text: string | null; kind: "text" | "voice"; durationSeconds: number | null }>>(new Map());
  const threadRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const initialScrollPendingRef = useRef(false);
  const mountedRef = useRef(true);

  useImmersiveWhile(Boolean(selectedId));

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const syncConversations = useCallback(async () => {
    try {
      const server = await withTimeout(getConversationsAction(), { operation: "refresh chats" });
      if (mountedRef.current) setConversations(server);
    } catch {
      // Keep current inbox when a background refresh fails.
    }
  }, []);

  const syncInboxPreferences = useCallback(async () => {
    try {
      const next = await getInboxConversationPreferencesAction();
      if (mountedRef.current) setInboxPreferences(next as InboxPreferenceMap);
    } catch {
      // Preferences enhance the inbox; core messaging stays available.
    }
  }, []);

  const refreshUltimate = useCallback(async (conversationId: string) => {
    try {
      const next = await getUltimateConversationStateAction(conversationId);
      if (mountedRef.current) setUltimate(next);
    } catch {
      // New schema may not yet be applied in a preview. V4 degrades to core chat.
    }
  }, []);

  const refreshMessages = useCallback(async (conversationId: string, countIncoming = true) => {
    try {
      const [loaded, replies] = await Promise.all([
        withTimeout(getMessagesAction(conversationId), { operation: "refresh conversation" }),
        getReplyContextsAction(conversationId).catch(() => ({}))
      ]);
      if (!mountedRef.current) return;
      setMessages((current) => {
        if (countIncoming && !nearBottomRef.current) {
          const known = new Set(current.map((message) => message.id));
          const incoming = loaded.filter((message) => !known.has(message.id) && !message.isMine).length;
          if (incoming > 0) setUnseenIncoming((count) => count + incoming);
        }
        return loaded;
      });
      setReplyContexts(replies as Record<string, ReplyContext>);
    } catch (error) {
      setFeedback(failureMessage(error));
    }
  }, []);

  const loadConversation = useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    setFeedback("");
    setUnseenIncoming(0);
    nearBottomRef.current = true;
    initialScrollPendingRef.current = true;
    try {
      const [loaded, people, replies, ultimateState, role] = await Promise.all([
        withTimeout(getMessagesAction(conversationId), { operation: "load conversation" }),
        getMentionCandidatesAction(conversationId).catch(() => []),
        getReplyContextsAction(conversationId).catch(() => ({})),
        getUltimateConversationStateAction(conversationId).catch(() => null),
        getConversationViewerRoleAction(conversationId).catch(() => null)
      ]);
      if (!mountedRef.current) return;
      setMessages(loaded);
      setMentionCandidates(people);
      setReplyContexts(replies as Record<string, ReplyContext>);
      setUltimate(ultimateState);
      setViewerRole(role as ViewerRole);
      await markConversationReadAction(conversationId).catch(() => ({ ok: false, message: "" }));
      await updateConversationUserPreferencesAction({ conversationId, markedUnread: false }).catch(() => ({ ok: false, message: "" }));
      setInboxPreferences((current) => current[conversationId] ? { ...current, [conversationId]: { ...current[conversationId], markedUnreadAt: null } } : current);
      setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation));
      window.dispatchEvent(new Event(MESSAGES_UPDATED_EVENT));
    } catch (error) {
      setFeedback(failureMessage(error));
    } finally {
      if (mountedRef.current) setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    void syncConversations();
    void syncInboxPreferences();
  }, [syncConversations, syncInboxPreferences]);

  useEffect(() => {
    if (!isConversationId(requestedConversationId)) return;
    setSelectedId(requestedConversationId);
    void loadConversation(requestedConversationId);
  }, [loadConversation, requestedConversationId]);

  useEffect(() => {
    if (!selectedId) return;
    void heartbeatConversationPresenceAction({ conversationId: selectedId, typing: false });
    const heartbeat = setInterval(() => {
      void heartbeatConversationPresenceAction({ conversationId: selectedId, typing: false });
    }, 20_000);
    const projection = setInterval(() => void refreshUltimate(selectedId), 4_000);
    return () => {
      clearInterval(heartbeat);
      clearInterval(projection);
      void leaveConversationPresenceAction(selectedId);
    };
  }, [refreshUltimate, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refreshAll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (disposed) return;
        void refreshMessages(selectedId, true);
        void refreshUltimate(selectedId);
        void syncConversations();
      }, 100);
    };
    const channel = supabase
      .channel(`chats-v4:${selectedId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${selectedId}` }, refreshAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_presence", filter: `conversation_id=eq.${selectedId}` }, () => void refreshUltimate(selectedId))
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_message_pins", filter: `conversation_id=eq.${selectedId}` }, () => void refreshUltimate(selectedId))
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_polls", filter: `conversation_id=eq.${selectedId}` }, refreshAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_poll_votes" }, () => void refreshUltimate(selectedId));
    void authenticateRealtime(supabase).then(() => {
      if (!disposed) channel.subscribe();
    });
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [refreshMessages, refreshUltimate, selectedId, syncConversations]);

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
    nearBottomRef.current = true;
    setUnseenIncoming(0);
  }

  useEffect(() => {
    if (!selectedId || loadingMessages) return;
    if (initialScrollPendingRef.current) {
      initialScrollPendingRef.current = false;
      requestAnimationFrame(() => scrollToBottom("auto"));
      return;
    }
    if (nearBottomRef.current) requestAnimationFrame(() => scrollToBottom("smooth"));
  }, [loadingMessages, messages.length, selectedId]);

  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const selectedContext = selected ? conversationContext(selected) : { subtitle: null, shared: false };
  const isGroup = selected?.kind === "group";

  const displayConversations = useMemo(() => conversations.map((conversation) => {
    const pref = inboxPreferences[conversation.id];
    const draft = pref?.draftText?.trim();
    return {
      ...conversation,
      unreadCount: pref?.markedUnreadAt ? Math.max(1, conversation.unreadCount) : conversation.unreadCount,
      pinned: conversation.pinned || pref?.favoriteRank !== null && pref?.favoriteRank !== undefined,
      lastMessagePreview: draft ? `Draft: ${draft}` : conversation.lastMessagePreview
    };
  }), [conversations, inboxPreferences]);

  const unreadChats = displayConversations.filter((conversation) => conversation.unreadCount > 0).length;

  const filteredConversations = useMemo(() => {
    const term = query.trim().toLowerCase();
    return displayConversations.filter((conversation) => {
      const pref = inboxPreferences[conversation.id];
      const archived = Boolean(pref?.archivedAt);
      if (activeFilter === "archived") {
        if (!archived) return false;
      } else if (archived) return false;
      if (activeFilter === "unread" && conversation.unreadCount === 0) return false;
      if (activeFilter === "favorites" && !conversation.pinned) return false;
      if (activeFilter === "groups" && conversation.kind !== "group") return false;
      if (activeFilter === "plans" && conversation.kind !== "plan" && conversation.kind !== "event") return false;
      if (term && !`${conversation.title} ${conversation.lastMessagePreview ?? ""}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [activeFilter, displayConversations, inboxPreferences, query]);

  const pendingMessages = useMemo(() => pruneConfirmed(optimistic, messages), [messages, optimistic]);
  const replyMessage = replyingToId ? messages.find((message) => message.id === replyingToId) ?? null : null;
  const matchingIds = useMemo(() => {
    const term = threadQuery.trim().toLowerCase();
    if (!term) return [];
    return messages.filter((message) => messagePreview(message).toLowerCase().includes(term)).map((message) => message.id);
  }, [messages, threadQuery]);

  useEffect(() => setActiveSearchIndex(-1), [threadQuery]);

  const pinnedMessageId = ultimate?.pins[0]?.messageId ?? null;
  const pinnedMessage = pinnedMessageId ? messages.find((message) => message.id === pinnedMessageId) ?? null : null;
  const pollByMessage = useMemo(() => new Map((ultimate?.polls ?? []).map((poll) => [poll.messageId, poll])), [ultimate?.polls]);
  const savedIds = useMemo(() => new Set(ultimate?.savedMessageIds ?? []), [ultimate?.savedMessageIds]);
  const pinnedIds = useMemo(() => new Set((ultimate?.pins ?? []).map((pin) => pin.messageId)), [ultimate?.pins]);

  function openConversation(conversationId: string) {
    setSelectedId(conversationId);
    setMessages([]);
    setUltimate(null);
    setViewerRole(null);
    setReplyContexts({});
    setReplyingToId(null);
    setOptimistic([]);
    setThreadSearchOpen(false);
    setThreadQuery("");
    void loadConversation(conversationId);
  }

  function closeConversation() {
    if (selectedId) void leaveConversationPresenceAction(selectedId);
    setSelectedId(null);
    setMessages([]);
    setUltimate(null);
    setViewerRole(null);
    setReplyContexts({});
    setReplyingToId(null);
    setMentionCandidates([]);
    setSettingsOpen(false);
    setThreadSearchOpen(false);
    if (requestedConversationId) router.replace("/messages", { scroll: false });
  }

  function patchInboxPreference(conversationId: string, patch: Partial<InboxPreference>) {
    setInboxPreferences((current) => ({
      ...current,
      [conversationId]: {
        archivedAt: null,
        markedUnreadAt: null,
        favoriteRank: null,
        draftText: null,
        draftUpdatedAt: null,
        ...current[conversationId],
        ...patch
      }
    }));
  }

  function markUnread(conversation: ConversationView) {
    const now = new Date().toISOString();
    patchInboxPreference(conversation.id, { markedUnreadAt: now });
    startTransition(async () => {
      const result = await updateConversationUserPreferencesAction({ conversationId: conversation.id, markedUnread: true });
      if (!result.ok) {
        patchInboxPreference(conversation.id, { markedUnreadAt: null });
        setFeedback(result.message);
      }
    });
  }

  function toggleFavorite(conversation: ConversationView) {
    const next = !conversation.pinned;
    setConversations((current) => current.map((row) => row.id === conversation.id ? { ...row, pinned: next } : row));
    patchInboxPreference(conversation.id, { favoriteRank: next ? 0 : null });
    startTransition(async () => {
      const [legacy, prefs] = await Promise.all([
        setConversationPinnedAction(conversation.id, next).catch(() => ({ ok: false, message: "Favorite could not be updated." })),
        updateConversationUserPreferencesAction({ conversationId: conversation.id, favoriteRank: next ? 0 : null }).catch(() => ({ ok: false, message: "Favorite could not be updated." }))
      ]);
      if (!legacy.ok || !prefs.ok) {
        setConversations((current) => current.map((row) => row.id === conversation.id ? { ...row, pinned: !next } : row));
        patchInboxPreference(conversation.id, { favoriteRank: !next ? 0 : null });
        setFeedback(!legacy.ok ? legacy.message : prefs.message);
      }
    });
  }

  function toggleMute(conversation: ConversationView) {
    startTransition(async () => {
      const result = await muteConversationAction(conversation.id, conversation.muted ? 0 : 8).catch(() => ({ ok: false, message: "Mute could not be updated." }));
      if (!result.ok) { setFeedback(result.message); return; }
      setConversations((current) => current.map((row) => row.id === conversation.id ? { ...row, muted: !conversation.muted } : row));
    });
  }

  function toggleArchive(conversation: ConversationView) {
    const current = Boolean(inboxPreferences[conversation.id]?.archivedAt);
    const next = !current;
    patchInboxPreference(conversation.id, { archivedAt: next ? new Date().toISOString() : null });
    startTransition(async () => {
      const result = await updateConversationUserPreferencesAction({ conversationId: conversation.id, archived: next });
      if (!result.ok) {
        patchInboxPreference(conversation.id, { archivedAt: current ? new Date().toISOString() : null });
        setFeedback(result.message);
      }
    });
  }

  function addOptimistic(draft: { clientMessageId: string; text: string | null; kind: "text" | "voice"; durationSeconds: number | null }) {
    retryDraftsRef.current.set(draft.clientMessageId, draft);
    setOptimistic((current) => [
      ...current.filter((message) => message.clientMessageId !== draft.clientMessageId),
      { ...draft, createdAt: new Date().toISOString(), status: "pending" }
    ]);
  }

  function settleOptimistic(clientMessageId: string, outcome: "sent" | "failed") {
    setOptimistic((current) => outcome === "failed" ? markFailed(current, clientMessageId) : markRetrying(current, clientMessageId));
  }

  function retryOptimistic(clientMessageId: string) {
    const draft = retryDraftsRef.current.get(clientMessageId);
    if (!draft || !selectedId) return;
    if (draft.kind === "voice") {
      setFeedback("That recording could not be uploaded. Record it again so Mad Buddy can verify the audio before sending.");
      setOptimistic((current) => discardOptimistic(current, clientMessageId));
      return;
    }
    setOptimistic((current) => markRetrying(current, clientMessageId));
    startTransition(async () => {
      const result = await sendMessageAction({ conversationId: selectedId, text: draft.text ?? "", clientMessageId }).catch(() => ({ ok: false, message: "Could not retry." }));
      if (!result.ok) {
        setOptimistic((current) => markFailed(current, clientMessageId));
        setFeedback(result.message);
        return;
      }
      await refreshMessages(selectedId, false);
      await syncConversations();
    });
  }

  function react(messageId: string, reaction: string) {
    if (!selectedId) return;
    startTransition(async () => {
      const result = await reactToMessageAction(messageId, reaction).catch(() => ({ ok: false, message: "Could not react." }));
      if (!result.ok) setFeedback(result.message);
      await refreshMessages(selectedId, false);
    });
  }

  function saveMessage(messageId: string) {
    const saved = savedIds.has(messageId);
    startTransition(async () => {
      const result = await setSavedMessageAction({ messageId, saved: !saved });
      setFeedback(result.message);
      if (result.ok && selectedId) await refreshUltimate(selectedId);
    });
  }

  function pinMessage(messageId: string) {
    const pinned = pinnedIds.has(messageId);
    startTransition(async () => {
      const result = await setPinnedMessageAction({ messageId, pinned: !pinned });
      setFeedback(result.message);
      if (result.ok && selectedId) await refreshUltimate(selectedId);
    });
  }

  function scrollToMessage(messageId: string) {
    const node = threadRef.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function jumpSearch(delta: number) {
    if (matchingIds.length === 0) return;
    const base = activeSearchIndex < 0 ? (delta > 0 ? -1 : 0) : activeSearchIndex;
    const next = (base + delta + matchingIds.length) % matchingIds.length;
    setActiveSearchIndex(next);
    scrollToMessage(matchingIds[next]);
  }

  async function refreshSelected() {
    if (!selectedId) return;
    await Promise.all([
      refreshMessages(selectedId, false),
      refreshUltimate(selectedId),
      syncConversations(),
      syncInboxPreferences()
    ]);
  }

  const headerFallback = selected ? selectedContext.subtitle ?? (isGroup ? "Group chat" : selected.otherUsername ? `@${selected.otherUsername}` : "Chat") : "Chat";
  const headerPresence = presenceLabel(ultimate, Boolean(isGroup), headerFallback);
  const typingNow = Boolean(ultimate?.presence.some((person) => person.isTyping));
  const peopleHere = ultimate?.presence.filter((person) => person.isInChat).slice(0, 3) ?? [];

  return (
    <div className="mx-auto w-full max-w-[1240px] pb-3">
      {feedback ? (
        <div role="status" className="mb-2 rounded-2xl border border-[#E88C2B]/20 bg-[#E88C2B]/10 px-4 py-3 text-sm text-[#4E0401] dark:text-orange-100 animate-in fade-in slide-in-from-top-1">
          {feedback}
        </div>
      ) : null}

      <div className="grid min-h-[620px] overflow-hidden md:rounded-[28px] md:border md:border-border/60 md:bg-card/45 md:shadow-[0_24px_80px_rgba(78,4,1,0.08)] lg:grid-cols-[390px_minmax(0,1fr)]">
        <aside className={cn("min-w-0 bg-[#FEFBF3] dark:bg-background lg:border-r lg:border-border/60", selectedId && "hidden lg:flex lg:flex-col")}>
          <div className="sticky top-0 z-10 border-b border-black/[0.04] bg-[#FEFBF3]/95 px-3 pb-3 pt-[max(.55rem,env(safe-area-inset-top))] backdrop-blur-xl dark:border-white/[0.06] dark:bg-background/95 sm:px-4 md:px-5">
            <div className="flex items-center justify-between gap-3">
              <h1 className="font-serif text-[2.2rem] font-semibold leading-none tracking-[-0.04em] text-[#4E0401] dark:text-orange-50">Chats</h1>
              <button type="button" onClick={() => setNewMessageOpen(true)} className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#E88C2B] text-white shadow-[0_8px_22px_rgba(232,140,43,0.28)] transition-transform active:scale-90" aria-label="New chat"><PenSquare className="h-4.5 w-4.5" /></button>
            </div>
            <div className="relative mt-3"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" className="h-11 rounded-2xl border-transparent bg-black/[0.035] pl-10 shadow-none dark:bg-white/[0.055]" /></div>
            <nav aria-label="Chat filters" className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
              {FILTERS.map((filter) => {
                const active = activeFilter === filter.id;
                return <button key={filter.id} type="button" onClick={() => setActiveFilter(filter.id)} aria-current={active ? "page" : undefined} className={cn("focus-ring relative inline-flex min-h-10 shrink-0 items-center gap-1.5 overflow-hidden rounded-full border px-3.5 text-sm font-medium transition-all duration-250 active:scale-95", active ? "border-[#E88C2B]/35 bg-[#E88C2B]/12 text-[#4E0401] shadow-sm dark:text-orange-100" : "border-black/[0.06] bg-white/60 text-muted-foreground hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.03]")}>{filter.label}{filter.id === "unread" && unreadChats > 0 ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#E88C2B] px-1 text-[10px] font-bold text-white animate-in zoom-in-75">{unreadChats}</span> : null}</button>;
              })}
            </nav>
            <p className="mt-2 text-center text-[9px] font-medium text-muted-foreground/65 md:hidden">Swipe chats → unread/favorite · ← mute/archive · hold for actions</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 md:px-3">
            {filteredConversations.length === 0 ? <EmptyState icon={MessageCircle} title={activeFilter === "archived" ? "No archived chats" : "No chats here"} description={activeFilter === "archived" ? "Chats you archive will wait here quietly." : "Try another filter or start a new chat."} action={activeFilter === "archived" ? undefined : <Button onClick={() => setNewMessageOpen(true)}>New chat</Button>} /> : (
              <ul className="space-y-1">
                {filteredConversations.map((conversation) => <li key={conversation.id} className="animate-in fade-in slide-in-from-bottom-1"><ConversationRowV4 conversation={conversation} onOpen={() => openConversation(conversation.id)} onMarkUnread={() => markUnread(conversation)} onFavorite={() => toggleFavorite(conversation)} onMute={() => toggleMute(conversation)} onArchive={() => toggleArchive(conversation)} /></li>)}
              </ul>
            )}
          </div>
        </aside>

        <main className={cn("min-w-0", "fixed inset-0 z-30 flex h-[100dvh] flex-col lg:static lg:z-auto lg:h-[min(790px,calc(100dvh-3rem))]", !selectedId && "hidden lg:flex")} style={themeStyle(ultimate?.preferences.themeKey)}>
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center"><div className="grid h-20 w-20 place-items-center rounded-[28px] bg-[#E88C2B]/10 text-[#E88C2B]"><MessageCircle className="h-8 w-8" /></div><h2 className="mt-5 text-xl font-semibold tracking-tight">Choose a chat</h2><p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Message a Muddy, continue a Group, or pick up a Plan chat.</p></div>
          ) : (
            <>
              <header className="shrink-0 border-b border-black/[0.05] bg-[#FFFDFC]/92 pt-[max(.35rem,env(safe-area-inset-top))] backdrop-blur-xl dark:border-white/[0.06] dark:bg-background/92 lg:pt-0">
                <div className="flex min-h-[64px] items-center gap-1.5 px-2.5 md:px-4">
                  <button type="button" onClick={closeConversation} aria-label="Back to Chats" className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full transition-transform active:scale-90 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] lg:hidden"><ArrowLeft className="h-5 w-5" /></button>
                  <button type="button" onClick={() => setSettingsOpen(true)} className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl p-1 text-left hover:bg-black/[0.035] dark:hover:bg-white/[0.05]">
                    <GlowAvatar name={selected.title} src={selected.avatarUrl} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.98rem] font-bold">{selected.title}</span>
                      <span className={cn("mt-0.5 flex items-center gap-1.5 truncate text-[11px] font-medium transition-colors", typingNow || peopleHere.length > 0 ? "text-[#E88C2B]" : selectedContext.shared ? "text-[#E88C2B]" : "text-muted-foreground")}>
                        {typingNow ? <span aria-hidden="true" className="inline-flex gap-0.5"><i className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-.18s]" /><i className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-.09s]" /><i className="h-1 w-1 animate-bounce rounded-full bg-current" /></span> : null}
                        <span className="truncate">{headerPresence}</span>
                      </span>
                    </span>
                    {peopleHere.length > 0 ? <span className="flex -space-x-2 pr-1" aria-label={`${peopleHere.length} people currently in chat`}>{peopleHere.map((person) => <UserAvatar key={person.userId} src={person.avatarUrl} name={person.displayName} size="xs" decorative />)}</span> : null}
                  </button>
                  {isGroup ? <button type="button" onClick={() => setPollOpen(true)} className="focus-ring grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition-transform active:scale-90 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" aria-label="Create poll"><BarChart3 className="h-4.5 w-4.5" /></button> : null}
                  <button type="button" onClick={() => setThreadSearchOpen((open) => !open)} className="focus-ring grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition-transform active:scale-90 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" aria-label="Search chat"><Search className="h-4.5 w-4.5" /></button>
                  <button type="button" onClick={() => setSettingsOpen(true)} className="focus-ring grid h-11 w-11 place-items-center rounded-full text-sm font-bold text-muted-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" aria-label={isGroup ? "Group Settings" : "Chat Settings"}>•••</button>
                </div>
                {threadSearchOpen ? (
                  <div className="flex items-center gap-1.5 px-3 pb-3 md:px-4 animate-in slide-in-from-top-1 fade-in">
                    <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input autoFocus value={threadQuery} onChange={(event) => setThreadQuery(event.target.value)} placeholder={`Search ${selected.title}`} className="h-10 rounded-2xl border-transparent bg-black/[0.04] pl-10 shadow-none dark:bg-white/[0.055]" /></div>
                    <span className="min-w-[48px] text-center text-[10px] font-semibold text-muted-foreground">{threadQuery.trim() ? `${activeSearchIndex >= 0 ? activeSearchIndex + 1 : 0}/${matchingIds.length}` : ""}</span>
                    <button type="button" disabled={matchingIds.length === 0} onClick={() => jumpSearch(-1)} className="focus-ring grid h-10 w-10 place-items-center rounded-full disabled:opacity-30" aria-label="Previous result"><ChevronUp className="h-4 w-4" /></button>
                    <button type="button" disabled={matchingIds.length === 0} onClick={() => jumpSearch(1)} className="focus-ring grid h-10 w-10 place-items-center rounded-full disabled:opacity-30" aria-label="Next result"><ChevronDown className="h-4 w-4" /></button>
                    <button type="button" onClick={() => { setThreadSearchOpen(false); setThreadQuery(""); }} className="focus-ring grid h-10 w-10 place-items-center rounded-full text-muted-foreground" aria-label="Close search"><X className="h-4 w-4" /></button>
                  </div>
                ) : null}
              </header>

              {pinnedMessage ? (
                <button type="button" onClick={() => scrollToMessage(pinnedMessage.id)} className="group flex shrink-0 items-center gap-2 border-b border-[#E88C2B]/12 bg-[#E88C2B]/7 px-3 py-2 text-left backdrop-blur-md animate-in slide-in-from-top-2 fade-in">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-[#E88C2B]/14 text-[#E88C2B] transition-transform group-active:scale-90"><Pin className="h-3.5 w-3.5 fill-current" /></span>
                  <span className="min-w-0 flex-1"><strong className="block text-[10px] uppercase tracking-[.12em] text-[#E88C2B]">Pinned</strong><span className="block truncate text-xs font-medium">{messagePreview(pinnedMessage)}</span></span>
                  {ultimate && ultimate.pins.length > 1 ? <span className="text-[10px] font-semibold text-muted-foreground">+{ultimate.pins.length - 1}</span> : null}
                </button>
              ) : null}

              <div
                ref={threadRef}
                className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-3 md:px-5 md:pt-4"
                onScroll={(event) => {
                  const node = event.currentTarget;
                  const near = node.scrollHeight - node.scrollTop - node.clientHeight < 90;
                  nearBottomRef.current = near;
                  if (near && unseenIncoming > 0) setUnseenIncoming(0);
                }}
              >
                {loadingMessages ? <div className="grid h-full place-items-center"><Loader2 className="h-5 w-5 animate-spin text-[#E88C2B]" /></div> : messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center px-8 text-center animate-in fade-in zoom-in-95"><GlowAvatar name={selected.title} src={selected.avatarUrl} size="lg" /><h2 className="mt-4 text-lg font-semibold">{selected.title}</h2><p className="mt-1 text-sm text-muted-foreground">Say hello and start the chat.</p>{isGroup ? <div className="mt-4 flex flex-wrap justify-center gap-2"><Button size="sm" onClick={() => setPollOpen(true)}><BarChart3 className="h-4 w-4" />Create poll</Button><Button size="sm" variant="outline" onClick={() => router.push("/plans" as Route)}>Make a Plan</Button></div> : null}</div>
                ) : (
                  messages.map((message, index) => {
                    const previous = messages[index - 1];
                    const startsRun = startsNewRun(message, previous);
                    const newDay = startsNewDay(message.createdAt, previous?.createdAt);
                    return (
                      <Fragment key={message.id}>
                        {newDay ? <div className="my-4 flex justify-center"><span className="rounded-full bg-black/[0.035] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground backdrop-blur-sm dark:bg-white/[0.05]">{dayLabel(message.createdAt)}</span></div> : null}
                        {message.messageType === "system" ? <p data-message-id={message.id} className="mx-auto my-3 max-w-lg text-center text-[11px] font-medium leading-relaxed text-muted-foreground/80">{message.text}</p> : (
                          <div data-message-id={message.id} className={cn("flex transition-[background-color] duration-500", message.isMine ? "justify-end" : "justify-start", startsRun ? "mt-3" : "mt-1")}>
                            <div className="max-w-[86%] sm:max-w-[78%]">
                              <MessageBubbleV4
                                conversationId={selected.id}
                                message={message}
                                showIdentity={startsRun}
                                isGroup={Boolean(isGroup)}
                                replyContext={replyContexts[message.id] ?? null}
                                poll={pollByMessage.get(message.id) ?? null}
                                saved={savedIds.has(message.id)}
                                pinned={pinnedIds.has(message.id)}
                                highlighted={matchingIds.includes(message.id)}
                                onReply={() => setReplyingToId(message.id)}
                                onReact={(reaction) => react(message.id, reaction)}
                                onCopy={() => { if (message.text) void navigator.clipboard?.writeText(message.text).then(() => setFeedback("Copied.")); }}
                                onEdit={() => { setEditTarget(message); setEditDraft(message.text ?? ""); }}
                                onDelete={() => setDeleteTarget({ message })}
                                onSave={() => saveMessage(message.id)}
                                onPin={() => pinMessage(message.id)}
                                onForward={() => setForwardTarget({ message })}
                                onOpenMedia={() => setViewerMessageId(message.id)}
                                onAttachmentRefresh={(attachment: AttachmentView) => setMessages((current) => current.map((item) => item.id === message.id ? { ...item, attachment } : item))}
                                onPollChanged={refreshSelected}
                              />
                            </div>
                          </div>
                        )}
                      </Fragment>
                    );
                  })
                )}

                {pendingMessages.map((message) => (
                  <div key={message.clientMessageId} className="mt-2 flex flex-col items-end animate-in fade-in slide-in-from-bottom-2">
                    <div className={cn("max-w-[84%] rounded-[21px] rounded-br-[7px] bg-[#4E0401] px-3.5 py-2.5 text-[0.94rem] text-[#FEFBF3] transition-opacity", message.status === "pending" && "opacity-65")}>{message.kind === "voice" ? `Voice message${message.durationSeconds ? ` · ${Math.round(message.durationSeconds)}s` : ""}` : message.text}</div>
                    <div className="mt-1 flex items-center gap-2 px-1 text-[10px] font-medium text-muted-foreground">{message.status === "failed" ? <><span className="text-destructive">Not sent</span><button type="button" onClick={() => retryOptimistic(message.clientMessageId)} className="underline">{message.kind === "voice" ? "Record again" : "Retry"}</button><button type="button" onClick={() => setOptimistic((current) => discardOptimistic(current, message.clientMessageId))} className="underline">Delete</button></> : <span>Sending…</span>}</div>
                  </div>
                ))}
              </div>

              {unseenIncoming > 0 ? <button type="button" onClick={() => scrollToBottom()} className="absolute bottom-[calc(76px+env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#4E0401] px-3.5 py-2 text-xs font-bold text-[#FEFBF3] shadow-[0_12px_34px_rgba(78,4,1,.24)] animate-in zoom-in-85 slide-in-from-bottom-3"><ArrowDown className="h-4 w-4" />{unseenIncoming} new {unseenIncoming === 1 ? "message" : "messages"}</button> : null}

              <MessageComposerV4Shell
                key={selected.id}
                conversationId={selected.id}
                initialDraft={ultimate?.preferences.draftText ?? inboxPreferences[selected.id]?.draftText ?? null}
                isGroup={selected.kind !== "direct"}
                mentionCandidates={mentionCandidates}
                voiceRecorderConfig={voiceRecorderConfig}
                placeholder={`Message ${selected.title}`}
                replyToMessageId={replyingToId}
                replyPreview={replyMessage ? { senderName: replyMessage.senderName, text: messagePreview(replyMessage) } : null}
                onCancelReply={() => setReplyingToId(null)}
                onFeedback={setFeedback}
                onOptimisticSend={addOptimistic}
                onOptimisticSettled={settleOptimistic}
                onSent={async () => { await refreshSelected(); scrollToBottom(); }}
              />
            </>
          )}
        </main>
      </div>

      <NewChatV4 open={newMessageOpen} onOpenChange={setNewMessageOpen} onSelect={(friendId) => {
        setNewMessageOpen(false);
        startTransition(async () => {
          const result = await openDirectConversationAction(friendId).catch(() => ({ ok: false, message: "Could not open chat.", conversationId: undefined }));
          if (!result.ok || !result.conversationId) { setFeedback(result.message); return; }
          await syncConversations();
          openConversation(result.conversationId);
        });
      }} onOpenGroups={() => { setNewMessageOpen(false); router.push("/groups" as Route); }} />

      {selected ? <ChatSettingsV4 open={settingsOpen} onOpenChange={setSettingsOpen} conversation={selected} ultimate={ultimate} viewerRole={viewerRole} onFavorite={() => toggleFavorite(selected)} onSearch={() => { setSettingsOpen(false); setThreadSearchOpen(true); }} onGroupDetails={() => router.push(`/groups/${selected.id}` as Route)} onRefresh={refreshSelected} onFeedback={setFeedback} /> : null}

      <EditMessageModal message={editTarget} draft={editDraft} setDraft={setEditDraft} pending={isPending} onClose={() => setEditTarget(null)} onSave={() => {
        if (!editTarget || !selectedId || !editDraft.trim()) return;
        startTransition(async () => {
          const result = await editMessageAction(editTarget.id, editDraft.trim(), editTarget.mentions.map((mention) => mention.userId)).catch(() => ({ ok: false, message: "Could not edit." }));
          setFeedback(result.message);
          if (result.ok) setEditTarget(null);
          await refreshMessages(selectedId, false);
          await syncConversations();
        });
      }} />

      <DeleteMessageModal target={deleteTarget} pending={isPending} onClose={() => setDeleteTarget(null)} onDelete={(forEveryone) => {
        if (!deleteTarget || !selectedId) return;
        startTransition(async () => {
          const result = await deleteMessageAction(deleteTarget.message.id, forEveryone).catch(() => ({ ok: false, message: "Could not delete." }));
          setFeedback(result.message);
          if (result.ok) setDeleteTarget(null);
          await refreshMessages(selectedId, false);
          await syncConversations();
          await refreshUltimate(selectedId);
        });
      }} />

      <ForwardModal target={forwardTarget} conversations={displayConversations.filter((conversation) => !inboxPreferences[conversation.id]?.archivedAt)} pending={isPending} onClose={() => setForwardTarget(null)} onForward={(targetConversationId) => {
        if (!forwardTarget) return;
        startTransition(async () => {
          const result = await forwardMessageAction({ sourceMessageId: forwardTarget.message.id, targetConversationIds: [targetConversationId] });
          setFeedback(result.message);
          if (result.ok) setForwardTarget(null);
        });
      }} />

      {selected ? <CreatePollModal open={pollOpen} onOpenChange={setPollOpen} conversationId={selected.id} pending={isPending} onCreate={(payload) => {
        startTransition(async () => {
          const result = await createChatPollAction({ ...payload, conversationId: selected.id, clientMessageId: crypto.randomUUID() });
          setFeedback(result.message);
          if (result.ok) { setPollOpen(false); await refreshSelected(); scrollToBottom(); }
        });
      }} /> : null}

      <MessageMediaViewer message={messages.find((message) => message.id === viewerMessageId) ?? null} open={Boolean(viewerMessageId)} onClose={() => setViewerMessageId(null)} />
    </div>
  );
}

function NewChatV4({ open, onOpenChange, onSelect, onOpenGroups }: { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (friendId: string) => void; onOpenGroups: () => void }) {
  const [friends, setFriends] = useState<MessageableFriend[] | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open || friends !== null) return;
    void getMessageableFriendsAction().then(setFriends);
  }, [friends, open]);
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!friends) return [];
    return term ? friends.filter((friend) => `${friend.displayName} ${friend.username}`.toLowerCase().includes(term)) : friends;
  }, [friends, query]);
  return <Modal open={open} onOpenChange={onOpenChange} title="New Chat" variant="sheet"><div className="space-y-3"><div className="relative"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Muddies or usernames" autoFocus className="h-11 rounded-2xl pl-10" /></div><button type="button" onClick={onOpenGroups} className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-[#E88C2B]/15 bg-[#E88C2B]/8 p-3 text-left active:scale-[.99]"><span className="grid h-10 w-10 place-items-center rounded-full bg-[#4E0401] text-[#FEFBF3]"><UsersRound className="h-4 w-4" /></span><span className="min-w-0 flex-1"><strong className="block text-sm">Groups</strong><span className="text-xs text-muted-foreground">Open or create a group</span></span></button>{friends === null ? <div className="grid py-8 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-[#E88C2B]" /></div> : visible.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No Muddies match your search.</p> : <ul className="max-h-[55vh] space-y-1 overflow-y-auto">{visible.map((friend) => <li key={friend.friendId}><button type="button" onClick={() => onSelect(friend.friendId)} className="focus-ring flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition active:scale-[.99] hover:bg-secondary/70"><GlowAvatar name={friend.displayName} src={friend.avatarUrl} size="sm" /><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{friend.displayName}</strong><span className="block truncate text-xs text-muted-foreground">@{friend.username}</span></span></button></li>)}</ul>}</div></Modal>;
}

function EditMessageModal({ message, draft, setDraft, pending, onClose, onSave }: { message: ChatMessageView | null; draft: string; setDraft: (value: string) => void; pending: boolean; onClose: () => void; onSave: () => void }) {
  return <Modal open={Boolean(message)} onOpenChange={(open) => !open && onClose()} title="Edit message" compact footer={<><Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button><Button onClick={onSave} disabled={pending || !draft.trim()}>{pending ? "Saving…" : "Save"}</Button></>}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} rows={5} className="focus-ring w-full resize-none rounded-2xl border border-border/70 bg-background p-3 text-sm" /></Modal>;
}

function DeleteMessageModal({ target, pending, onClose, onDelete }: { target: DeleteTarget; pending: boolean; onClose: () => void; onDelete: (forEveryone: boolean) => void }) {
  const mine = target?.message.isMine;
  return <Modal open={Boolean(target)} onOpenChange={(open) => !open && onClose()} title="Delete message?" compact><div className="space-y-2"><button type="button" disabled={pending} onClick={() => onDelete(false)} className="focus-ring w-full rounded-2xl border border-border/70 p-3 text-left"><strong className="block text-sm">Delete for me</strong><span className="text-xs text-muted-foreground">Hide this message only from your chat.</span></button>{mine ? <button type="button" disabled={pending} onClick={() => onDelete(true)} className="focus-ring w-full rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-left text-destructive"><strong className="block text-sm">Delete for everyone</strong><span className="text-xs opacity-75">Remove it for everyone if the message is still eligible.</span></button> : null}<Button variant="outline" className="w-full" onClick={onClose} disabled={pending}>Cancel</Button></div></Modal>;
}

function ForwardModal({ target, conversations, pending, onClose, onForward }: { target: ForwardTarget; conversations: ConversationView[]; pending: boolean; onClose: () => void; onForward: (conversationId: string) => void }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? conversations.filter((conversation) => conversation.title.toLowerCase().includes(term)) : conversations;
  }, [conversations, query]);
  return <Modal open={Boolean(target)} onOpenChange={(open) => !open && onClose()} title="Forward to" variant="sheet"><div className="space-y-3"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" /><ul className="max-h-[55vh] space-y-1 overflow-y-auto">{visible.map((conversation) => <li key={conversation.id}><button type="button" disabled={pending} onClick={() => onForward(conversation.id)} className="focus-ring flex w-full items-center gap-3 rounded-2xl p-2.5 text-left hover:bg-secondary/70 active:scale-[.99]"><GlowAvatar name={conversation.title} src={conversation.avatarUrl} size="sm" /><span className="min-w-0 flex-1 truncate text-sm font-semibold">{conversation.title}</span><Send className="h-4 w-4 text-[#E88C2B]" /></button></li>)}</ul></div></Modal>;
}

function CreatePollModal({ open, onOpenChange, conversationId, pending, onCreate }: { open: boolean; onOpenChange: (open: boolean) => void; conversationId: string; pending: boolean; onCreate: (payload: { question: string; options: string[]; allowMultiple: boolean; isAnonymous: boolean }) => void }) {
  void conversationId;
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  useEffect(() => {
    if (!open) { setQuestion(""); setOptions(["", ""]); setAllowMultiple(false); setIsAnonymous(false); }
  }, [open]);
  const valid = question.trim() && options.filter((option) => option.trim()).length >= 2;
  return <Modal open={open} onOpenChange={onOpenChange} title="Create poll" variant="sheet"><div className="space-y-4"><div><label className="mb-1.5 block text-xs font-semibold">Question</label><Input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={240} placeholder="What should we do?" /></div><div className="space-y-2"><div className="flex items-center justify-between"><label className="text-xs font-semibold">Options</label>{options.length < 12 ? <button type="button" onClick={() => setOptions((current) => [...current, ""])} className="focus-ring inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-xs font-semibold text-[#E88C2B]"><Plus className="h-3.5 w-3.5" />Add option</button> : null}</div>{options.map((option, index) => <div key={index} className="flex gap-2"><Input value={option} onChange={(event) => setOptions((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} maxLength={120} placeholder={`Option ${index + 1}`} />{options.length > 2 ? <button type="button" onClick={() => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground" aria-label={`Remove option ${index + 1}`}><X className="h-4 w-4" /></button> : null}</div>)}</div><label className="flex min-h-11 items-center justify-between gap-4 rounded-2xl border border-border/60 px-3 text-sm font-medium"><span>Allow multiple answers</span><input type="checkbox" checked={allowMultiple} onChange={(event) => setAllowMultiple(event.target.checked)} className="h-4 w-4 accent-[#E88C2B]" /></label><label className="flex min-h-11 items-center justify-between gap-4 rounded-2xl border border-border/60 px-3 text-sm font-medium"><span>Anonymous votes</span><input type="checkbox" checked={isAnonymous} onChange={(event) => setIsAnonymous(event.target.checked)} className="h-4 w-4 accent-[#E88C2B]" /></label><Button className="w-full" disabled={pending || !valid} onClick={() => onCreate({ question: question.trim(), options: options.map((option) => option.trim()).filter(Boolean), allowMultiple, isAnonymous })}>{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}Send poll</Button></div></Modal>;
}