"use client";

import { CloudOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  heartbeatConversationPresenceAction,
  updateConversationUserPreferencesAction
} from "@/app/(app)/messaging-ultimate-actions";
import {
  MessageComposerV3,
  type OptimisticSendDraftV3
} from "@/components/messaging/message-composer-v3";
import type { MentionCandidate } from "@/lib/messaging/mentions";
import {
  shouldPublishTypingPresence,
  TYPING_PRESENCE_HEARTBEAT_MS
} from "@/lib/messaging/typing-presence";
import type { VoiceRecorderConfig } from "@/lib/messaging/voice-recording";

const SERVER_DRAFT_DEBOUNCE_MS = 650;
const TYPING_IDLE_MS = 1800;
const LOCAL_DRAFT_CLEAR_GRACE_MS = 30_000;
/**
 * A short-lived optimistic tombstone for a draft that was just sent.
 *
 * The page can remount the same conversation from its warm controls cache
 * before the ordered server clear round-trip has returned. Without this, that
 * stale cached draft can repaint the text that was already sent. Thirty seconds
 * is only a convergence window, not durable draft state; any new typing clears
 * it immediately and the server remains canonical.
 */
const locallyClearedDraftUntil = new Map<string, number>();

function setControlledTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  );
  descriptor?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

export function MessageComposerV4Shell({
  conversationId,
  initialDraft,
  placeholder,
  isGroup,
  mentionCandidates,
  voiceRecorderConfig,
  replyToMessageId,
  replyPreview,
  onCancelReply,
  onFeedback,
  onOptimisticSend,
  onOptimisticSettled,
  onDraftCleared,
  confirmedClientMessageIds
}: {
  conversationId: string;
  initialDraft?: string | null;
  placeholder: string;
  isGroup: boolean;
  mentionCandidates: readonly MentionCandidate[];
  voiceRecorderConfig: VoiceRecorderConfig;
  replyToMessageId?: string | null;
  replyPreview?: { senderName: string; text: string } | null;
  onCancelReply?: () => void;
  onFeedback: (message: string) => void;
  onOptimisticSend?: (message: OptimisticSendDraftV3) => void;
  onOptimisticSettled?: (clientMessageId: string, outcome: "sent" | "failed" | "pending") => void;
  /** Clears the page/cache copy immediately when a successful send empties it. */
  onDraftCleared?: () => void;
  /**
   * Kept in the public prop contract for callers that also use this shell for
   * non-message mutations. Ordinary message sends intentionally do not invoke
   * it anymore: V4's callback performs a 200-row thread reload, while Realtime
   * already projects the canonical row and the page has a clientMessageId
   * resolver for ambiguous sends.
   */
  onSent: () => void | Promise<void>;
  confirmedClientMessageIds?: ReadonlySet<string>;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hydratedConversationRef = useRef<string | null>(null);
  const serverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingPublishedRef = useRef(false);
  const lastTypingPublishedAtRef = useRef(0);
  const lastDraftRef = useRef("");
  /**
   * Draft writes must be ordered. Previously a 650ms non-empty save could be
   * in flight while Send queued a clear; if the older request completed last,
   * the already-sent text resurrected as a draft on the next open.
   */
  const draftWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  /**
   * Message delivery failure already has a durable home directly beneath the
   * optimistic row (Not sent · Retry · Delete). MessageComposerV3 historically
   * emitted a second copy to page-level feedback immediately after marking the
   * row failed. Suppress exactly that next synchronous feedback call in V4;
   * recorder, attachment, structured-share and other feedback still passes.
   */
  const suppressNextDeliveryFeedbackRef = useRef(false);
  const [online, setOnline] = useState(true);

  const syncDraftToServer = useCallback(
    (value: string) => {
      const next = draftWriteChainRef.current
        .catch(() => undefined)
        .then(async () => {
          await updateConversationUserPreferencesAction({
            conversationId,
            draftText: value || null
          }).catch(() => {
            // The current textarea remains the local source if the network drops.
          });
        });
      draftWriteChainRef.current = next;
      return next;
    }, [conversationId]
  );

  useEffect(() => {
    const update = () => {
      const nextOnline = navigator.onLine;
      setOnline(nextOnline);
      if (nextOnline && lastDraftRef.current) {
        void syncDraftToServer(lastDraftRef.current);
      }
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [syncDraftToServer]);

  useEffect(() => {
    if (hydratedConversationRef.current === conversationId) return;
    const textarea = shellRef.current?.querySelector("textarea");
    if (!textarea) return;
    const clearUntil = locallyClearedDraftUntil.get(conversationId) ?? 0;
    const suppressStaleDraft = clearUntil > Date.now();
    if (!suppressStaleDraft && clearUntil) locallyClearedDraftUntil.delete(conversationId);
    const value = suppressStaleDraft ? "" : initialDraft || "";
    lastDraftRef.current = value;
    hydratedConversationRef.current = conversationId;
    if (value && !textarea.value) setControlledTextareaValue(textarea, value);
  }, [conversationId, initialDraft]);

  const persistDraft = useCallback(
    (value: string) => {
      lastDraftRef.current = value;
      if (serverTimerRef.current) clearTimeout(serverTimerRef.current);
      serverTimerRef.current = setTimeout(() => {
        serverTimerRef.current = null;
        void syncDraftToServer(value);
      }, SERVER_DRAFT_DEBOUNCE_MS);
    }, [syncDraftToServer]
  );

  const publishTyping = useCallback(
    (typing: boolean) => {
      const now = Date.now();
      if (!shouldPublishTypingPresence({
        typing,
        wasTyping: typingPublishedRef.current,
        lastPublishedAt: lastTypingPublishedAtRef.current,
        now,
        heartbeatMs: TYPING_PRESENCE_HEARTBEAT_MS
      })) {
        return;
      }

      typingPublishedRef.current = typing;
      lastTypingPublishedAtRef.current = now;
      void heartbeatConversationPresenceAction({ conversationId, typing }).catch(() => {
        // Presence is transient and must never block composing a message.
      });
    }, [conversationId]
  );

  useEffect(() => {
    return () => {
      if (serverTimerRef.current) clearTimeout(serverTimerRef.current);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      // Flush EVEN AN EMPTY value. The old cleanup only flushed truthy text,
      // so leaving within the debounce window cancelled the very clear that a
      // successful Send had scheduled and resurrected the server draft.
      void syncDraftToServer(lastDraftRef.current);
    };
  }, [syncDraftToServer]);

  function onInputCapture(event: React.FormEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    const value = target.value;
    // New user input supersedes a prior sent-draft tombstone immediately.
    locallyClearedDraftUntil.delete(conversationId);
    const typing = Boolean(value.trim());
    persistDraft(value);
    publishTyping(typing);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = typing
      ? setTimeout(() => publishTyping(false), TYPING_IDLE_MS)
      : null;
  }

  const handleOptimisticSettled = useCallback((clientMessageId: string, outcome: "sent" | "failed" | "pending") => {
    if (outcome === "failed") {
      suppressNextDeliveryFeedbackRef.current = true;
      // Upload failure can mark an optimistic voice row failed without emitting
      // page feedback afterward. Clear the one-shot marker after this stack so
      // an unrelated later error is never swallowed.
      queueMicrotask(() => {
        suppressNextDeliveryFeedbackRef.current = false;
      });
    }
    onOptimisticSettled?.(clientMessageId, outcome);
  }, [onOptimisticSettled]);

  const handleComposerFeedback = useCallback((message: string) => {
    if (message && suppressNextDeliveryFeedbackRef.current) {
      suppressNextDeliveryFeedbackRef.current = false;
      return;
    }
    onFeedback(message);
  }, [onFeedback]);

  function handleSent() {
    // A sent message is not a draft. Clear locally and enqueue the server clear
    // NOW rather than debouncing it; the serialized write chain guarantees any
    // older non-empty save finishes first and can never win afterward.
    if (serverTimerRef.current) {
      clearTimeout(serverTimerRef.current);
      serverTimerRef.current = null;
    }
    lastDraftRef.current = "";
    locallyClearedDraftUntil.set(conversationId, Date.now() + LOCAL_DRAFT_CLEAR_GRACE_MS);
    void syncDraftToServer("");
    onDraftCleared?.();
    publishTyping(false);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    /*
     * Do NOT immediately call the page's onSent callback here.
     *
     * MessagesPageV4 historically used that callback to refetch the complete
     * conversation after every successful/ambiguous send. An optimistic bubble
     * was already visible, then a redundant 200-row reload could time out and
     * paint a global error over an otherwise usable thread.
     *
     * The canonical path is local optimistic row -> durable API ack -> Realtime
     * one-message projection. Ambiguous sends are resolved by clientMessageId.
     */
  }

  return (
    <div ref={shellRef} data-chat-composer onInputCapture={onInputCapture} className="relative shrink-0">
      {!online ? (
        <div className="absolute bottom-full left-1/2 z-20 mb-1 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border/70 bg-card/95 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-md animate-in fade-in slide-in-from-bottom-1">
          <CloudOff className="h-3 w-3" />
          Offline · draft stays on this screen
        </div>
      ) : null}
      <MessageComposerV3
        conversationId={conversationId}
        isGroup={isGroup}
        mentionCandidates={mentionCandidates}
        voiceRecorderConfig={voiceRecorderConfig}
        placeholder={placeholder}
        replyToMessageId={replyToMessageId}
        replyPreview={replyPreview}
        onCancelReply={onCancelReply}
        onFeedback={handleComposerFeedback}
        onOptimisticSend={onOptimisticSend}
        onOptimisticSettled={handleOptimisticSettled}
        onSent={handleSent}
        confirmedClientMessageIds={confirmedClientMessageIds}
        className="w-full border-0 bg-transparent pb-[max(.45rem,env(safe-area-inset-bottom))] lg:pb-1"
      />
    </div>
  );
}
