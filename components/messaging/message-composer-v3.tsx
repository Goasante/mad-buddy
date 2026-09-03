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
  mediaId?: string;
};

type Props = {
  conversationId: string;
  placeholder: string;
  onFeedback: (message: string) => void;
  onSent: () => void | Promise<void>;
  onOptimisticSend?: (message: OptimisticSendDraftV3) => void;
  onOptimisticSettled?: (clientMessageId: string, outcome: "sent" | "failed" | "pending") => void;
  voiceRecorderConfig: VoiceRecorderConfig;
  className?: string;
  isGroup?: boolean;
  mentionCandidates?: readonly MentionCandidate[];
  replyToMessageId?: string | null;
  replyPreview?: { senderName: string; text: string } | null;
  onCancelReply?: () => void;
  confirmedClientMessageIds?: ReadonlySet<string>;
};

type VoiceGesture = "idle" | "holding" | "cancel" | "lock";
type DeferredRelease = "tap" | "send" | "lock" | "cancel";

const MAX_FIELD_PX = 148;
const CANCEL_DISTANCE = 76;
const LOCK_DISTANCE = 72;
/** A quick press enters hands-free mode. A longer press sends on release. */
const TAP_TO_LOCK_MS = 280;
/** Past this point the browser is probably showing a permission surface. */
const PERMISSION_PROMPT_LIKELY_MS = 450;

