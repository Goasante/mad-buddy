"use client";

import { Loader2, Mic, Send, Square, X } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { sendMessageAction } from "@/app/(app)/messaging-actions";
import {
  AttachmentPicker,
  AttachmentPreview,
  discardAttachment,
  type AttachmentUploadLifecycle,
  type SelectedAttachment
} from "@/components/messaging/attachment-picker";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
import { cn } from "@/lib/utils";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import type { VoiceRecorderConfig } from "@/lib/messaging/voice-recording";
import {
  VoiceRecordingPreview,
  type PreparedVoiceAttachment
} from "@/components/messaging/voice-recording-preview";

type MessageComposerProps = {
  conversationId: string;
  placeholder: string;
  onFeedback: (message: string) => void;
  onSent: () => void | Promise<void>;
  voiceRecorderConfig: VoiceRecorderConfig;
  className?: string;
};

/** Canonical text + image composer shared by every real conversation surface. */
export function MessageComposer({
  conversationId,
  placeholder,
  onFeedback,
  onSent,
  voiceRecorderConfig,
  className
}: MessageComposerProps) {
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<SelectedAttachment | null>(null);
  const [uploadState, setUploadState] = useState<AttachmentUploadLifecycle>("idle");
  const [preparedVoice, setPreparedVoice] = useState<PreparedVoiceAttachment | null>(null);
  const [isPending, startTransition] = useTransition();
  const clientMessageIdRef = useRef<string | null>(null);
  const voice = useVoiceRecorder(conversationId, voiceRecorderConfig);

  const uploadBusy = uploadState === "selected" || uploadState === "uploading" || uploadState === "processing";
  const voiceBusy = ["requesting_permission", "recording", "stopping", "processing"].includes(voice.state.kind);
  const voiceBlocksSend = voiceBusy || voice.state.kind === "preview";
  const voiceSupported = voiceRecorderConfig.enabled && voice.capability.supported;
  const canSend = Boolean(draft.trim() || attachment) && !voiceBlocksSend;
  const voiceAnnouncement = voice.state.kind === "recording"
    ? "Recording started."
    : voice.state.kind === "preview"
      ? "Recording stopped. Voice preview ready."
      : voice.state.kind === "failed"
        ? voice.state.message
        : "";

  function send() {
    const text = draft.trim();
    if ((!text && !attachment) || uploadBusy || isPending) return;
    if (voiceBlocksSend) return;

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

  return (
    <div className={cn("border-t border-border/70 bg-background/80", className)}>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{voiceAnnouncement}</p>
      <AttachmentPreview
        attachment={attachment}
        onRemove={() => {
          discardAttachment(attachment);
          setAttachment(null);
          setUploadState("idle");
        }}
      />
      {voice.state.kind === "preview" ? (
        <VoiceRecordingPreview
          conversationId={conversationId}
          recording={voice.state.recording}
          onPrepared={setPreparedVoice}
          onRerecord={() => void voice.rerecord()}
          onDelete={voice.cancel}
        />
      ) : voice.state.kind !== "idle" ? (
        <div className="mx-3 mt-3 flex min-h-14 flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-secondary/45 px-3 py-2 text-sm">
          {voice.state.kind === "requesting_permission" ? (
            <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /><span>Waiting for microphone permission…</span></>
          ) : null}
          {voice.state.kind === "recording" ? (
            <>
              <span className="h-2.5 w-2.5 rounded-full bg-destructive" aria-hidden="true" />
              <span className="font-medium">Recording… {formatVoiceDuration(voice.state.elapsedSeconds)} / {formatVoiceDuration(voice.state.maxDurationSeconds)}</span>
              <button type="button" onClick={voice.stop} className="focus-ring ml-auto inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-3 font-semibold">
                <Square className="h-4 w-4" aria-hidden="true" /> Stop
              </button>
              <button type="button" onClick={voice.cancel} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-muted-foreground">
                <X className="h-4 w-4" aria-hidden="true" /> Cancel
              </button>
            </>
          ) : null}
          {voice.state.kind === "stopping" || voice.state.kind === "processing" ? (
            <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /><span>Preparing voice preview…</span></>
          ) : null}
          {voice.state.kind === "failed" ? (
            <>
              <span role="alert" className="text-muted-foreground">{voice.state.message}</span>
              {voiceSupported ? (
                <button type="button" onClick={() => void voice.start()} className="focus-ring ml-auto min-h-11 rounded-full border border-border px-3 font-semibold">Try again</button>
              ) : null}
              <button type="button" onClick={voice.cancel} aria-label="Dismiss voice recording error" className="focus-ring grid h-11 w-11 place-items-center rounded-full text-muted-foreground">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <form
        className="flex items-center gap-2 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <AttachmentPicker
          conversationId={conversationId}
          onAttachmentChange={setAttachment}
          onLifecycleChange={setUploadState}
          disabled={isPending || voiceBlocksSend}
        />
        {voiceSupported && voice.state.kind === "idle" ? (
          <button
            type="button"
            onClick={() => {
              if (attachment) {
                onFeedback("Remove the photo before recording a voice message.");
                return;
              }
              setPreparedVoice(null);
              void voice.start();
            }}
            disabled={uploadBusy || isPending || Boolean(preparedVoice)}
            aria-label="Record voice message"
            className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-secondary/55 text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <Mic className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center rounded-full bg-secondary/70 px-2 focus-within:bg-secondary">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={attachment ? "Add a caption" : placeholder}
            aria-label={attachment ? "Photo caption" : placeholder}
            maxLength={2000}
            disabled={isPending}
            className="h-12 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!canSend || uploadBusy || isPending || voiceBlocksSend}
            aria-label="Send message"
            className={cn(
              "focus-ring safe-motion grid h-10 w-10 shrink-0 place-items-center rounded-full",
              canSend && !uploadBusy && !isPending
                ? "bg-primary text-primary-foreground"
                : "scale-90 bg-transparent text-muted-foreground"
            )}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function formatVoiceDuration(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}
