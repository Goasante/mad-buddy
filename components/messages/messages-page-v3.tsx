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
  ChevronRight,
  EllipsisVertical,
  Loader2,
  MessageCircle,
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
import { getReplyContextsAction } from "@/app/(app)/messaging-v3-actions";
import { useImmersiveWhile } from "@/components/app-shell/immersive-mode";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { MessageAttachmentImage } from "@/components/messaging/message-attachment-image";
import { MessageComposerV3, type OptimisticSendDraftV3 } from "@/components/messaging/message-composer-v3";
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
import { MESSAGES_UPDATED_EVENT } from "@/hooks/use-unread-message-count";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { conversationContext, dayLabel, startsNewDay, startsNewRun } from "@/lib/messaging/conversation-presence";
import { mergeConversations } from "@/lib/messaging/conversation-sync";
import type { AttachmentView } from "@/lib/messaging/attachments";
import type { ChatMessageView, ConversationView, MessageableFriend } from "@/lib/messaging/mobile";
import type { MentionCandidate } from "@/lib/messaging/mentions";
import { discardOptimistic, markFailed, markRetrying, pruneConfirmed, type OptimisticMessage } from "@/lib/messaging/optimistic-messages";
import { DELETED_MESSAGE_PLACEHOLDER } from "@/lib/messaging/rules";
import type { VoiceRecorderConfig } from "@/lib/messaging/voice-recording";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
import { authenticateRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn, formatRelativeTime } from "@/lib/utils";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "favorites", label: "Favorites" },
  { id: "groups", label: "Groups" },
  { id: "plans", label: "Plans" }
] as const;

type FilterId = (typeof FILTERS)[number]["id"];
type ReplyContext = { replyToMessageId: string; senderName: string; text: string };

const REACTIONS = [
  { id: "heart", emoji: "❤️" },
  { id: "laugh", emoji: "😂" },
  { id: "thumbs_up", emoji: "👍" },
  { id: "wave", emoji: "👋" },
  { id: "fire", emoji: "🔥" },
  { id: "wow", emoji: "😮" }
] as const;

const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isConversationId(value: string | null): value is string {
  return Boolean(value) && CONVERSATION_ID.test(value as string);
}

function messageFailure(error: unknown) {
  return isRequestTimeoutError(error)
    ? "Chats took too long to respond. Try again."
    : "Chats could not be updated. Try again.";
}

function reactionEmoji(id: string | null) {
  return REACTIONS.find((reaction) => reaction.id === id)?.emoji ?? null;
}

function stateIcon(state: string) {
  if (state === "seen") return <CheckCheck className="h-3.5 w-3.5 text-[#E88C2B]" aria-label="Seen" />;
  if (state === "delivered") return <CheckCheck className="h-3.5 w-3.5" aria-label="Delivered" />;
  if (state === "sent") return <Check className="h-3.5 w-3.5" aria-label="Sent" />;
  return null;
}

function previewText(message: ChatMessageView) {
  if (message.deleted) return "Message removed";
  if (message.voice) return "Voice message";
  if (message.attachment) return "Photo";
  return message.text?.trim() || "Message";
}

