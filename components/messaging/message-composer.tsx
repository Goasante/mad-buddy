"use client";

import { ArrowUp, AtSign, Loader2, Mic, Pause, Play, Send, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { sendMessageAction } from "@/app/(app)/messaging-actions";
import {
  AttachmentPicker,
  AttachmentPreview,
  discardAttachment,
  type AttachmentUploadLifecycle,
  type SelectedAttachment
} from "@/components/messaging/attachment-picker";
import { LiveVoiceWaveform, StaticVoiceWaveform } from "@/components/messaging/voice-waveform-bar";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { useVoiceUpload } from "@/hooks/use-voice-upload";
import type { VoiceRecorderConfig } from "@/lib/messaging/voice-recording";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
import { cn } from "@/lib/utils";

type MessageComposerProps = {
  conversationId: string;
  placeholder: string;
  onFeedback: (message: string) => void;
  onSent: () => void | Promise<void>;
  voiceRecorderConfig: VoiceRecorderConfig;
  className?: string;
  /**
   * True in group conversations. Only controls whether the mention
   * affordance is offered: a DM has nobody to disambiguate.
   */
  isGroup?: boolean;
};

/** Tallest the field grows before it scrolls internally (about six lines). */
const COMPOSER_MAX_FIELD_PX = 148;

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * The canonical composer.
 *
 * ONE surface with three appearances -- idle, recording, review -- rather
 * than a composer plus a recording card stacked above it. The row transforms
 * in place, which is why there is no modal, no floating panel, and never two
 * competing input surfaces on screen.
 */
export function MessageComposer({
  conversationId,
  placeholder,
  onFeedback,
  onSent,
  voiceRecorderConfig,
  className,
  isGroup = false
}: MessageComposerProps) {
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<SelectedAttachment | null>(null);
  const [uploadState, setUploadState] = useState<AttachmentUploadLifecycle>("idle");
  const [isPending, startTransition] = useTransition();
  const clientMessageIdRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const voice = useVoiceRecorder(conversationId, voiceRecorderConfig);
  const voiceUpload = useVoiceUpload(conversationId);

  // Review playback. A plain <audio> element, no seeking: WebM/Opus blobs
  // frequently lack the duration metadata reliable scrubbing needs, and a
  // scrubber that cannot scrub is worse than none.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playedSeconds, setPlayedSeconds] = useState(0);

  /**
   * True from the moment Send is pressed until the message exists.
   *
   * A ref, not state: two taps in the same frame both read the pre-render
   * value, which is exactly how a double tap becomes two voice messages.
   */
  const sendingRef = useRef(false);

  /**
   * Set when Send is pressed DURING recording.
   *
   * Stopping is asynchronous -- MediaRecorder assembles the final blob after
   * stop() returns -- so the take does not exist yet at the moment of the tap.
   * This carries the intent across finalization so the recording is sent as
   * soon as it lands, instead of parking the person in the review bar.
   */
  const sendOnNextTakeRef = useRef(false);

  useEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, COMPOSER_MAX_FIELD_PX)}px`;
  }, [draft]);

  const uploadBusy = uploadState === "selected" || uploadState === "uploading" || uploadState === "processing";
  const recording = voice.state.kind === "recording";
  /**
   * Every non-idle capture state renders the recording bar.
   *
   * THE BUG THIS FIXES: start() sets `requesting_permission` synchronously
   * and only then awaits getUserMedia. That state was covered by no branch,
   * so the composer kept showing the idle row for the whole permission
   * prompt -- and if the prompt was slow or dismissed, it never visibly
   * changed at all. Anything that is not idle/preview/failed is capture in
   * progress, so it must not look like an idle composer.
   */
  const awaitingPermission = voice.state.kind === "requesting_permission";
  const preparing = voice.state.kind === "stopping" || voice.state.kind === "processing";
  const reviewing = voice.state.kind === "preview";
  const voiceSupported = voiceRecorderConfig.enabled && voice.capability.supported;
  const canSendText = Boolean(draft.trim() || attachment);

  /** One message for one failure, whatever produced it. */
  const voiceError =
    voice.state.kind === "failed"
      ? voice.state.message
      : voiceUpload.state.kind === "failed"
        ? voiceUpload.state.message
        : null;

  const busySending = isPending || voiceUpload.state.kind === "uploading" || voiceUpload.state.kind === "finalizing";

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    // Enter commits a candidate word in Japanese/Chinese/Korean input;
    // sending there would truncate the sentence being written.
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    sendText();
  }

  function sendText() {
    const text = draft.trim();
    if ((!text && !attachment) || uploadBusy || isPending) return;

    const clientMessageId = clientMessageIdRef.current ?? crypto.randomUUID();
    clientMessageIdRef.current = clientMessageId;
    setUploadState("sending");
    onFeedback("");
    startTransition(async () => {
      try {
        const result = await withTimeout(
          sendMessageAction({ conversationId, text, mediaId: attachment?.mediaId, clientMessageId }),
          { operation: "send message" }
        );
        onFeedback(result.message);
        if (!result.ok) {
          setUploadState(attachment ? "ready" : "idle");
          return;
        }
        setDraft("");
        setAttachment(null);
        setUploadState("idle");
        clientMessageIdRef.current = null;
        await onSent();
      } catch (error) {
        setUploadState(attachment ? "ready" : "idle");
        onFeedback(
          isRequestTimeoutError(error)
            ? "Sending took too long. Your message was kept so you can try again."
            : "The message could not be sent. Try again."
        );
      }
    });
  }

  const resetVoice = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
    setPlayedSeconds(0);
    // Cancelling must also cancel a pending send-on-stop, or discarding a
    // recording mid-finalization would send the thing you just discarded.
    sendOnNextTakeRef.current = false;
    voiceUpload.reset();
    voice.cancel();
  }, [voice, voiceUpload]);

  /**
   * Uploads the take, then sends it as a message.
   *
   * Deliberately sequential: stop -> verify -> upload -> send. Each step's
   * failure leaves the RECORDING intact, so a network problem never costs
   * someone the thing they just said.
   */
  const sendVoice = useCallback(
    async (recordingToSend: Parameters<typeof voiceUpload.upload>[0]) => {
      if (sendingRef.current) return;
      sendingRef.current = true;
      try {
        const prepared = (voiceUpload.state.kind === "ready"
          ? voiceUpload.state.attachment
          : null) ?? (await voiceUpload.upload(recordingToSend));
        if (!prepared) return;

        const clientMessageId = clientMessageIdRef.current ?? crypto.randomUUID();
        clientMessageIdRef.current = clientMessageId;
        const result = await withTimeout(
          sendMessageAction({ conversationId, mediaId: prepared.mediaId, clientMessageId }),
          { operation: "send voice message" }
        );
        if (!result.ok) {
          onFeedback(result.message);
          return;
        }
        clientMessageIdRef.current = null;
        audioRef.current?.pause();
        setPlaying(false);
        setPlayedSeconds(0);
        voiceUpload.reset();
        voice.cancel();
        await onSent();
      } catch (error) {
        onFeedback(
          isRequestTimeoutError(error)
            ? "Sending took too long. Your recording was kept so you can try again."
            : "Couldn't send that voice message. Try again."
        );
      } finally {
        sendingRef.current = false;
      }
    },
    [conversationId, onFeedback, onSent, voice, voiceUpload]
  );

  /**
   * Completes a send that was requested while still recording.
   *
   * Fires on the take as soon as it exists, without waiting for the local
   * waveform: decoding is presentation-only and resolves to null on failure,
   * so waiting for it would mean a decode error silently swallows the send.
   */
  useEffect(() => {
    if (!sendOnNextTakeRef.current) return;
    if (voice.state.kind !== "preview") return;
    const take = voice.state.recording;
    sendOnNextTakeRef.current = false;
    // Deferred a tick: sending updates upload state, and doing that inside
    // the effect body would set state during the commit that triggered it.
    const handle = setTimeout(() => void sendVoice(take), 0);
    return () => clearTimeout(handle);
  }, [sendVoice, voice.state]);

  // ---------------------------------------------------------------------
  // RECORDING: cancel, timer, live levels, stop, send
  // ---------------------------------------------------------------------
  if (recording || preparing || awaitingPermission) {
    const elapsed = voice.state.kind === "recording" ? voice.state.elapsedSeconds : 0;
    // Stop/send are meaningless until there is something being captured.
    const busy = preparing || awaitingPermission;
    return (
      <div className={cn("border-t border-border/70 bg-background/80", className)}>
        <div className="voice-bar" role="group" aria-label="Voice recording">
          <button
            type="button"
            onClick={resetVoice}
            aria-label="Cancel voice recording"
            className="voice-bar-button"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>

          <span className="voice-bar-time" aria-hidden="true">{formatDuration(elapsed)}</span>
          {/* Recording state as text, never colour or motion alone. */}
          <span className="sr-only" role="status">
            {awaitingPermission
              ? "Waiting for microphone access"
              : `Recording, ${formatDuration(elapsed)}`}
          </span>

          <LiveVoiceWaveform stream={voice.captureStream} />

          <button
            type="button"
            onClick={() => voice.stop()}
            disabled={busy}
            aria-label="Stop recording"
            className="voice-bar-button"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Square className="h-4 w-4 fill-current" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              // Send-while-recording: stop, then let the take be sent as soon
              // as finalization produces it. MediaRecorder assembles the blob
              // asynchronously, so there is nothing to send in this tick.
              sendOnNextTakeRef.current = true;
              voice.stop();
            }}
            disabled={busy}
            aria-label="Send voice message"
            className="voice-bar-send"
          >
            <ArrowUp className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // REVIEW: discard, play, waveform + progress, duration, send
  // ---------------------------------------------------------------------
  if (reviewing && voice.state.kind === "preview") {
    const take = voice.state.recording;
    const duration = Math.max(0.1, take.durationSeconds);
    return (
      <div className={cn("border-t border-border/70 bg-background/80", className)}>
        <div className="voice-bar" role="group" aria-label="Voice message preview">
          <audio
            ref={audioRef}
            src={take.objectUrl}
            // "auto", not "metadata": a MediaRecorder webm carries no
            // duration in its header, so a metadata-only load can leave the
            // element unready and play() resolves to silence.
            preload="auto"
            playsInline
            onTimeUpdate={(event) => setPlayedSeconds(event.currentTarget.currentTime)}
            onEnded={() => {
              setPlaying(false);
              setPlayedSeconds(0);
            }}
            onPause={() => setPlaying(false)}
            // Without this a decode failure is completely silent: the button
            // does nothing and reports nothing.
            onError={() => {
              setPlaying(false);
              onFeedback("That recording could not be played back on this device.");
            }}
          />
          <button
            type="button"
            onClick={resetVoice}
            disabled={busySending}
            aria-label="Delete voice recording"
            className="voice-bar-button"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => {
              const audio = audioRef.current;
              if (!audio) return;
              if (audio.paused) {
                void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
              } else {
                audio.pause();
              }
            }}
            aria-label={playing ? "Pause voice message" : "Play voice message"}
            className="voice-bar-button"
          >
            {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          </button>

          <StaticVoiceWaveform waveform={take.waveform} progress={playedSeconds / duration} />

          <span className="voice-bar-time" aria-hidden="true">
            {formatDuration(playing || playedSeconds > 0 ? playedSeconds : duration)}
          </span>

          <button
            type="button"
            onClick={() => void sendVoice(take)}
            disabled={busySending}
            aria-label="Send voice message"
            className="voice-bar-send"
          >
            {busySending ? (
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <ArrowUp className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
        {voiceError ? (
          <p className="voice-bar-error" role="alert">
            {voiceError}
          </p>
        ) : null}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // IDLE: attachment, field, mention (groups), mic or send
  // ---------------------------------------------------------------------
  return (
    <div className={cn("border-t border-border/70 bg-background/80", className)}>
      <AttachmentPreview
        attachment={attachment}
        onRemove={() => {
          discardAttachment(attachment);
          setAttachment(null);
          setUploadState("idle");
        }}
      />
      <form
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
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={attachment ? "Add a caption" : placeholder}
            aria-label={attachment ? "Photo caption" : placeholder}
            maxLength={2000}
            disabled={isPending}
            className="composer-field"
          />
          {isGroup ? (
            <button
              type="button"
              onClick={() => onFeedback("Mentions are coming to group chats soon.")}
              disabled={isPending}
              aria-label="Mention someone"
              className="composer-tool"
            >
              <AtSign className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {/* Mic when there is nothing to send, send the moment there is: one
            control, one position, so the primary action never moves. */}
        {canSendText || !voiceSupported ? (
          <button
            type="submit"
            disabled={!canSendText || uploadBusy || isPending}
            aria-label="Send message"
            className="composer-action is-send"
          >
            {isPending ? (
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Send className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (attachment) {
                onFeedback("Remove the photo before recording a voice message.");
                return;
              }
              voiceUpload.reset();
              void voice.start();
            }}
            disabled={uploadBusy || isPending}
            aria-label="Record voice message"
            className="composer-action"
          >
            <Mic className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </form>
      {voiceError ? (
        <p className="voice-bar-error" role="alert">
          {voiceError}
        </p>
      ) : null}
    </div>
  );
}