function formatDuration(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function softHaptic(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Cosmetic only. Haptics are not available on every PWA/browser.
  }
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
  onCancelReply,
  confirmedClientMessageIds
}: Props) {
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<StructuredMention[]>([]);
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [activeMention, setActiveMention] = useState(0);
  /* Photos accumulate; one message is sent per photo.
   *
   * The picker uploads a multi-selection one file at a time and reports each
   * finished photo here, so this is a list rather than a slot. Videos and
   * documents still arrive one at a time and simply make a list of one. */
  const [attachments, setAttachments] = useState<SelectedAttachment[]>([]);
  const attachment = attachments[0] ?? null;
  const [uploadState, setUploadState] = useState<AttachmentUploadLifecycle>("idle");
  const [, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const clientMessageIdRef = useRef<string | null>(null);
  const ambiguousVoiceIdRef = useRef<string | null>(null);

  const voice = useVoiceRecorder(conversationId, voiceRecorderConfig);
  const getVoiceState = voice.getState;
  const voiceUpload = useVoiceUpload(conversationId);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playedSeconds, setPlayedSeconds] = useState(0);

  useEffect(() => {
    const clientMessageId = ambiguousVoiceIdRef.current;
    if (!clientMessageId || !confirmedClientMessageIds?.has(clientMessageId)) return;
    ambiguousVoiceIdRef.current = null;
    voiceUpload.reset();
    voice.cancel();
  }, [confirmedClientMessageIds, voice, voiceUpload]);
  const [locked, setLocked] = useState(false);
  const [gesture, setGesture] = useState<VoiceGesture>("idle");
  const [micHint, setMicHint] = useState<string | null>(null);

  /**
   * Pointer ownership deliberately lives OUTSIDE the mic button.
   *
   * The v3 regression came from storing pointerup/move on a button that
   * disappeared as soon as `voice.state` became requesting_permission or
   * recording. Installed PWAs make that especially visible because the OS
   * permission prompt interrupts the original gesture. Window-level tracking
   * keeps release/cancel/lock alive across that render transition.
   */
  const pointerStartRef = useRef<{ x: number; y: number; id: number; startedAt: number } | null>(null);
  const gestureRef = useRef<VoiceGesture>("idle");
  const lockedRef = useRef(false);
  const deferredReleaseRef = useRef<DeferredRelease | null>(null);
  const permissionPromptLikelyRef = useRef(false);
  const permissionPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendOnNextTakeRef = useRef(false);
  const sendingRef = useRef(false);

  useEffect(() => {
    gestureRef.current = gesture;
  }, [gesture]);

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

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
  const busySending = voiceUpload.state.kind === "uploading" || voiceUpload.state.kind === "finalizing";

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
    if ((!text && attachments.length === 0) || uploadBusy) return;
    const mentionIds = mentionUserIdsForSend(reconcileMentions(text, mentions), "");
    /* One canonical message per photo, in the order they were chosen.
     *
     * The caption and the reply belong to the FIRST message only -- repeating
     * them on every photo would post the same sentence several times and point
     * several replies at one message. Each send carries its own
     * clientMessageId, so the optimistic rows settle independently and a
     * retried batch cannot duplicate one that already landed. */
    const queued = attachments.length > 0 ? attachments : [null];
    const sends = queued.map((item, index) => ({
      // The attachment itself travels with its send, so a failure can put THAT
      // photo back rather than guessing which one did not land.
      attachment: item,
      mediaId: item?.mediaId,
      text: index === 0 ? text : "",
      replyToMessageId: index === 0 ? (replyToMessageId ?? undefined) : undefined,
      clientMessageId:
        index === 0 ? (clientMessageIdRef.current ?? crypto.randomUUID()) : crypto.randomUUID()
    }));

    for (const send of sends) {
      onOptimisticSend?.({
        clientMessageId: send.clientMessageId,
        text: send.text || null,
        kind: "text",
        durationSeconds: null,
        mediaId: send.mediaId
      });
    }
    setDraft("");
    setMentions([]);
    setTrigger(null);
    /* Cleared optimistically so the composer empties on Send, and restored
       below with whatever did not make it. Clearing was the bug: the list went
       before the loop ran, so a photo that failed on the third request had
       nowhere to come back to and its uploaded media was stranded. */
    setAttachments([]);
    setUploadState("idle");
    clientMessageIdRef.current = null;
    onCancelReply?.();
    onFeedback("");

    startTransition(async () => {
      /* Photos whose message did not land. They keep their original order and
         their existing mediaId, so pressing Send again re-sends exactly those
         -- already-uploaded media, no second upload -- and never the ones that
         already succeeded. */
      const unsent: SelectedAttachment[] = [];
      // Sequential: the server orders by arrival, and firing them together
      // would let the second photo land before the first.
      for (const send of sends) {
        try {
          const result = await withTimeout(
            sendMessageAction({
              conversationId,
              text: send.text,
              mediaId: send.mediaId,
              mentionUserIds: send.text ? mentionIds : [],
              replyToMessageId: send.replyToMessageId,
              clientMessageId: send.clientMessageId
            }),
            { operation: "send message" }
          );
          if (!result.ok) {
            onOptimisticSettled?.(send.clientMessageId, "failed");
            onFeedback(result.message);
            // A later photo failing must not undo the ones already sent.
            if (send.attachment) unsent.push(send.attachment);
            continue;
          }
          onOptimisticSettled?.(send.clientMessageId, "sent");
        } catch (error) {
          if (isRequestTimeoutError(error)) {
            // The request may already have committed. Keep the local row calm
            // and pending; its clientMessageId is resolved in the background.
            // In particular, do not restore/re-upload an attachment whose
            // canonical message may already exist.
            onOptimisticSettled?.(send.clientMessageId, "pending");
          } else {
            onOptimisticSettled?.(send.clientMessageId, "failed");
            if (send.attachment) unsent.push(send.attachment);
            onFeedback("The message could not be sent. Try again.");
          }
        }
      }
      /* Only the failures come back. Appending rather than replacing, because
         a photo picked while the batch was in flight is also waiting here and
         must not be thrown away. */
      if (unsent.length > 0) setAttachments((current) => [...unsent, ...current]);
      await onSent();
    });
  }

  const sendVoice = useCallback(
    async (take: Parameters<typeof voiceUpload.upload>[0]) => {
      if (sendingRef.current) return;
      sendingRef.current = true;
      /* Playback and its moving progress belong to reviewing, not to sending. */
      audioRef.current?.pause();
      setPlaying(false);
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
        // Persist the prepared media identity with the optimistic row before
        // the request. A timeout can then retry the exact asset/idempotency key
        // without recording or uploading a duplicate.
        onOptimisticSend?.({
          clientMessageId,
          text: null,
          kind: "voice",
          durationSeconds: take.durationSeconds,
          mediaId: prepared.mediaId
        });
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
        lockedRef.current = false;
        setLocked(false);
        gestureRef.current = "idle";
        setGesture("idle");
        setMicHint(null);
        await onSent();
      } catch (error) {
        if (isRequestTimeoutError(error)) {
          // Preserve both the bubble and original recording until canonical
          // confirmation resolves the ambiguous request.
          ambiguousVoiceIdRef.current = clientMessageId;
          onOptimisticSettled?.(clientMessageId, "pending");
        } else {
          onOptimisticSettled?.(clientMessageId, "failed");
          onFeedback("Couldn't send that voice message. Try again.");
        }
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

  const clearPermissionPromptTimer = useCallback(() => {
    if (permissionPromptTimerRef.current) clearTimeout(permissionPromptTimerRef.current);
    permissionPromptTimerRef.current = null;
  }, []);

  const cancelRecording = useCallback(() => {
    clearPermissionPromptTimer();
    deferredReleaseRef.current = null;
    permissionPromptLikelyRef.current = false;
    sendOnNextTakeRef.current = false;
    voiceUpload.reset();
    voice.cancel();
    lockedRef.current = false;
    setLocked(false);
    gestureRef.current = "idle";
    setGesture("idle");
    setMicHint(null);
    pointerStartRef.current = null;
    softHaptic(6);
  }, [clearPermissionPromptTimer, voice, voiceUpload]);

  const applyRelease = useCallback(
    (mode: DeferredRelease) => {
      clearPermissionPromptTimer();
      permissionPromptLikelyRef.current = false;
      deferredReleaseRef.current = null;
      pointerStartRef.current = null;
      gestureRef.current = "idle";
      setGesture("idle");

      if (mode === "cancel") {
        cancelRecording();
        return;
      }
      if (mode === "tap" || mode === "lock") {
        lockedRef.current = true;
        setLocked(true);
        setMicHint(mode === "tap" ? "Recording hands-free. Tap Send when you’re done." : null);
        softHaptic(10);
        return;
      }

      setMicHint(null);
      sendOnNextTakeRef.current = true;
      voice.stop();
      softHaptic(8);
    },
    [cancelRecording, clearPermissionPromptTimer, voice]
  );

  const cancelRecordingRef = useRef(cancelRecording);
  const applyReleaseRef = useRef(applyRelease);

  useEffect(() => {
    cancelRecordingRef.current = cancelRecording;
  }, [cancelRecording]);

  useEffect(() => {
    applyReleaseRef.current = applyRelease;
  }, [applyRelease]);

  /**
   * Window-level pointer tracking survives both React branch changes and the
   * installed-PWA microphone permission dialog. This is the core release fix.
   */
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const start = pointerStartRef.current;
      if (!start || start.id !== event.pointerId || lockedRef.current) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      let next: VoiceGesture = "holding";
      if (dx <= -CANCEL_DISTANCE) next = "cancel";
      else if (dy <= -LOCK_DISTANCE) next = "lock";
      if (gestureRef.current !== next) {
        gestureRef.current = next;
        setGesture(next);
        if (next === "cancel" || next === "lock") softHaptic(7);
      }
      if (event.cancelable) event.preventDefault();
    };

    const finish = (event: PointerEvent, cancelled: boolean) => {
      const start = pointerStartRef.current;
      if (!start || start.id !== event.pointerId) return;
      const currentGesture = gestureRef.current;
      const durationMs = performance.now() - start.startedAt;
      const stateKind = getVoiceState().kind;

      pointerStartRef.current = null;
      clearPermissionPromptTimer();
      gestureRef.current = "idle";
      setGesture("idle");

      let mode: DeferredRelease;
      if (cancelled) {
        // A permission dialog can dispatch pointercancel even though the user
        // did nothing wrong. In that state hands-free is the only honest
        // continuation: do not delete a recording the user just approved.
        mode = stateKind === "requesting_permission" ? "lock" : "cancel";
      } else if (currentGesture === "cancel") {
        mode = "cancel";
      } else if (currentGesture === "lock") {
        mode = "lock";
      } else if (durationMs < TAP_TO_LOCK_MS) {
        // Quick tap = the familiar tap-to-record mode. It keeps recording and
        // exposes Send, which is also a reliable accessibility/PWA fallback.
        mode = "tap";
      } else {
        // Real hold = release-to-send.
        mode = "send";
      }

      if (stateKind === "recording") {
        applyReleaseRef.current(mode);
        return;
      }
      if (stateKind === "requesting_permission") {
        // `getUserMedia()` is asynchronous even when permission was already
        // granted. Carry the release intent across that gap instead of losing
        // it when the original mic button disappears.
        deferredReleaseRef.current = permissionPromptLikelyRef.current && mode === "send" ? "lock" : mode;
        return;
      }
      if (mode === "cancel") cancelRecordingRef.current();
    };

    const onUp = (event: PointerEvent) => finish(event, false);
    const onCancel = (event: PointerEvent) => finish(event, true);

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [clearPermissionPromptTimer, getVoiceState]);

  /**
   * Resolve a release that occurred while getUserMedia/permission was still
   * pending. If the permission surface swallowed the release entirely, the
   * timer below marks that session and we safely convert it to locked mode as
   * soon as capture begins, so a visible Send button is always available.
   */
  useEffect(() => {
    if (voice.state.kind === "failed") {
      deferredReleaseRef.current = null;
      permissionPromptLikelyRef.current = false;
      clearPermissionPromptTimer();
      pointerStartRef.current = null;
      gestureRef.current = "idle";
      setGesture("idle");
      return;
    }
    if (voice.state.kind !== "recording") return;

    const deferred = deferredReleaseRef.current;
    if (deferred) {
      if (permissionPromptLikelyRef.current && deferred === "send") {
        setMicHint("Microphone approved. Recording is hands-free — tap Send when you’re done.");
        applyRelease("lock");
      } else {
        applyRelease(deferred);
      }
      return;
    }

    if (permissionPromptLikelyRef.current && pointerStartRef.current) {
      pointerStartRef.current = null;
      clearPermissionPromptTimer();
      permissionPromptLikelyRef.current = false;
      lockedRef.current = true;
      setLocked(true);
      gestureRef.current = "idle";
      setGesture("idle");
      setMicHint("Microphone approved. Recording is hands-free — tap Send when you’re done.");
      softHaptic(10);
    }
  }, [applyRelease, clearPermissionPromptTimer, voice.state.kind]);

  useEffect(() => () => clearPermissionPromptTimer(), [clearPermissionPromptTimer]);

  function startHold(event: React.PointerEvent<HTMLButtonElement>) {
    /* A photo and a voice note are different messages. Refusing silently reads
       as a broken mic, so say why the recording did not start. */
    if (attachment) {
      setMicHint("Remove the photo before recording a voice message.");
      return;
    }
    if (uploadBusy) return;
    event.preventDefault();
    clearPermissionPromptTimer();
    setMicHint(null);
    voiceUpload.reset();
    permissionPromptLikelyRef.current = false;
    deferredReleaseRef.current = null;
    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      startedAt: performance.now()
    };
    lockedRef.current = false;
    gestureRef.current = "holding";
    setGesture("holding");
    softHaptic(6);

    permissionPromptTimerRef.current = setTimeout(() => {
      if (!pointerStartRef.current) return;
      if (getVoiceState().kind === "requesting_permission") {
        permissionPromptLikelyRef.current = true;
      }
    }, PERMISSION_PROMPT_LIKELY_MS);

    // Do not await here. The pointer lifecycle is owned globally and must stay
    // responsive while getUserMedia / the PWA permission UI is pending.
    void voice.start();
  }

  function stopAndSendRecording() {
    if (getVoiceState().kind !== "recording") return;
    pointerStartRef.current = null;
    deferredReleaseRef.current = null;
    clearPermissionPromptTimer();
    permissionPromptLikelyRef.current = false;
    sendOnNextTakeRef.current = true;
    lockedRef.current = false;
    setLocked(false);
    gestureRef.current = "idle";
    setGesture("idle");
    setMicHint(null);
    voice.stop();
    softHaptic(8);
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
    const statusText = awaitingPermission
      ? "Allow microphone access…"
      : locked
        ? "Hands-free recording"
        : gesture === "cancel"
          ? "Release to cancel"
          : gesture === "lock"
            ? "Release to lock"
            : "Release to send · ← cancel · ↑ lock";

    return (
      <div className={cn("border-t border-border/60 bg-background/95 backdrop-blur-xl", className)}>
        {replyPreview ? <ReplyStrip preview={replyPreview} onCancel={onCancelReply} /> : null}
        <div className="voice-bar" role="group" aria-label="Voice recording">
          {/* The state is otherwise carried by colour and a moving waveform.
              Say it in words too, or the recorder is silent to a screen reader. */}
          <span className="sr-only" role="status">
            {awaitingPermission ? "Waiting for microphone access" : `Recording, ${formatDuration(elapsed)}`}
          </span>
          <button type="button" onClick={cancelRecording} className="voice-bar-button" aria-label="Cancel voice recording">
            <Trash2 className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="voice-bar-time">{formatDuration(elapsed)}</span>
          <LiveVoiceWaveform stream={voice.captureStream} />
          <span
            className={cn(
              "min-w-0 shrink truncate text-[10px] font-semibold sm:text-[11px]",
              gesture === "cancel" ? "text-destructive" : locked || gesture === "lock" ? "text-primary" : "text-muted-foreground"
            )}
          >
            {locked && !awaitingPermission ? <Lock className="mr-1 inline h-3.5 w-3.5 align-[-2px]" /> : null}
            {statusText}
          </span>
          <button
            type="button"
            disabled={busy || voice.state.kind !== "recording"}
            onClick={stopAndSendRecording}
            className="voice-bar-send"
            aria-label="Send voice message"
            title="Send voice message"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
          </button>
        </div>
        {micHint ? <p className="px-4 pb-1 text-center text-xs font-medium text-primary">{micHint}</p> : null}
      </div>
    );
  }

  if (reviewing && voice.state.kind === "preview") {
    const take = voice.state.recording;
    const duration = Math.max(0.1, take.durationSeconds);
    return (
      <div className={cn("border-t border-border/60 bg-background/95 backdrop-blur-xl", className)}>
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
              if (audio.paused) {
                /* A failed decode must surface as a PLAYBACK message and must never
                   be mistaken for a send failure -- the take stays in review either
                   way, so the person can retry or discard it. */
                void audio.play().then(() => setPlaying(true)).catch(() => {
                  setPlaying(false);
                  onFeedback("That recording could not be played back.");
                });
              }
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
    <div className={cn("relative border-t border-border/60 bg-background/95 backdrop-blur-xl", className)}>
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
      {attachments.length > 1 ? (
        /* A tray once there is more than one: the single preview says what one
           attachment is, and repeating it down the composer would push the
           text field off a phone screen. Each thumbnail owns its own remove,
           so discarding the third photo cannot take the others with it. */
        <ul className="flex gap-2 overflow-x-auto px-3 pb-2">
          {attachments.map((item, index) => (
            <li key={item.mediaId} className="relative shrink-0">
              {item.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.previewUrl}
                  alt=""
                  className="h-16 w-16 rounded-[10px] object-cover"
                  draggable={false}
                />
              ) : (
                <span className="grid h-16 w-16 place-items-center rounded-[10px] bg-secondary text-[11px] text-muted-foreground">
                  Photo
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  discardAttachment(item);
                  setAttachments((current) => current.filter((entry) => entry.mediaId !== item.mediaId));
                }}
                className="focus-ring absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-foreground/80 text-[11px] text-background"
                aria-label={`Remove photo ${index + 1}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <AttachmentPreview
          attachment={attachment}
          onRemove={() => {
            discardAttachment(attachment);
            setAttachments([]);
            setUploadState("idle");
          }}
        />
      )}
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
            onAttachmentChange={(next) => {
              // The picker reports one finished photo at a time; each is
              // appended so a multi-selection accumulates in choice order.
              setAttachments((current) => (next ? [...current, next] : []));
            }}
            onLifecycleChange={setUploadState}
            onFeedback={onFeedback}
            onStructuredSent={onSent}
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
          <button type="submit" disabled={!canSendText || uploadBusy} className="composer-action is-send" aria-label="Send message">
            <Send className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            onPointerDown={startHold}
            onContextMenu={(event) => event.preventDefault()}
            disabled={uploadBusy}
            aria-label="Tap to record hands-free. Hold to record and release to send. Slide left to cancel or up to lock."
            className="composer-action touch-none select-none"
            title="Tap: record hands-free · Hold: release to send · ← cancel · ↑ lock"
          >
            <Mic className="h-5 w-5" />
          </button>
        )}
      </form>
      {voiceError ? <p className="voice-bar-error" role="alert">{voiceError}</p> : null}
    </div>
  );
}

function ReplyStrip({ preview, onCancel }: { preview: { senderName: string; text: string }; onCancel?: () => void }) {
  return (
    <div className="flex items-center gap-2 border-t border-primary/15 bg-primary/8 px-3 py-2">
      <span className="h-9 w-1 rounded-full bg-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-primary">Replying to {preview.senderName}</span>
        <span className="block truncate text-xs text-muted-foreground">{preview.text}</span>
      </span>
      <button type="button" onClick={onCancel} className="focus-ring grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-black/[0.04]" aria-label="Cancel reply">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
