"use client";

import { Check, Loader2, Pause, Play, RotateCcw, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  createVoiceMessageUploadIntentAction,
  discardMessageAttachmentAction,
  finalizeVoiceMessageUploadAction
} from "@/app/(app)/messaging-actions";
import { VoiceNotePlayer } from "@/components/messaging/voice-note-player";
import { playLocalVoicePreview } from "@/lib/messaging/local-voice-playback";
import type { LocalVoiceRecording } from "@/lib/messaging/voice-recording";
import type { PreparedVoiceAsset } from "@/lib/messaging/voice-playback";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type PreparedVoiceAttachment = PreparedVoiceAsset;

type PrepareState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "finalizing" }
  | { kind: "ready"; attachment: PreparedVoiceAttachment }
  | { kind: "failed"; message: string };

type PlaybackDiagnostic = {
  readyState: number;
  duration: number | null;
  muted: boolean;
  volume: number;
  errorName: string | null;
  errorCode: number | null;
};

export function VoiceRecordingPreview({
  conversationId,
  recording,
  onRerecord,
  onDelete,
  onPrepared
}: {
  conversationId: string;
  recording: LocalVoiceRecording;
  onRerecord: () => void;
  onDelete: () => void;
  onPrepared: (attachment: PreparedVoiceAttachment | null) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intentRef = useRef<string | null>(null);
  const operationRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [state, setState] = useState<PrepareState>({ kind: "idle" });
  const [playbackDiagnostic, setPlaybackDiagnostic] = useState<PlaybackDiagnostic>({
    readyState: 0,
    duration: null,
    muted: false,
    volume: 1,
    errorName: null,
    errorCode: null
  });
  const duration = Math.max(0.1, recording.durationSeconds);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.defaultMuted = false;
    audio.muted = false;
    audio.volume = 1;
    const update = () => setElapsed(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    const stopped = () => setPlaying(false);
    const updateDiagnostic = () => setPlaybackDiagnostic((current) => ({
      ...current,
      readyState: audio.readyState,
      duration: Number.isFinite(audio.duration) ? audio.duration : null,
      muted: audio.muted,
      volume: audio.volume
    }));
    const mediaFailed = () => setPlaybackDiagnostic({
      readyState: audio.readyState,
      duration: Number.isFinite(audio.duration) ? audio.duration : null,
      muted: audio.muted,
      volume: audio.volume,
      errorName: "MediaError",
      errorCode: audio.error?.code ?? null
    });
    audio.addEventListener("timeupdate", update);
    audio.addEventListener("seeked", update);
    audio.addEventListener("pause", stopped);
    audio.addEventListener("ended", stopped);
    audio.addEventListener("loadedmetadata", updateDiagnostic);
    audio.addEventListener("canplay", updateDiagnostic);
    audio.addEventListener("error", mediaFailed);
    audio.load();
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", update);
      audio.removeEventListener("seeked", update);
      audio.removeEventListener("pause", stopped);
      audio.removeEventListener("ended", stopped);
      audio.removeEventListener("loadedmetadata", updateDiagnostic);
      audio.removeEventListener("canplay", updateDiagnostic);
      audio.removeEventListener("error", mediaFailed);
    };
  }, [recording.objectUrl]);

  useEffect(() => () => {
    operationRef.current += 1;
    if (intentRef.current) void discardMessageAttachmentAction(intentRef.current);
  }, []);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    const result = await playLocalVoicePreview(audio);
    setPlaybackDiagnostic(result.ok
      ? { ...result, errorName: null, errorCode: null }
      : result);
    if (result.ok) {
      setPlaying(true);
    } else {
      setPlaying(false);
    }
  }

  async function prepare() {
    if (state.kind === "uploading" || state.kind === "finalizing" || state.kind === "ready") return;
    const operation = ++operationRef.current;
    setState({ kind: "uploading" });
    let created: Awaited<ReturnType<typeof createVoiceMessageUploadIntentAction>>;
    try {
      created = await createVoiceMessageUploadIntentAction({
        conversationId,
        contentType: recording.mimeType,
        sizeBytes: recording.blob.size
      });
    } catch {
      if (operation === operationRef.current) {
        setState({ kind: "failed", message: "Couldn't prepare that voice message. Try again." });
      }
      return;
    }
    if (operation !== operationRef.current) return;
    if (!created.ok || !created.mediaId || !created.path || !created.token) {
      setState({ kind: "failed", message: created.message });
      return;
    }
    intentRef.current = created.mediaId;

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.storage.from("media").uploadToSignedUrl(
        created.path,
        created.token,
        recording.blob,
        { contentType: recording.mimeType, upsert: true }
      );
      if (error) throw error;
    } catch {
      if (operation !== operationRef.current) return;
      void discardMessageAttachmentAction(created.mediaId);
      intentRef.current = null;
      setState({ kind: "failed", message: "Couldn't upload that voice message. Try again." });
      return;
    }

    if (operation !== operationRef.current) return;
    setState({ kind: "finalizing" });
    let finalized: Awaited<ReturnType<typeof finalizeVoiceMessageUploadAction>>;
    try {
      finalized = await finalizeVoiceMessageUploadAction({
        conversationId,
        mediaId: created.mediaId,
        waveform: recording.waveform
      });
    } catch {
      if (operation !== operationRef.current) return;
      void discardMessageAttachmentAction(created.mediaId);
      intentRef.current = null;
      setState({ kind: "failed", message: "Couldn't verify that voice message. Try again." });
      return;
    }
    if (operation !== operationRef.current) return;
    if (!finalized.ok || !finalized.mediaId || !finalized.durationMs) {
      void discardMessageAttachmentAction(created.mediaId);
      intentRef.current = null;
      setState({ kind: "failed", message: finalized.message });
      return;
    }
    const attachment = {
      mediaId: finalized.mediaId,
      durationMs: finalized.durationMs,
      waveform: recording.waveform
    };
    setState({ kind: "ready", attachment });
    onPrepared(attachment);
  }

  function discard() {
    operationRef.current += 1;
    audioRef.current?.pause();
    if (intentRef.current) void discardMessageAttachmentAction(intentRef.current);
    intentRef.current = null;
    onPrepared(null);
    onDelete();
  }

  function rerecord() {
    operationRef.current += 1;
    audioRef.current?.pause();
    if (intentRef.current) void discardMessageAttachmentAction(intentRef.current);
    intentRef.current = null;
    onPrepared(null);
    onRerecord();
  }

  const busy = state.kind === "uploading" || state.kind === "finalizing";
  return (
    <section className="mx-3 mt-3 rounded-2xl border border-border/70 bg-secondary/45 p-3" aria-label="Voice message preview">
      {state.kind === "ready" ? (
        <VoiceNotePlayer conversationId={conversationId} asset={state.attachment} />
      ) : (
        <>
          <audio
            ref={audioRef}
            src={recording.objectUrl}
            preload="auto"
            playsInline
            muted={false}
          />
          <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void togglePlayback()}
          aria-label={playing ? "Pause voice preview" : "Play voice preview"}
          className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
        >
          {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="relative flex h-8 items-center gap-0.5 overflow-hidden" aria-hidden="true">
            {recording.waveform?.map((point, index) => (
              <span
                key={index}
                className={cn("min-w-0 flex-1 rounded-full bg-primary/55", elapsed / duration >= index / recording.waveform!.length && "bg-primary")}
                style={{ height: `${Math.max(8, point)}%` }}
              />
            )) ?? <span className="h-1 w-full rounded-full bg-border" />}
          </div>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={Math.min(elapsed, duration)}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (audioRef.current) audioRef.current.currentTime = next;
              setElapsed(next);
            }}
            aria-label="Seek voice preview"
            aria-valuetext={`${formatDuration(elapsed)} of ${formatDuration(duration)}`}
            className="focus-ring h-5 w-full accent-primary"
          />
          <p className="text-xs text-muted-foreground">{formatDuration(elapsed)} / {formatDuration(duration)}</p>
        </div>
          </div>
        </>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {state.kind === "ready" ? (
          <span className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-emerald-500">
            <Check className="h-4 w-4" aria-hidden="true" /> Voice message prepared
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void prepare()}
            disabled={busy}
            className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
            {state.kind === "finalizing" ? "Verifying…" : state.kind === "uploading" ? "Uploading…" : "Prepare voice message"}
          </button>
        )}
        <button type="button" onClick={rerecord} disabled={busy} className="focus-ring ml-auto inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold disabled:opacity-50">
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Re-record
        </button>
        <button type="button" onClick={discard} disabled={busy} aria-label="Delete voice recording" className="focus-ring grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:text-destructive disabled:opacity-50">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {state.kind === "failed" ? <p className="mt-2 text-xs text-destructive" role="alert">{state.message}</p> : null}
      {playbackDiagnostic.errorName ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          This recording couldn&apos;t be played. Try recording it again.
        </p>
      ) : null}
      {state.kind === "ready" ? <p className="mt-1 text-xs text-muted-foreground">Prepared locally and verified. Sending arrives in the next phase.</p> : null}
      {process.env.NODE_ENV !== "production" && state.kind !== "ready" ? (
        <details className="mt-2 text-[11px] text-muted-foreground">
          <summary>Voice playback diagnostics</summary>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
            <dt>Selected MIME</dt><dd>{recording.diagnostics.selectedMimeType}</dd>
            <dt>Blob MIME</dt><dd>{recording.diagnostics.blobMimeType || "unknown"}</dd>
            <dt>Bytes</dt><dd>{recording.diagnostics.blobBytes}</dd>
            <dt>Measured duration</dt><dd>{recording.diagnostics.measuredDurationSeconds.toFixed(2)}s</dd>
            <dt>Audio readyState</dt><dd>{playbackDiagnostic.readyState}</dd>
            <dt>Audio duration</dt><dd>{playbackDiagnostic.duration?.toFixed(2) ?? "unknown"}</dd>
            <dt>Output</dt><dd>{playbackDiagnostic.muted ? "muted" : "audible"}, {playbackDiagnostic.volume}</dd>
            <dt>Playback error</dt><dd>{playbackDiagnostic.errorName ?? "none"}{playbackDiagnostic.errorCode === null ? "" : ` (${playbackDiagnostic.errorCode})`}</dd>
            <dt>Capture track</dt><dd>{recording.diagnostics.audioTrackCount}, {recording.diagnostics.trackReadyState}</dd>
          </dl>
        </details>
      ) : null}
    </section>
  );
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
