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
import type { VoiceRecorderConfig } from "@/lib/messaging/voice-recording";

const SERVER_DRAFT_DEBOUNCE_MS = 650;
const TYPING_IDLE_MS = 1800;

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
  onSent
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
  onOptimisticSettled?: (clientMessageId: string, outcome: "sent" | "failed") => void;
  onSent: () => void | Promise<void>;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hydratedConversationRef = useRef<string | null>(null);
  const serverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDraftRef = useRef("");
  const [online, setOnline] = useState(true);

  const localKey = `mb:chat-draft:${conversationId}`;

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (hydratedConversationRef.current === conversationId) return;
    const textarea = shellRef.current?.querySelector("textarea");
    if (!textarea) return;
    let local = "";
    try {
      local = localStorage.getItem(localKey) ?? "";
    } catch {
      // Storage can be unavailable in strict/private browser modes.
    }
    const value = local || initialDraft || "";
    lastDraftRef.current = value;
    hydratedConversationRef.current = conversationId;
    if (value && !textarea.value) setControlledTextareaValue(textarea, value);
  }, [conversationId, initialDraft, localKey]);

  const persistDraft = useCallback(
    (value: string) => {
      lastDraftRef.current = value;
      try {
        if (value) localStorage.setItem(localKey, value);
        else localStorage.removeItem(localKey);
      } catch {
        // Server persistence below remains the durable fallback.
      }
      if (serverTimerRef.current) clearTimeout(serverTimerRef.current);
      serverTimerRef.current = setTimeout(() => {
        void updateConversationUserPreferencesAction({
          conversationId,
          draftText: value || null
        });
      }, SERVER_DRAFT_DEBOUNCE_MS);
    },
    [conversationId, localKey]
  );

  const publishTyping = useCallback(
    (typing: boolean) => {
      void heartbeatConversationPresenceAction({ conversationId, typing });
    },
    [conversationId]
  );

  useEffect(() => {
    return () => {
      if (serverTimerRef.current) clearTimeout(serverTimerRef.current);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      const pending = lastDraftRef.current;
      if (pending) {
        void updateConversationUserPreferencesAction({
          conversationId,
          draftText: pending
        });
      }
    };
  }, [conversationId]);

  function onInputCapture(event: React.FormEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    const value = target.value;
    persistDraft(value);
    publishTyping(Boolean(value.trim()));
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => publishTyping(false), TYPING_IDLE_MS);
  }

  async function handleSent() {
    persistDraft("");
    publishTyping(false);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    await onSent();
  }

  return (
    <div ref={shellRef} onInputCapture={onInputCapture} className="relative">
      {!online ? (
        <div className="absolute bottom-full left-1/2 z-20 mb-1 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border/70 bg-card/95 px-3 py-1 text-[10px] font-semibold text-muted-foreground shadow-sm backdrop-blur-md animate-in fade-in slide-in-from-bottom-1">
          <CloudOff className="h-3 w-3" />
          Offline · draft saved
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
        onFeedback={onFeedback}
        onOptimisticSend={onOptimisticSend}
        onOptimisticSettled={onOptimisticSettled}
        onSent={handleSent}
        className="w-full border-0 bg-transparent pb-[max(.45rem,env(safe-area-inset-bottom))] lg:pb-1"
      />
    </div>
  );
}
