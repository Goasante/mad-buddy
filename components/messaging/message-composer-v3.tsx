"use client";

import { ArrowUp, AtSign, Loader2, Lock, Mic, Pause, Play, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { sendMessageAction } from "@/app/(app)/messaging-actions";
import {
  AttachmentPicker,
  AttachmentPreview,
  discardAttachment,
  type AttachmentUploadLifecycle,
  type SelectedAttachment
} from "@/components/messaging/attachment-picker";
import { LiveVoiceWaveform, StaticVoiceWaveform } from "@/components/messaging/voice-waveform-bar";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { useVoiceUpload } from "@/hooks/use-voice-upload";
import {
  applyMentionSelection,
  filterMentionCandidates,
  findMentionTrigger,
  mentionUserIdsForSend,
  reconcileMentions,
  type MentionCandidate,
  type MentionTrigger,
  type StructuredMention
} from "@/lib/messaging/mentions";
import type { VoiceRecorderConfig } from "@/lib/messaging/voice-recording";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
import { cn } from "@/lib/utils";

export type OptimisticSendDraftV3 = {
  clientMessageId: string;
  text: string | null;
  kind: "text" | "voice";
  durationSeconds: number | null;
};

type Props = {
  conversationId: string;
  placeholder: string;
  onFeedback: (message: string) => void;
  onSent: () => void | Promise<void>;
  onOptimisticSend?: (message: OptimisticSendDraftV3) => void;
  onOptimisticSettled?: (clientMessageId: string, outcome: "sent" | "failed") => void;
  voiceRecorderConfig: VoiceRecorderConfig;
  className?: string;
  isGroup?: boolean;
  mentionCandidates?: readonly MentionCandidate[];
  replyToMessageId?: string | null;
  replyPreview?: { senderName: string; text: string } | null;
  onCancelReply?: () => void;
};

const MAX_FIELD_PX = 148;
const CANCEL_DISTANCE = 76;
const LOCK_DISTANCE = 72;

function formatDuration(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function MessageComposerV3({
  conversationId,
  placeholder,
  onFeedback,
  onSent,
  onOptimisticSend,
  onOptimisticSettled,
  voiceRecorderConfig,
  className,
  isGroup = false,
  mentionCandidates = [],
  replyToMessageId = null,
  replyPreview = null,
  onCancelReply
}: Props) {
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<StructuredMention[]>([]);
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [activeMention, setActiveMention] = useState(0);
  const [attachment, setAttachment] = useState<SelectedAttachment | null>(null);
  const [uploadState, setUploadState] = useState<AttachmentUploadLifecycle>("idle");
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const clientMessageIdRef = useRef<string | null>(null);

  const voice = useVoiceRecorder(conversationId, voiceRecorderConfig);
  const voiceUpload = useVoiceUpload(conversationId);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playedSeconds, setPlayedSeconds] = useState(0);
  const [locked, setLocked] = useState(false);
  const [gesture, setGesture] = useState<"idle" | "holding" | "cancel" | "lock">("idle");
  const pointerStartRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const sendOnNextTakeRef = useRef(false);
  const sendingRef = useRef(false);

  useEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, MAX_FIELD_PX)}px`;
  }, [draft]);

  const uploadBusy = uploadState === "selected" || uploadState === "uploading" || uploadState === "processing";
  const recording = voice.state.kind === "recording";
  const awaitingPermission = voice.state.kind === "requesting_permission";
  const preparing = voice.state.kind === "stopping" || voice.state.kind === "processing";
  const reviewing = voice.state.kind === "preview";
  const voiceSupported = voiceRecorderConfig.enabled && voice.capability.supported;
  const canSendText = Boolean(draft.trim() || attachment);
  const busySending = isPending || voiceUpload.state.kind === "uploading" || voiceUpload.state.kind === "finalizing";

  const mentionSuggestions = useMemo(
    () => (trigger ? filterMentionCandidates(mentionCandidates, trigger.query) : []),
    [mentionCandidates, trigger]
  );
  const mentionPickerOpen = Boolean(trigger) && mentionCandidates.length > 0;

  function handleDraftChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    setDraft(value);
    setMentions((current) => reconcileMentions(value, current));
    if (!isGroup || mentionCandidates.length === 0) return;
    setTrigger(findMentionTrigger(value, event.target.selectionStart ?? value.length));
    setActiveMention(0);
  }

  function chooseMention(candidate: MentionCandidate) {
    if (!trigger) return;
    const { text, caret } = applyMentionSelection(draft, trigger, candidate);
    setDraft(text);
    setMentions((current) => [
      ...current.filter((mention) => mention.userId !== candidate.userId),
      { userId: candidate.userId, displayName: candidate.displayName }
    ]);
    setTrigger(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionPickerOpen && mentionSuggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveMention((index) => (index + 1) % mentionSuggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveMention((index) => (index - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        chooseMention(mentionSuggestions[activeMention] ?? mentionSuggestions[0]);
        return;
      }
      if (event.key === "Escape") {
        setTrigger(null);
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    sendText();
  }

  function sendText() {
    const text = draft.trim();
    if ((!text && !attachment) || uploadBusy) return;
    const clientMessageId = clientMessageIdRef.current ?? crypto.randomUUID();
    const mentionIds = mentionUserIdsForSend(reconcileMentions(text, mentions), "");
    const mediaId = attachment?.mediaId;
    onOptimisticSend?.({ clientMessageId, text: text || null, kind: "text", durationSeconds: null });
    setDraft("");
    setMentions([]);
    setTrigger(null);
    setAttachment(null);
    setUploadState("idle");
    clientMessageIdRef.current = null;
    const replyId = replyToMessageId ?? undefined;
    onCancelReply?.();
    onFeedback("");

    startTransition(async () => {
      try {
        const result = await withTimeout(
          sendMessageAction({
            conversationId,
            text,
            mediaId,
            mentionUserIds: mentionIds,
            replyToMessageId: replyId,
            clientMessageId
          }),
          { operation: "send message" }
        );
        if (!result.ok) {
          onOptimisticSettled?.(clientMessageId, "failed");
          onFeedback(result.message);
          return;
        }
        onOptimisticSettled?.(clientMessageId, "sent");
        await onSent();
      } catch (error) {
        onOptimisticSettled?.(clientMessageId, "failed");
        onFeedback(
          isRequestTimeoutError(error)
            ? "Sending took too long. Your message was kept so you can try again."
            : "The message could not be sent. Try again."
        );
      }
    });
  }

  const sendVoice = useCallback(
    async (take: Parameters<typeof voiceUpload.upload>[0]) => {
      if (sendingRef.current) return;
      sendingRef.current = true;
      onFeedback("");
      const clientMessageId = crypto.randomUUID();
      onOptimisticSend?.({
        clientMessageId,
        text: null,
        kind: "voice",
        durationSeconds: take.durationSeconds
      });
      try {
        const prepared = await voiceUpload.upload(take);
        if (!prepared) {
          onOptimisticSettled?.(clientMessageId, "failed");
          return;
        }
        const result = await withTimeout(
          sendMessageAction({
            conversationId,
            mediaId: prepared.mediaId,
            clientMessageId,
            replyToMessageId: replyToMessageId ?? undefined
          }),
          { operation: "send voice message" }
        );
        if (!result.ok) {
          onOptimisticSettled?.(clientMessageId, "failed");
          onFeedback(result.message);
          return;
        }
        onOptimisticSettled?.(clientMessageId, "sent");
        onCancelReply?.();
        voiceUpload.reset();
        voice.cancel();
        setLocked(false);
        setGesture("idle");
        await onSent();
      } catch (error) {
        onOptimisticSettled?.(clientMessageId, "failed");
        onFeedback(
          isRequestTimeoutError(error)
            ? "Sending took too long. Your recording was kept so you can try again."
            : "Couldn't send that voice message. Try again."
        );
      } finally {
        sendingRef.current = false;
      }
    },
    [conversationId, onCancelReply, onFeedback, onOptimisticSend, onOptimisticSettled, onSent, replyToMessageId, voice, voiceUpload]
  );

  useEffect(() => {
    if (!sendOnNextTakeRef.current || voice.state.kind !== "preview") return;
    const take = voice.state.recording;
    sendOnNextTakeRef.current = false;
    const handle = setTimeout(() => void sendVoice(take), 0);
    return () => clearTimeout(handle);
  }, [sendVoice, voice.state]);

  function cancelRecording() {
    sendOnNextTakeRef.current = false;
    voiceUpload.reset();
    voice.cancel();
    setLocked(false);
    setGesture("idle");
    pointerStartRef.current = null;
  }

  async function startHold(event: React.PointerEvent<HTMLButtonElement>) {
    if (attachment || uploadBusy || isPending) return;
    pointerStartRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setGesture("holding");
    voiceUpload.reset();
    await voice.start();
  }

  function moveHold(event: React.PointerEvent<HTMLButtonElement>) {
    const start = pointerStartRef.current;
    if (!start || locked) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (dx <= -CANCEL_DISTANCE) setGesture("cancel");
    else if (dy <= -LOCK_DISTANCE) setGesture("lock");
    else setGesture("holding");
  }

  function finishHold(event: React.PointerEvent<HTMLButtonElement>) {
    const start = pointerStartRef.current;
    if (!start || start.id !== event.pointerId) return;
    pointerStartRef.current = null;
    if (gesture === "cancel") {
      cancelRecording();
      return;
    }
    if (gesture === "lock") {
      setLocked(true);
      setGesture("idle");
      return;
    }
    if (voice.state.kind === "recording") {
      sendOnNextTakeRef.current = true;
      voice.stop();
    }
    setGesture("idle");
  }

  const voiceError =
    voice.state.kind === "failed"
      ? voice.state.message
      : voiceUpload.state.kind === "failed"
        ? voiceUpload.state.message
        : null;

  if (recording || preparing || awaitingPermission) {
    const elapsed = voice.state.kind === "recording" ? voice.state.elapsedSeconds : 0;
    const busy = preparing || awaitingPermission;
    return (
      <div className={cn("border-t border-border/60 bg-[#FFFDFC]/96 backdrop-blur-xl dark:bg-background/96", className)}>
        {replyPreview ? <ReplyStrip preview={replyPreview} onCancel={onCancelReply} /> : null}
        <div className="voice-bar" role="group" aria-label="Voice recording">
          <button type="button" onClick={cancelRecording} className="voice-bar-button" aria-label="Delete recording">
            <Trash2 className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="voice-bar-time">{formatDuration(elapsed)}</span>
          <LiveVoiceWaveform stream={voice.captureStream} />
          {locked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#E88C2B]/12 px-2 py-1 text-[11px] font-semibold text-[#E88C2B]">
              <Lock className="h-3.5 w-3.5" /> Locked
            </span>
          ) : (
            <span className={cn("hidden text-[11px] font-medium sm:inline", gesture === "cancel" ? "text-destructive" : gesture === "lock" ? "text-[#E88C2B]" : "text-muted-foreground")}>
              {gesture === "cancel" ? "Release to cancel" : gesture === "lock" ? "Release to lock" : "← cancel · ↑ lock"}
            </span>
          )}
          {locked ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                sendOnNextTakeRef.current = true;
                voice.stop();
              }}
              className="voice-bar-send"
              aria-label="Send locked voice message"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
            </button>
          ) : (
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[#E88C2B]/12 text-[#E88C2B]">
              <Mic className="h-5 w-5" />
            </span>
          )}
        </div>
      </div>
    );
  }

  if (reviewing && voice.state.kind === "preview") {
    const take = voice.state.recording;
    const duration = Math.max(0.1, take.durationSeconds);
    return (
      <div className={cn("border-t border-border/60 bg-[#FFFDFC]/96 backdrop-blur-xl dark:bg-background/96", className)}>
        {replyPreview ? <ReplyStrip preview={replyPreview} onCancel={onCancelReply} /> : null}
        <div className="voice-bar" role="group" aria-label="Voice message preview">
          <audio
            ref={audioRef}
            src={take.objectUrl}
            preload="auto"
            playsInline
            onTimeUpdate={(event) => setPlayedSeconds(event.currentTarget.currentTime)}
            onEnded={() => {
              setPlaying(false);
              setPlayedSeconds(0);
            }}
          />
          <button type="button" onClick={cancelRecording} className="voice-bar-button" aria-label="Delete voice recording">
            <Trash2 className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="voice-bar-button"
            aria-label={playing ? "Pause voice message" : "Play voice message"}
            onClick={() => {
              const audio = audioRef.current;
              if (!audio) return;
              if (audio.paused) void audio.play().then(() => setPlaying(true));
              else {
                audio.pause();
                setPlaying(false);
              }
            }}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <StaticVoiceWaveform waveform={take.waveform} progress={playedSeconds / duration} />
          <span className="voice-bar-time">{formatDuration(playing || playedSeconds > 0 ? playedSeconds : duration)}</span>
          <button type="button" onClick={() => void sendVoice(take)} disabled={busySending} className="voice-bar-send" aria-label="Send voice message">
            {busySending ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
          </button>
        </div>
        {voiceError ? <p className="voice-bar-error" role="alert">{voiceError}</p> : null}
      </div>
    );
  }

  return (
    <div className={cn("relative border-t border-border/60 bg-[#FFFDFC]/96 backdrop-blur-xl dark:bg-background/96", className)}>
      {mentionPickerOpen ? (
        <div className="absolute inset-x-2 bottom-full z-30 mb-1 max-h-56 overflow-y-auto rounded-2xl border border-border/70 bg-card p-1 shadow-xl" role="listbox" aria-label="Mention a member">
          {mentionSuggestions.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No members match that name.</p>
          ) : (
            mentionSuggestions.map((candidate, index) => (
              <button
                key={candidate.userId}
                type="button"
                role="option"
                aria-selected={index === activeMention}
                onMouseDown={(event) => {
                  event.preventDefault();
                  chooseMention(candidate);
                }}
                onMouseEnter={() => setActiveMention(index)}
                className={cn("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left", index === activeMention ? "bg-secondary" : "hover:bg-secondary/60")}
              >
                <UserAvatar src={candidate.avatarUrl} name={candidate.displayName} size="sm" decorative />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{candidate.displayName}</span>
                  <span className="block truncate text-xs text-muted-foreground">@{candidate.username}</span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}

      {replyPreview ? <ReplyStrip preview={replyPreview} onCancel={onCancelReply} /> : null}
      <AttachmentPreview
        attachment={attachment}
        onRemove={() => {
          discardAttachment(attachment);
          setAttachment(null);
          setUploadState("idle");
        }}
      />
      <form
        method="post"
        className="composer-row"
        onSubmit={(event) => {
          event.preventDefault();
          sendText();
        }}
      >
        <div className="composer-bubble">
          <AttachmentPicker
            conversationId={conversationId}
            onAttachmentChange={setAttachment}
            onLifecycleChange={setUploadState}
            disabled={isPending}
          />
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={handleDraftChange}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={attachment ? "Add a caption" : placeholder}
            aria-label={attachment ? "Photo caption" : placeholder}
            maxLength={2000}
            disabled={isPending}
            className="composer-field"
          />
          {isGroup && mentionCandidates.length > 0 ? (
            <button
              type="button"
              className="composer-tool"
              aria-label="Mention someone"
              onClick={() => {
                const next = `${draft}${draft.endsWith(" ") || draft === "" ? "" : " "}@`;
                setDraft(next);
                setTrigger(findMentionTrigger(next, next.length));
                setActiveMention(0);
                requestAnimationFrame(() => {
                  textareaRef.current?.focus();
                  textareaRef.current?.setSelectionRange(next.length, next.length);
                });
              }}
            >
              <AtSign className="h-5 w-5" />
            </button>
          ) : null}
        </div>

        {canSendText || !voiceSupported ? (
          <button type="submit" disabled={!canSendText || uploadBusy || isPending} className="composer-action is-send" aria-label="Send message">
            {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        ) : (
          <button
            type="button"
            onPointerDown={(event) => void startHold(event)}
            onPointerMove={moveHold}
            onPointerUp={finishHold}
            onPointerCancel={cancelRecording}
            onContextMenu={(event) => event.preventDefault()}
            disabled={uploadBusy || isPending}
            aria-label="Hold to record. Slide left to cancel or up to lock."
            className="composer-action touch-none select-none"
            title="Hold to record · slide left to cancel · slide up to lock"
          >
            <Mic className="h-5 w-5" />
          </button>
        )}
      </form>
      {!canSendText && voiceSupported ? (
        <p className="px-4 pb-1 text-center text-[10px] font-medium text-muted-foreground/75">Hold mic to record · slide ← to cancel · slide ↑ to lock</p>
      ) : null}
      {voiceError ? <p className="voice-bar-error" role="alert">{voiceError}</p> : null}
    </div>
  );
}

function ReplyStrip({ preview, onCancel }: { preview: { senderName: string; text: string }; onCancel?: () => void }) {
  return (
    <div className="flex items-center gap-2 border-t border-[#E88C2B]/15 bg-[#E88C2B]/8 px-3 py-2">
      <span className="h-9 w-1 rounded-full bg-[#E88C2B]" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-bold text-[#E88C2B]">Replying to {preview.senderName}</span>
        <span className="block truncate text-xs text-muted-foreground">{preview.text}</span>
      </span>
      <button type="button" onClick={onCancel} className="focus-ring grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-black/[0.04]" aria-label="Cancel reply">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
