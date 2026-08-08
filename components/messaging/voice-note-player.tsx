"use client";

import { Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { getPreparedVoicePlaybackAction } from "@/app/(app)/messaging-actions";
import {
  claimVoicePlayback,
  formatVoiceDuration,
  releaseVoicePlayback,
  voicePlaybackNeedsRefresh,
  type AuthorizedVoicePlayback,
  type PreparedVoiceAsset
} from "@/lib/messaging/voice-playback";
import { cn } from "@/lib/utils";

const refreshes = new Map<string, Promise<AuthorizedVoicePlayback | null>>();

function refreshPreparedVoice(conversationId: string, mediaId: string) {
  const key = `${conversationId}:${mediaId}`;
  const existing = refreshes.get(key);
  if (existing) return existing;
  const request = getPreparedVoicePlaybackAction({ conversationId, mediaId })
    .then((result) => result.ok ? result.playback ?? null : null)
    .catch(() => null)
    .finally(() => refreshes.delete(key));
  refreshes.set(key, request);
  return request;
}

export function VoiceNotePlayer({
  conversationId,
  asset,
  initialPlayback = null
}: {
  conversationId: string;
  asset: PreparedVoiceAsset;
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

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const update = () => setElapsedMs(Number.isFinite(audio.currentTime) ? audio.currentTime * 1_000 : 0);
    const paused = () => {
      setPlaying(false);
      releaseVoicePlayback(instanceId);
    };
    audio.addEventListener("timeupdate", update);
    audio.addEventListener("seeked", update);
    audio.addEventListener("pause", paused);
    audio.addEventListener("ended", paused);
    return () => {
      audio.pause();
      releaseVoicePlayback(instanceId);
      audio.removeEventListener("timeupdate", update);
      audio.removeEventListener("seeked", update);
      audio.removeEventListener("pause", paused);
      audio.removeEventListener("ended", paused);
    };
  }, [instanceId]);

  async function renew(): Promise<AuthorizedVoicePlayback | null> {
    if (loading) return playback;
    setLoading(true);
    const next = await refreshPreparedVoice(conversationId, asset.mediaId);
    setLoading(false);
    if (!next) {
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
      releaseVoicePlayback(instanceId);
      setPlaying(false);
      setFailed(true);
    }
  }

  const waveform = playback?.waveform ?? asset.waveform;
  const durationMs = playback?.durationMs ?? asset.durationMs;
  const progress = durationMs > 0 ? elapsedMs / durationMs : 0;

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-background/45 p-2.5" aria-label="Prepared voice message">
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
        {loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
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
        </div>
      </div>
    </div>
  );
}