export function MessagesPageV3({
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
    isConversationId(requestedConversationId) ? requestedConversationId : null
  );
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [replyContexts, setReplyContexts] = useState<Record<string, ReplyContext>>({});
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterId>("all");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadQuery, setThreadQuery] = useState("");
  const [viewerMessageId, setViewerMessageId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);
  const [isPending, startTransition] = useTransition();

  const retryDraftsRef = useRef<Map<string, OptimisticSendDraftV3>>(new Map());
  const locallyReadIds = useRef<Set<string>>(new Set());
  const pendingConversationIds = useRef<Set<string>>(new Set());
  const threadRef = useRef<HTMLDivElement | null>(null);
  const swipeStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  useImmersiveWhile(Boolean(selectedId));

  const syncConversations = useCallback(async () => {
    try {
      const server = await withTimeout(getConversationsAction(), { operation: "refresh chats" });
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
      const [loaded, replies] = await Promise.all([
        withTimeout(getMessagesAction(conversationId), { operation: "refresh conversation" }),
        getReplyContextsAction(conversationId).catch(() => ({}))
      ]);
      setMessages(loaded);
      setReplyContexts(replies as Record<string, ReplyContext>);
    } catch (error) {
      setFeedback(messageFailure(error));
    }
  }, []);

  const loadConversation = useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    setFeedback("");
    try {
      const [loaded, people, replies] = await Promise.all([
        withTimeout(getMessagesAction(conversationId), { operation: "load conversation" }),
        getMentionCandidatesAction(conversationId).catch(() => []),
        getReplyContextsAction(conversationId).catch(() => ({}))
      ]);
      setMessages(loaded);
      setMentionCandidates(people);
      setReplyContexts(replies as Record<string, ReplyContext>);
      const readResult = await withTimeout(markConversationReadAction(conversationId), {
        operation: "mark conversation read"
      });
      if (!readResult.ok) setFeedback(readResult.message);
      locallyReadIds.current.add(conversationId);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation
        )
      );
      window.dispatchEvent(new Event(MESSAGES_UPDATED_EVENT));
    } catch (error) {
      setFeedback(messageFailure(error));
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    void syncConversations();
  }, [syncConversations]);

  useEffect(() => {
    if (!isConversationId(requestedConversationId)) return;
    setSelectedId(requestedConversationId);
    void loadConversation(requestedConversationId);
  }, [loadConversation, requestedConversationId]);

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
      .channel(`chats-v3:${selectedId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${selectedId}` },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            if (disposed) return;
            void refreshMessages(selectedId).then(() => {
              void syncConversations();
              window.dispatchEvent(new Event(MESSAGES_UPDATED_EVENT));
            });
          }, 130);
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
  }, [loadingMessages, messages.length, selectedId]);

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
  const isGroup = Boolean(selected && selected.kind !== "direct");

  const unreadChats = useMemo(
    () => uniqueConversations.filter((conversation) => conversation.unreadCount > 0).length,
    [uniqueConversations]
  );

  const filteredConversations = useMemo(() => {
    const term = query.trim().toLowerCase();
    return uniqueConversations.filter((conversation) => {
      if (activeFilter === "unread" && conversation.unreadCount === 0) return false;
      if (activeFilter === "favorites" && !conversation.pinned) return false;
      if (activeFilter === "groups" && conversation.kind !== "group") return false;
      if (activeFilter === "plans" && conversation.kind !== "plan" && conversation.kind !== "event") return false;
      if (term) {
        const haystack = `${conversation.title} ${conversation.lastMessagePreview ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [activeFilter, query, uniqueConversations]);

  const pendingMessages = useMemo(() => pruneConfirmed(optimistic, messages), [optimistic, messages]);
  const replyMessage = replyingToId ? messages.find((message) => message.id === replyingToId) ?? null : null;
  const matchingIds = useMemo(() => {
    const term = threadQuery.trim().toLowerCase();
    if (!term) return new Set<string>();
    return new Set(messages.filter((message) => previewText(message).toLowerCase().includes(term)).map((message) => message.id));
  }, [messages, threadQuery]);

  function openConversation(conversationId: string) {
    setSelectedId(conversationId);
    setMessages([]);
    setReplyContexts({});
    setReplyingToId(null);
    setOptimistic([]);
    setThreadSearchOpen(false);
    setThreadQuery("");
    void loadConversation(conversationId);
  }

  function closeConversation() {
    setSelectedId(null);
    setMessages([]);
    setReplyContexts({});
    setReplyingToId(null);
    setMentionCandidates([]);
    setSettingsOpen(false);
    setThreadSearchOpen(false);
    if (requestedConversationId) router.replace("/messages", { scroll: false });
  }

  function toggleFavorite(conversation: ConversationView) {
    const next = !conversation.pinned;
    setConversations((current) => current.map((row) => (row.id === conversation.id ? { ...row, pinned: next } : row)));
    startTransition(async () => {
      const result = await setConversationPinnedAction(conversation.id, next).catch(() => ({ ok: false, message: "Could not update favorite." }));
      if (!result.ok) {
        setConversations((current) => current.map((row) => (row.id === conversation.id ? { ...row, pinned: !next } : row)));
        setFeedback(result.message);
      }
    });
  }

  function toggleMute(conversation: ConversationView) {
    startTransition(async () => {
      const result = await muteConversationAction(conversation.id, conversation.muted ? 0 : 8).catch(() => ({ ok: false, message: "Could not update mute." }));
      if (!result.ok) {
        setFeedback(result.message);
        return;
      }
      setConversations((current) => current.map((row) => (row.id === conversation.id ? { ...row, muted: !conversation.muted } : row)));
    });
  }

  function hideConversation(conversation: ConversationView) {
    const previous = conversations;
    setConversations((current) => current.filter((row) => row.id !== conversation.id));
    if (selectedId === conversation.id) closeConversation();
    startTransition(async () => {
      const result = await setConversationHiddenAction(conversation.id, true).catch(() => ({ ok: false, message: "Could not hide chat." }));
      if (!result.ok) {
        setConversations(previous);
        setFeedback(result.message);
      }
    });
  }

  const addOptimistic = useCallback((draft: OptimisticSendDraftV3) => {
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

  const settleOptimistic = useCallback((clientMessageId: string, outcome: "sent" | "failed") => {
    setOptimistic((current) => (outcome === "failed" ? markFailed(current, clientMessageId) : markRetrying(current, clientMessageId)));
  }, []);

  function retryOptimistic(clientMessageId: string) {
    const draft = retryDraftsRef.current.get(clientMessageId);
    if (!draft || !selectedId || draft.kind !== "text") return;
    setOptimistic((current) => markRetrying(current, clientMessageId));
    startTransition(async () => {
      const result = await sendMessageAction({ conversationId: selectedId, text: draft.text ?? "", clientMessageId }).catch(() => ({ ok: false, message: "Could not retry." }));
      if (!result.ok) {
        setOptimistic((current) => markFailed(current, clientMessageId));
        setFeedback(result.message);
        return;
      }
      await refreshMessages(selectedId);
      await syncConversations();
    });
  }

  function react(messageId: string, reaction: string) {
    if (!selectedId) return;
    setReactingId(null);
    startTransition(async () => {
      const result = await reactToMessageAction(messageId, reaction).catch(() => ({ ok: false, message: "Could not react." }));
      if (!result.ok) setFeedback(result.message);
      await refreshMessages(selectedId);
    });
  }

  function saveEdit(messageId: string) {
    if (!selectedId || !editDraft.trim()) return;
    const existingMentions = messages.find((message) => message.id === messageId)?.mentions ?? [];
    startTransition(async () => {
      const result = await editMessageAction(messageId, editDraft.trim(), existingMentions.map((mention) => mention.userId)).catch(() => ({ ok: false, message: "Could not edit." }));
      if (!result.ok) setFeedback(result.message);
      setEditingId(null);
      await refreshMessages(selectedId);
      await syncConversations();
    });
  }

  function removeMessage(messageId: string, forEveryone = true) {
    if (!selectedId) return;
    startTransition(async () => {
      const result = await deleteMessageAction(messageId, forEveryone).catch(() => ({ ok: false, message: "Could not delete." }));
      if (!result.ok) setFeedback(result.message);
      await refreshMessages(selectedId);
      await syncConversations();
    });
  }

  function handleBubblePointerDown(messageId: string, event: React.PointerEvent<HTMLDivElement>) {
    swipeStartRef.current.set(messageId, { x: event.clientX, y: event.clientY });
  }

  function handleBubblePointerUp(messageId: string, event: React.PointerEvent<HTMLDivElement>) {
    const start = swipeStartRef.current.get(messageId);
    swipeStartRef.current.delete(messageId);
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (dx > 62 && Math.abs(dy) < 54) setReplyingToId(messageId);
  }

  const updateMessageAttachment = useCallback((messageId: string, attachment: AttachmentView) => {
    setMessages((current) => current.map((message) => (message.id === messageId ? { ...message, attachment } : message)));
  }, []);

  const threadMenuItems = selected
    ? [
        { id: "favorite", label: selected.pinned ? "Remove favorite" : "Favorite chat", onSelect: () => toggleFavorite(selected) },
        { id: "mute", label: selected.muted ? "Unmute" : "Mute for 8 hours", onSelect: () => toggleMute(selected) },
        { id: "settings", label: selected.kind === "group" ? "Group Settings" : "Chat Settings", onSelect: () => setSettingsOpen(true) },
        ...(selected.kind === "group" ? [{ id: "group", label: "Full group details", onSelect: () => router.push(`/groups/${selected.id}` as Route) }] : []),
        ...(selected.otherUsername ? [{ id: "profile", label: "View profile", onSelect: () => router.push(`/friends/${selected.otherUsername}` as Route) }] : []),
        ...(selected.kind === "direct" ? [{ id: "hide", label: "Hide chat", onSelect: () => hideConversation(selected) }] : [])
      ]
    : [];

  return (
    <div className="mx-auto w-full max-w-[1240px] pb-3">
      {feedback ? (
        <div role="status" className="mb-2 rounded-2xl border border-[#E88C2B]/20 bg-[#E88C2B]/10 px-4 py-3 text-sm text-[#4E0401] dark:text-orange-100">
          {feedback}
        </div>
      ) : null}

      <div className="grid min-h-[620px] overflow-hidden md:rounded-[28px] md:border md:border-border/60 md:bg-card/45 md:shadow-[0_24px_80px_rgba(78,4,1,0.08)] lg:grid-cols-[390px_minmax(0,1fr)]">
        <aside className={cn("min-w-0 bg-[#FEFBF3] dark:bg-background lg:border-r lg:border-border/60", selectedId && "hidden lg:flex lg:flex-col")}>
          <div className="sticky top-0 z-10 border-b border-black/[0.04] bg-[#FEFBF3]/95 px-3 pb-3 pt-[max(.55rem,env(safe-area-inset-top))] backdrop-blur-xl dark:border-white/[0.06] dark:bg-background/95 sm:px-4 md:px-5">
            <div className="flex items-center justify-between gap-3">
              <h1 className="font-serif text-[2.2rem] font-semibold leading-none tracking-[-0.04em] text-[#4E0401] dark:text-orange-50">Chats</h1>
              <button type="button" onClick={() => setNewMessageOpen(true)} className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#E88C2B] text-white shadow-[0_8px_22px_rgba(232,140,43,0.28)] transition-transform active:scale-95" aria-label="New chat">
                <PenSquare className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" className="h-11 rounded-2xl border-transparent bg-black/[0.035] pl-10 shadow-none dark:bg-white/[0.055]" />
            </div>

            <nav aria-label="Chat filters" className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
              {FILTERS.map((filter) => {
                const active = activeFilter === filter.id;
                return (
                  <button key={filter.id} type="button" onClick={() => setActiveFilter(filter.id)} aria-current={active ? "page" : undefined} className={cn("focus-ring inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition", active ? "border-[#E88C2B]/35 bg-[#E88C2B]/12 text-[#4E0401] shadow-sm dark:text-orange-100" : "border-black/[0.06] bg-white/60 text-muted-foreground hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.03]")}>
                    {filter.label}
                    {filter.id === "unread" && unreadChats > 0 ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#E88C2B] px-1 text-[10px] font-bold text-white">{unreadChats}</span> : null}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 md:px-3">
            {filteredConversations.length === 0 ? (
              <EmptyState icon={MessageCircle} title="No chats here" description="Try another filter or start a new chat." action={<Button onClick={() => setNewMessageOpen(true)}>New chat</Button>} />
            ) : (
              <ul className="space-y-1">
                {filteredConversations.map((conversation) => (
                  <li key={conversation.id}>
                    <div className="group relative flex items-center rounded-[20px] transition hover:bg-white/70 dark:hover:bg-white/[0.035]">
                      <button type="button" onClick={() => openConversation(conversation.id)} className="focus-ring flex min-h-[76px] min-w-0 flex-1 items-center gap-3 rounded-[20px] px-3 py-2.5 text-left">
                        <div className="relative shrink-0">
                          <GlowAvatar name={conversation.title} src={conversation.avatarUrl} size="sm" membershipTier={publicMembershipTier(conversation.otherPlan)} />
                          {conversation.kind === "group" ? <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border-2 border-[#FEFBF3] bg-[#4E0401] text-[#FEFBF3] dark:border-background"><UsersRound className="h-2.5 w-2.5" /></span> : null}
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className={cn("truncate text-[0.95rem]", conversation.unreadCount > 0 ? "font-bold" : "font-semibold")}>{conversation.title}</span>
                            <PremiumPlanBadge plan={conversation.otherPlan} compact />
                            <TrustedMemberMark trustedSince={conversation.otherTrustedSince} compact />
                            <VerifiedAccountMark isVerifiedAccount={conversation.otherIsVerifiedAccount} compact />
                            {conversation.pinned ? <Star className="h-3 w-3 shrink-0 fill-[#E88C2B] text-[#E88C2B]" /> : null}
                            {conversation.kind === "plan" || conversation.kind === "event" ? <span className="rounded-md bg-[#E88C2B]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#E88C2B]">{conversation.kind}</span> : null}
                          </span>
                          <span className={cn("mt-1 block truncate text-[0.82rem]", conversation.unreadCount > 0 ? "font-medium text-foreground/75" : "text-muted-foreground")}>{conversation.lastMessagePreview ?? "No messages yet"}</span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1.5 pl-1">
                          <span className={cn("text-[10px]", conversation.unreadCount > 0 ? "font-semibold text-[#E88C2B]" : "text-muted-foreground")}>{conversation.lastMessageAt ? formatRelativeTime(conversation.lastMessageAt) : ""}</span>
                          {conversation.unreadCount > 0 ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#E88C2B] px-1.5 text-[10px] font-bold text-white">{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</span> : conversation.muted ? <BellOff className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                        </span>
                      </button>
                      <AppMenu
                        label={`Actions for ${conversation.title}`}
                        side="bottom"
                        align="end"
                        items={[
                          { id: "favorite", label: conversation.pinned ? "Remove favorite" : "Favorite", onSelect: () => toggleFavorite(conversation) },
                          { id: "mute", label: conversation.muted ? "Unmute" : "Mute for 8 hours", onSelect: () => toggleMute(conversation) },
                          ...(conversation.kind === "group" ? [{ id: "group", label: "Group details", onSelect: () => router.push(`/groups/${conversation.id}` as Route) }] : []),
                          ...(conversation.otherUsername ? [{ id: "profile", label: "View profile", onSelect: () => router.push(`/friends/${conversation.otherUsername}` as Route) }] : []),
                          ...(conversation.kind === "direct" ? [{ id: "hide", label: "Hide chat", onSelect: () => hideConversation(conversation) }] : [])
                        ]}
                        trigger={<button type="button" className="focus-ring mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.06]" aria-label={`Actions for ${conversation.title}`}><EllipsisVertical className="h-4 w-4" /></button>}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <main className={cn("min-w-0 bg-[#FFFDFC] dark:bg-background", "fixed inset-0 z-30 flex h-[100dvh] flex-col lg:static lg:z-auto lg:h-[min(790px,calc(100dvh-3rem))]", !selectedId && "hidden lg:flex")}>
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <div className="grid h-20 w-20 place-items-center rounded-[28px] bg-[#E88C2B]/10 text-[#E88C2B]"><MessageCircle className="h-8 w-8" /></div>
              <h2 className="mt-5 text-xl font-semibold tracking-tight">Choose a chat</h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Message a Muddy, continue a Group, or pick up a Plan chat.</p>
            </div>
          ) : (
            <>
              <header className="shrink-0 border-b border-black/[0.05] bg-[#FFFDFC]/95 pt-[max(.35rem,env(safe-area-inset-top))] backdrop-blur-xl dark:border-white/[0.06] dark:bg-background/95 lg:pt-0">
                <div className="flex min-h-[64px] items-center gap-2 px-2.5 md:px-4">
                  <button type="button" onClick={closeConversation} aria-label="Back to Chats" className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.06] lg:hidden"><ArrowLeft className="h-5 w-5" /></button>
                  <button type="button" onClick={() => setSettingsOpen(true)} className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl p-1 text-left hover:bg-black/[0.035] dark:hover:bg-white/[0.05]">
                    <GlowAvatar name={selected.title} src={selected.avatarUrl} size="sm" membershipTier={publicMembershipTier(selected.otherPlan)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5"><span className="truncate text-[0.98rem] font-bold">{selected.title}</span><PremiumPlanBadge plan={selected.otherPlan} compact /></span>
                      <span className={cn("mt-0.5 block truncate text-[11px] font-medium", selectedContext.shared ? "text-[#E88C2B]" : "text-muted-foreground")}>{selectedContext.subtitle ?? (selected.kind === "group" ? "Group chat" : selected.otherUsername ? `@${selected.otherUsername}` : "Chat")}</span>
                    </span>
                  </button>
                  <button type="button" onClick={() => setThreadSearchOpen((open) => !open)} className="focus-ring grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" aria-label="Search chat"><Search className="h-4.5 w-4.5" /></button>
                  <AppMenu label="Chat options" side="bottom" align="end" items={threadMenuItems} trigger={<button type="button" className="focus-ring grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" aria-label="Chat options"><EllipsisVertical className="h-4.5 w-4.5" /></button>} />
                </div>
                {threadSearchOpen ? (
                  <div className="flex items-center gap-2 px-3 pb-3 md:px-4">
                    <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input autoFocus value={threadQuery} onChange={(event) => setThreadQuery(event.target.value)} placeholder={`Search ${selected.title}`} className="h-10 rounded-2xl border-transparent bg-black/[0.04] pl-10 shadow-none dark:bg-white/[0.055]" /></div>
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">{threadQuery.trim() ? `${matchingIds.size} found` : ""}</span>
                    <button type="button" onClick={() => { setThreadSearchOpen(false); setThreadQuery(""); }} className="focus-ring grid h-10 w-10 place-items-center rounded-full text-muted-foreground" aria-label="Close search"><X className="h-4 w-4" /></button>
                  </div>
                ) : null}
              </header>

              {selected.contextBadge ? (
                <div className="shrink-0 px-3 pt-2 md:px-4">
                  <button type="button" onClick={() => selected.kind === "group" ? router.push(`/groups/${selected.id}` as Route) : router.push("/plans" as Route)} className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-[#E88C2B]/16 bg-[#E88C2B]/8 px-3.5 py-2.5 text-left hover:bg-[#E88C2B]/12">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-[#E88C2B]/15 text-[#E88C2B]">{selected.kind === "group" ? <UsersRound className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold uppercase tracking-[0.12em] text-[#E88C2B]">{selected.contextBadge}</span><span className="block truncate text-sm font-medium text-[#4E0401] dark:text-orange-100">{selectedContext.subtitle ?? "Open context"}</span></span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              ) : null}

              <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-3 md:px-5 md:pt-4">
                {loadingMessages ? (
                  <div className="grid h-full place-items-center"><Loader2 className="h-5 w-5 animate-spin text-[#E88C2B]" /></div>
                ) : messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center px-8 text-center"><GlowAvatar name={selected.title} src={selected.avatarUrl} size="lg" membershipTier={publicMembershipTier(selected.otherPlan)} /><h2 className="mt-4 text-lg font-semibold">{selected.title}</h2><p className="mt-1 text-sm text-muted-foreground">Say hello and start the chat.</p></div>
                ) : (
                  messages.map((message, index) => {
                    const previous = messages[index - 1];
                    const startsRun = startsNewRun(message, previous);
                    const reply = replyContexts[message.id];
                    return (
                      <Fragment key={message.id}>
                        {startsNewDay(message.createdAt, previous?.createdAt) ? <div className="my-4 flex justify-center"><span className="rounded-full bg-black/[0.035] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground dark:bg-white/[0.05]">{dayLabel(message.createdAt)}</span></div> : null}
                        {message.messageType === "system" ? (
                          <p className="mx-auto my-3 max-w-lg text-center text-[11px] font-medium leading-relaxed text-muted-foreground/80">{message.text}</p>
                        ) : (
                          <div className={cn("flex", message.isMine ? "justify-end" : "justify-start", startsRun ? "mt-3" : "mt-1")}>
                            <div className={cn("max-w-[84%] sm:max-w-[76%]", message.isMine && "flex flex-col items-end")}>
                              {!message.isMine && isGroup && startsRun ? <div className="mb-1 flex items-center gap-2 px-1"><UserAvatar src={message.senderAvatarUrl} name={message.senderName} size="xs" decorative /><span className="text-[11px] font-semibold text-muted-foreground">{message.senderName}</span></div> : null}
                              <div
                                className="touch-pan-y"
                                onPointerDown={(event) => handleBubblePointerDown(message.id, event)}
                                onPointerUp={(event) => handleBubblePointerUp(message.id, event)}
                                onDoubleClick={() => setReactingId(message.id)}
                                onContextMenu={(event) => { event.preventDefault(); setReactingId(message.id); }}
                              >
                                <div className={cn("relative overflow-hidden rounded-[21px] px-3.5 py-2.5 text-[0.94rem] leading-[1.42] shadow-[0_1px_2px_rgba(78,4,1,0.07)] transition", message.isMine ? "rounded-br-[7px] bg-[#4E0401] text-[#FEFBF3]" : "rounded-bl-[7px] border border-black/[0.035] bg-white text-foreground dark:border-white/[0.055] dark:bg-white/[0.07]", matchingIds.has(message.id) && "ring-2 ring-[#E88C2B]/70") }>
                                  {reply ? <div className={cn("mb-2 rounded-xl border-l-2 border-[#E88C2B] px-2.5 py-1.5 text-xs", message.isMine ? "bg-white/10" : "bg-[#E88C2B]/8")}><strong className={message.isMine ? "text-orange-200" : "text-[#E88C2B]"}>{reply.senderName}</strong><div className="mt-0.5 line-clamp-2 opacity-75">{reply.text}</div></div> : null}
                                  {!message.deleted && message.attachment ? <MessageAttachmentImage conversationId={selected.id} message={message} onOpen={() => setViewerMessageId(message.id)} onRefreshed={(attachment) => updateMessageAttachment(message.id, attachment)} /> : null}
                                  {!message.deleted && message.voice ? <VoiceMessageBubble conversationId={selected.id} messageId={message.id} senderName={message.isMine ? "you" : message.senderName} asset={message.voice} /> : null}
                                  {editingId === message.id ? (
                                    <form method="post" className="flex min-w-[230px] items-center gap-2" onSubmit={(event) => { event.preventDefault(); saveEdit(message.id); }}><Input value={editDraft} onChange={(event) => setEditDraft(event.target.value)} autoFocus maxLength={2000} className="h-8 bg-white text-foreground" /><Button type="submit" size="sm" disabled={!editDraft.trim() || isPending}>Save</Button></form>
                                  ) : message.text ? <SafeMessageText text={message.deleted ? DELETED_MESSAGE_PLACEHOLDER : message.text} mentions={message.mentions} /> : null}
                                  {message.editedAt && !message.deleted ? <span className={cn("ml-1 text-[10px]", message.isMine ? "text-white/55" : "text-muted-foreground")}>edited</span> : null}
                                  <div className={cn("mt-1 flex items-center justify-end gap-1 text-[9px] font-medium", message.isMine ? "text-white/55" : "text-muted-foreground/75")}><span>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(message.createdAt))}</span>{message.isMine ? stateIcon(message.state) : null}</div>
                                </div>
                              </div>

                              {message.myReaction ? <button type="button" onClick={() => react(message.id, message.myReaction as string)} className="focus-ring -mt-2 mx-2 grid h-7 min-w-7 place-items-center rounded-full border border-black/[0.06] bg-white px-1.5 text-sm shadow-sm dark:border-white/[0.08] dark:bg-[#241f1c]">{reactionEmoji(message.myReaction)}</button> : null}
                              {reactingId === message.id ? (
                                <div className={cn("mt-1 flex flex-wrap items-center gap-0.5 rounded-2xl border border-black/[0.05] bg-white p-1 shadow-lg dark:border-white/[0.08] dark:bg-[#241f1c]", message.isMine && "self-end")}>
                                  {REACTIONS.map((reaction) => <button key={reaction.id} type="button" onClick={() => react(message.id, reaction.id)} className="focus-ring grid h-9 w-9 place-items-center rounded-full text-base hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" aria-label={`React ${reaction.emoji}`}>{reaction.emoji}</button>)}
                                  <span className="mx-1 h-6 w-px bg-border" />
                                  <button type="button" onClick={() => { setReplyingToId(message.id); setReactingId(null); }} className="focus-ring rounded-full px-2.5 py-1.5 text-xs font-semibold hover:bg-black/[0.04]">Reply</button>
                                  {message.text ? <button type="button" onClick={() => void navigator.clipboard?.writeText(message.text ?? "")} className="focus-ring rounded-full px-2.5 py-1.5 text-xs font-semibold hover:bg-black/[0.04]">Copy</button> : null}
                                  {message.isMine && message.text ? <button type="button" onClick={() => { setEditingId(message.id); setEditDraft(message.text ?? ""); setReactingId(null); }} className="focus-ring rounded-full px-2.5 py-1.5 text-xs font-semibold hover:bg-black/[0.04]">Edit</button> : null}
                                  <button type="button" onClick={() => { removeMessage(message.id, !message.isMine ? false : true); setReactingId(null); }} className="focus-ring rounded-full px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10">Delete</button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        )}
                      </Fragment>
                    );
                  })
                )}

                {pendingMessages.map((message) => <div key={message.clientMessageId} className="mt-2 flex flex-col items-end"><div className={cn("max-w-[84%] rounded-[21px] rounded-br-[7px] bg-[#4E0401] px-3.5 py-2.5 text-[0.94rem] text-[#FEFBF3]", message.status === "pending" && "opacity-65")}>{message.kind === "voice" ? `Voice message${message.durationSeconds ? ` · ${Math.round(message.durationSeconds)}s` : ""}` : message.text}</div><div className="mt-1 flex items-center gap-2 px-1 text-[10px] font-medium text-muted-foreground">{message.status === "failed" ? <><span className="text-destructive">Not sent</span><button type="button" onClick={() => retryOptimistic(message.clientMessageId)} className="underline">Retry</button><button type="button" onClick={() => setOptimistic((current) => discardOptimistic(current, message.clientMessageId))} className="underline">Delete</button></> : <span>Sending…</span>}</div></div>)}
              </div>

              <MessageComposerV3
                key={selected.id}
                conversationId={selected.id}
                isGroup={selected.kind !== "direct"}
                mentionCandidates={mentionCandidates}
                voiceRecorderConfig={voiceRecorderConfig}
                placeholder={`Message ${selected.title}`}
                replyToMessageId={replyingToId}
                replyPreview={replyMessage ? { senderName: replyMessage.senderName, text: previewText(replyMessage) } : null}
                onCancelReply={() => setReplyingToId(null)}
                onFeedback={setFeedback}
                onOptimisticSend={addOptimistic}
                onOptimisticSettled={settleOptimistic}
                onSent={async () => {
                  await refreshMessages(selected.id);
                  await syncConversations();
                }}
                className="w-full border-0 bg-transparent pb-[max(.45rem,env(safe-area-inset-bottom))] lg:pb-1"
              />
            </>
          )}
        </main>
      </div>

      <NewChatModal open={newMessageOpen} onOpenChange={setNewMessageOpen} onSelect={(friendId) => {
        setNewMessageOpen(false);
        startTransition(async () => {
          const result = await openDirectConversationAction(friendId).catch(() => ({ ok: false, message: "Could not open chat.", conversationId: undefined }));
          if (!result.ok || !result.conversationId) {
            setFeedback(result.message);
            return;
          }
          pendingConversationIds.current.add(result.conversationId);
          openConversation(result.conversationId);
          await syncConversations();
        });
      }} onOpenGroups={() => { setNewMessageOpen(false); router.push("/groups" as Route); }} />

      {selected ? <ChatSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} conversation={selected} onToggleFavorite={() => toggleFavorite(selected)} onToggleMute={() => toggleMute(selected)} onSearch={() => { setSettingsOpen(false); setThreadSearchOpen(true); }} onGroupDetails={() => router.push(`/groups/${selected.id}` as Route)} /> : null}
      <MessageMediaViewer message={messages.find((message) => message.id === viewerMessageId) ?? null} open={Boolean(viewerMessageId)} onClose={() => setViewerMessageId(null)} />
    </div>
  );
}

function NewChatModal({ open, onOpenChange, onSelect, onOpenGroups }: { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (friendId: string) => void; onOpenGroups: () => void }) {
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
    <Modal open={open} onOpenChange={onOpenChange} title="New Chat" compact>
      <div className="space-y-3">
        <div className="relative"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Muddies or usernames" autoFocus className="h-11 rounded-2xl pl-10" /></div>
        <button type="button" onClick={onOpenGroups} className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-[#E88C2B]/15 bg-[#E88C2B]/8 p-3 text-left hover:bg-[#E88C2B]/12"><span className="grid h-10 w-10 place-items-center rounded-full bg-[#4E0401] text-[#FEFBF3]"><UsersRound className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Groups</span><span className="block text-xs text-muted-foreground">Open or create a group</span></span><ChevronRight className="h-4 w-4" /></button>
        {friends === null ? <div className="grid py-8 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-[#E88C2B]" /></div> : visible.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No Muddies match your search.</p> : <ul className="max-h-80 space-y-1 overflow-y-auto">{visible.map((friend) => <li key={friend.friendId}><button type="button" onClick={() => onSelect(friend.friendId)} className="focus-ring flex w-full items-center gap-3 rounded-2xl p-2.5 text-left hover:bg-secondary/70"><GlowAvatar name={friend.displayName} src={friend.avatarUrl} size="sm" membershipTier={publicMembershipTier(friend.plan)} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{friend.displayName}</span><span className="block truncate text-xs text-muted-foreground">@{friend.username}</span></span></button></li>)}</ul>}
      </div>
    </Modal>
  );
}

function ChatSettingsModal({ open, onOpenChange, conversation, onToggleFavorite, onToggleMute, onSearch, onGroupDetails }: { open: boolean; onOpenChange: (open: boolean) => void; conversation: ConversationView; onToggleFavorite: () => void; onToggleMute: () => void; onSearch: () => void; onGroupDetails: () => void }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={conversation.kind === "group" ? "Group Settings" : "Chat Settings"} compact>
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/70 p-3"><GlowAvatar name={conversation.title} src={conversation.avatarUrl} size="sm" membershipTier={publicMembershipTier(conversation.otherPlan)} /><div className="min-w-0 flex-1"><strong className="block truncate">{conversation.title}</strong><span className="text-xs text-muted-foreground">{conversation.kind === "group" ? "Group conversation" : conversation.otherUsername ? `@${conversation.otherUsername}` : "Conversation"}</span></div></div>
        <button type="button" onClick={onToggleMute} className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-border/60 p-3 text-left hover:bg-secondary/50"><BellOff className="h-5 w-5 text-[#E88C2B]" /><span className="min-w-0 flex-1"><strong className="block">{conversation.muted ? "Unmute notifications" : "Mute notifications"}</strong><span className="text-xs text-muted-foreground">{conversation.muted ? "Receive chat notifications again" : "Silence this chat for 8 hours"}</span></span></button>
        <button type="button" onClick={onToggleFavorite} className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-border/60 p-3 text-left hover:bg-secondary/50"><Star className={cn("h-5 w-5 text-[#E88C2B]", conversation.pinned && "fill-[#E88C2B]")} /><span className="min-w-0 flex-1"><strong className="block">{conversation.pinned ? "Remove favorite" : "Favorite chat"}</strong><span className="text-xs text-muted-foreground">Keep important chats easy to reach</span></span></button>
        <button type="button" onClick={onSearch} className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-border/60 p-3 text-left hover:bg-secondary/50"><Search className="h-5 w-5 text-[#E88C2B]" /><span className="min-w-0 flex-1"><strong className="block">Search in chat</strong><span className="text-xs text-muted-foreground">Find messages in this conversation</span></span><ChevronRight className="h-4 w-4 text-muted-foreground" /></button>
        {conversation.kind === "group" ? <button type="button" onClick={onGroupDetails} className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-border/60 p-3 text-left hover:bg-secondary/50"><UsersRound className="h-5 w-5 text-[#E88C2B]" /><span className="min-w-0 flex-1"><strong className="block">Group details</strong><span className="text-xs text-muted-foreground">Members, roles and group information</span></span><ChevronRight className="h-4 w-4 text-muted-foreground" /></button> : null}
        <div className="rounded-2xl border border-[#E88C2B]/15 bg-[#E88C2B]/7 p-3 text-xs leading-relaxed text-muted-foreground">More prototype settings such as chat themes, disappearing-message lifetimes, saved-message folders and generic chat polls require durable server contracts before they are switched on here. They are intentionally not fake toggles in production.</div>
      </div>
    </Modal>
  );
}
