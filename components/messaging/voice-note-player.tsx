"use client";

import { Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { getMessageVoicePlaybackAction, getPreparedVoicePlaybackAction } from "@/app/(app)/messaging-actions";
import {
  claimVoicePlayback,
  formatVoiceDuration,
  releaseVoicePlayback,
  voicePlaybackNeedsRefresh,
  type AuthorizedVoicePlayback,
  type PreparedVoiceAsset
} from "@/lib/messaging/voice-playback";
import { cn } from "@/lib/utils";
import { reportVoiceFailure } from "@/lib/messaging/voice-reliability";

const refreshes = new Map<string, Promise<AuthorizedVoicePlayback | null>>();

function refreshVoice(conversationId: string, mediaId: string, messageId?: string) {
  const key = `${conversationId}:${messageId ?? `prepared:${mediaId}`}`;
  const existing = refreshes.get(key);
  if (existing) return existing;
  const request = (messageId
    ? getMessageVoicePlaybackAction({ conversationId, messageId })
    : getPreparedVoicePlaybackAction({ conversationId, mediaId }))
    .then((result) => result.ok ? result.playback ?? null : null)
    .catch(() => null)
    .finally(() => refreshes.delete(key));
  refreshes.set(key, request);
  return request;
}

export function VoiceNotePlayer({
  conversationId,
  asset,
  messageId,
  senderName,
  initialPlayback = null
}: {
  conversationId: string;
  asset: PreparedVoiceAsset;
  messageId?: string;
  senderName?: string;
  initialPlayback?: AuthorizedVoicePlayback | null;
}) {
  const instanceId = useId();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const refreshAttemptRef = useRef<string | null>(null);
  const [playback, setPlayback] = useState(initialPlayback);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const update = () => setElapsedMs(Number.isFinite(audio.currentTime) ? audio.currentTime * 1_000 : 0);
    const paused = () => {
      setPlaying(false);
      releaseVoicePlayback(instanceId);
    };
    const waitingForData = () => setWaiting(true);
    const ready = () => setWaiting(false);
    const failedPlayback = () => {
      setWaiting(false);
      setPlaying(false);
      setFailed(true);
      reportVoiceFailure("playback_failed");
    };
    audio.addEventListener("timeupdate", update);
    audio.addEventListener("seeked", update);
    audio.addEventListener("pause", paused);
    audio.addEventListener("ended", paused);
    audio.addEventListener("waiting", waitingForData);
    audio.addEventListener("stalled", waitingForData);
    audio.addEventListener("playing", ready);
    audio.addEventListener("canplay", ready);
    audio.addEventListener("error", failedPlayback);
    return () => {
      audio.pause();
      releaseVoicePlayback(instanceId);
      audio.removeEventListener("timeupdate", update);
      audio.removeEventListener("seeked", update);
      audio.removeEventListener("pause", paused);
      audio.removeEventListener("ended", paused);
      audio.removeEventListener("waiting", waitingForData);
      audio.removeEventListener("stalled", waitingForData);
      audio.removeEventListener("playing", ready);
      audio.removeEventListener("canplay", ready);
      audio.removeEventListener("error", failedPlayback);
    };
  }, [asset.mediaId, conversationId, instanceId, messageId]);

  async function renew(): Promise<AuthorizedVoicePlayback | null> {
    if (loading) return playback;
    setLoading(true);
    const next = await refreshVoice(conversationId, asset.mediaId, messageId);
    setLoading(false);
    if (!next) {
      reportVoiceFailure(playback ? "refresh_failed" : "playback_authorization_failed");
      setFailed(true);
      return null;
    }
    refreshAttemptRef.current = null;
    setPlayback(next);
    setFailed(false);
    return next;
  }

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }

    let current = playback;
    if (!current || voicePlaybackNeedsRefresh(current.expiresAt)) current = await renew();
    if (!current) return;
    if (audio.src !== current.url) {
      audio.src = current.url;
      audio.load();
    }
    claimVoicePlayback(instanceId, () => audio.pause());
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      reportVoiceFailure("playback_failed");
      releaseVoicePlayback(instanceId);
      setPlaying(false);
      setFailed(true);
    }
  }

  const waveform = playback?.waveform ?? asset.waveform;
  const durationMs = playback?.durationMs ?? asset.durationMs;
  const progress = durationMs > 0 ? elapsedMs / durationMs : 0;

  return (
    <div
      className="flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-background/45 p-2.5"
      aria-label={messageId ? `Voice message from ${senderName ?? "a Muddy"}` : "Prepared voice message"}
    >
      <audio
        ref={audioRef}
        src={playback?.url}
        preload="metadata"
        onError={() => {
          if (!playback || refreshAttemptRef.current === playback.url) {
            setFailed(true);
            return;
          }
          refreshAttemptRef.current = playback.url;
          void renew();
        }}
      />
      <button
        type="button"
        onClick={() => void togglePlayback()}
        disabled={loading}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-60"
      >
        {loading || waiting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex h-7 items-center gap-0.5 overflow-hidden" aria-hidden="true">
          {waveform?.map((point, index) => (
            <span
              key={index}
              className={cn("min-w-0 flex-1 rounded-full bg-muted-foreground/35", progress >= index / waveform.length && "bg-primary")}
              style={{ height: `${Math.max(8, point)}%` }}
            />
          )) ?? <span className="h-1 w-full rounded-full bg-border" />}
        </div>
        <input
          type="range"
          min={0}
          max={durationMs}
          step={100}
          value={Math.min(elapsedMs, durationMs)}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (audioRef.current) audioRef.current.currentTime = next / 1_000;
            setElapsedMs(next);
          }}
          aria-label="Seek voice message"
          aria-valuetext={`${formatVoiceDuration(elapsedMs)} of ${formatVoiceDuration(durationMs)}`}
          className="focus-ring h-5 w-full accent-primary"
        />
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{formatVoiceDuration(elapsedMs)} / {formatVoiceDuration(durationMs)}</span>
          {failed ? (
            <button type="button" onClick={() => void renew()} className="focus-ring inline-flex min-h-8 items-center gap-1 font-semibold text-foreground">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
            </button>
          ) : null}
          <span className="sr-only" aria-live="polite">{waiting ? "Voice message is buffering." : failed ? "Voice message playback failed. Retry is available." : ""}</span>
        </div>
      </div>
    </div>
  );
}
