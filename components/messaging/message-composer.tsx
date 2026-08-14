"use client";

import { ArrowUp, AtSign, Loader2, Mic, Pause, Play, Send, Square, X } from "lucide-react";
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
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { useVoiceUpload } from "@/hooks/use-voice-upload";
import type { VoiceRecorderConfig } from "@/lib/messaging/voice-recording";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
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
  /**
   * Who may be mentioned here, from the Circle's own canonical member list.
   *
   * Passed in rather than fetched: the Circle page has already loaded and
   * authorised its members, and a second membership query in the composer
   * would be a second authority that could disagree with the first. Empty or
   * absent simply means no picker -- which is the correct state for a DM.
   */
  mentionCandidates?: readonly MentionCandidate[];
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
  isGroup = false,
  mentionCandidates = []
}: MessageComposerProps) {
  const [draft, setDraft] = useState("");
  /**
   * Mentions chosen from the picker, as ids.
   *
   * THE IDENTITY, held apart from the text. The draft contains "@Ama" because
   * that is what a person reads; this list contains her user id because that
   * is who she is. Sending posts the ids -- a rename between typing and
   * sending cannot redirect the mention, and two people called Ama are never
   * ambiguous.
   */
  const [mentions, setMentions] = useState<StructuredMention[]>([]);
  /** Live `@` trigger at the caret, or null when the picker should be shut. */
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  /** Keyboard highlight within the suggestion list. */
  const [activeMention, setActiveMention] = useState(0);
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
   * True while the preview is being torn down on purpose.
   *
   * THE BUG THIS FIXES. Sending or discarding a take calls voice.cancel(),
   * which revokes the preview's object URL. The <audio> element is still
   * mounted with src pointing at that URL for the remainder of the render, and
   * revoking a URL out from under a live media element makes the browser fire
   * an `error` event on it. That reached onError and reported "That recording
   * could not be played back on this device."
   *
   * So the message appeared on a SUCCESSFUL send, describing a decode failure
   * that never happened -- which is exactly why the same recording played
   * perfectly once it had been uploaded. The recording was always fine.
   *
   * A ref rather than state: the error event arrives in the same commit as the
   * teardown, before any re-render could deliver a new state value.
   */
  const tearingDownPreviewRef = useRef(false);

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

  /** Candidates for the live trigger. Empty when the picker is shut. */
  const mentionSuggestions = useMemo(
    () => (trigger ? filterMentionCandidates(mentionCandidates, trigger.query) : []),
    [mentionCandidates, trigger]
  );
  const mentionPickerOpen = Boolean(trigger) && mentionCandidates.length > 0;

  /**
   * Re-read the trigger and reconcile mentions on every keystroke.
   *
   * Reconciling here is what keeps structured state honest: deleting the
   * characters of "@Ama" removes her id, so a name that is no longer in the
   * message cannot notify anybody. It only ever REMOVES -- a mention is never
   * inferred from text, because that is the name-matching this design avoids.
   */
  function handleDraftChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    setDraft(value);
    setMentions((current) => reconcileMentions(value, current));
    if (!isGroup || mentionCandidates.length === 0) return;
    const next = findMentionTrigger(value, event.target.selectionStart ?? value.length);
    setTrigger(next);
    setActiveMention(0);
  }

  /** Insert the chosen member and remember who they actually are. */
  function chooseMention(candidate: MentionCandidate) {
    if (!trigger) return;
    const { text, caret } = applyMentionSelection(draft, trigger, candidate);
    setDraft(text);
    setMentions((current) => [
      ...current.filter((mention) => mention.userId !== candidate.userId),
      { userId: candidate.userId, displayName: candidate.displayName }
    ]);
    setTrigger(null);
    setActiveMention(0);
    // Put the caret after the inserted name rather than leaving it where the
    // half-typed query was.
    requestAnimationFrame(() => {
      const field = textareaRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(caret, caret);
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // The picker owns these keys while it is open, so Enter chooses a person
    // rather than sending a half-typed "@am".
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
        event.preventDefault();
        // Closes the picker only. The typed text stays, so Escape never
        // costs somebody the sentence they were writing.
        setTrigger(null);
        return;
      }
    }

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
          sendMessageAction({
            conversationId,
            text,
            mediaId: attachment?.mediaId,
            // Reconciled against the final text one last time, so a mention
            // whose name was edited out between typing and sending is not
            // posted. The server re-checks every id regardless -- this is
            // hygiene, not authorization.
            mentionUserIds: mentionUserIdsForSend(reconcileMentions(text, mentions), ""),
            clientMessageId
          }),
          { operation: "send message" }
        );
        onFeedback(result.message);
        if (!result.ok) {
          setUploadState(attachment ? "ready" : "idle");
          return;
        }
        setDraft("");
        setMentions([]);
        setTrigger(null);
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

  /**
   * Detach the preview element from its object URL before that URL dies.
   *
   * Order matters and is the whole fix: pause, drop the source, call load() so
   * the element actually lets go, and only then let the controller revoke.
   * Skipping this is what turned a successful send into a playback error.
   */
  const releasePreviewElement = useCallback(() => {
    tearingDownPreviewRef.current = true;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      // Without load() the element keeps its old resource selection and can
      // still raise an error for the URL that is about to be revoked.
      audio.load();
    }
    setPlaying(false);
    setPlayedSeconds(0);
  }, []);

  const resetVoice = useCallback(() => {
    releasePreviewElement();
    // Cancelling must also cancel a pending send-on-stop, or discarding a
    // recording mid-finalization would send the thing you just discarded.
    sendOnNextTakeRef.current = false;
    voiceUpload.reset();
    voice.cancel();
  }, [releasePreviewElement, voice, voiceUpload]);

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
      /* Stop reviewing the moment sending starts.
       *
       * The take itself is deliberately kept until the server confirms -- a
       * network failure must never cost someone the thing they just said -- but
       * playback and its progress belong to reviewing, not sending. Leaving
       * them running meant the bar carried on looking like a player, with a
       * moving position, for the whole upload round trip. The object URL is
       * untouched here: only the send's success path revokes it. */
      audioRef.current?.pause();
      setPlaying(false);
      // Any error from the previous attempt is about a take that is now on its
      // way; keeping it beside a spinner reads as a live failure.
      onFeedback("");
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
        /* Clear the review UI at the success boundary, in the order that keeps
         * the browser quiet: detach the <audio> from the object URL first, then
         * let voice.cancel() revoke it. Reversing these two is what produced a
         * playback error on a send that had just succeeded. */
        releasePreviewElement();
        voiceUpload.reset();
        voice.cancel();
        // A failed playback attempt on the previous take must not outlive the
        // take itself.
        onFeedback("");
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
    [conversationId, onFeedback, onSent, releasePreviewElement, voice, voiceUpload]
  );

  /**
   * Completes a send that was requested while still recording.
   *
   * Fires on the take as soon as it exists, without waiting for the local
   * waveform: decoding is presentation-only and resolves to null on failure,
   * so waiting for it would mean a decode error silently swallows the send.
   */
  /**
   * A fresh take re-arms error reporting.
   *
   * Without this the teardown flag would stay true after the first send and a
   * genuinely undecodable later recording would fail silently -- trading a
   * false alarm for a missing one.
   */
  useEffect(() => {
    if (voice.state.kind === "preview") {
      tearingDownPreviewRef.current = false;
    }
  }, [voice.state.kind]);

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
            //
            // But an error event is NOT proof of a bad recording. Tearing the
            // preview down -- on send or on discard -- revokes the object URL,
            // and the browser reports that as an error on the still-mounted
            // element. Reporting it told people their recording was unplayable
            // at the exact moment it had been sent successfully.
            onError={() => {
              setPlaying(false);
              if (tearingDownPreviewRef.current) return;
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
    <div className={cn("relative border-t border-border/70 bg-background/80", className)}>
      {/* Mention picker.
          Anchored directly above the composer and only as tall as it needs to
          be -- not a modal, not a sheet, and never covering the conversation.
          onMouseDown rather than onClick: the textarea's blur would close the
          list before a click could land. */}
      {mentionPickerOpen ? (
        <div
          role="listbox"
          aria-label="Mention a member"
          className="absolute inset-x-2 bottom-full z-30 mb-1 max-h-56 overflow-y-auto overscroll-contain rounded-xl border border-border/70 bg-card p-1 shadow-[0_12px_40px_hsl(var(--shadow)/0.28)]"
        >
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
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left",
                  index === activeMention ? "bg-secondary" : "hover:bg-secondary/60"
                )}
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
            onChange={handleDraftChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setTrigger(null)}
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
              onClick={() => {
                // Types the trigger for the person rather than explaining it.
                const field = textareaRef.current;
                const next = `${draft}${draft.endsWith(" ") || draft === "" ? "" : " "}@`;
                setDraft(next);
                setTrigger(findMentionTrigger(next, next.length));
                setActiveMention(0);
                requestAnimationFrame(() => {
                  field?.focus();
                  field?.setSelectionRange(next.length, next.length);
                });
              }}
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
