"use client";

import { Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { updateConversationUserPreferencesAction } from "@/app/(app)/messaging-ultimate-actions";
import { MessageRetentionV4 } from "@/components/messaging/message-retention-v4";
import { StaticVoiceWaveform } from "@/components/messaging/voice-waveform-bar";
import { getVoiceMessagePlaybackViaApi } from "@/lib/messaging/media-upload-client";
import type { AuthorizedVoicePlayback, PreparedVoiceAsset } from "@/lib/messaging/voice-playback";
import { voicePlaybackNeedsRefresh } from "@/lib/messaging/voice-playback";
import { reportVoiceFailure } from "@/lib/messaging/voice-reliability";

const SPEEDS = [1, 1.5, 2] as const;

export function VoiceMessageBubbleV4({
  conversationId,
  messageId,
  asset,
  senderName,
  initialSeconds = 0
}: {
  conversationId: string;
  messageId: string;
  asset: PreparedVoiceAsset;
  senderName: string;
  initialSeconds?: number;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLButtonElement | null>(null);
  const lastPersistedRef = useRef(0);
  const [playback, setPlayback] = useState<AuthorizedVoicePlayback | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(Math.max(0, initialSeconds));
  const [failed, setFailed] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);

  const src = playback?.url ?? null;
  const durationSeconds = Math.max(1, Math.round(asset.durationMs / 1000));
  const speed = SPEEDS[speedIndex];
  const mine = senderName === "you";

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
      if (elapsed > 0 && Math.abs(elapsed - lastPersistedRef.current) > 1) {
        void updateConversationUserPreferencesAction({
          conversationId,
          voicePlaybackMessageId: messageId,
          voicePlaybackSeconds: elapsed
        });
      }
    };
  }, [conversationId, elapsed, messageId]);

  const loadPlayback = useCallback(async (showLoading: boolean) => {
    if (showLoading) setLoading(true);
    const result = await getVoiceMessagePlaybackViaApi({ conversationId, messageId });
    if (showLoading) setLoading(false);
    if (!result.ok || !result.playback) {
      reportVoiceFailure("playback_authorization_failed");
      setFailed(true);
      return null;
    }
    setPlayback(result.playback);
    setFailed(false);
    return result.playback;
  }, [conversationId, messageId]);

  // Prefetch the signed playback URL while the bubble is visible, so the
  // <audio> element is already mounted (and audioRef populated) by the time
  // someone taps play. This does NOT call play() itself.
  useEffect(() => {
    let disposed = false;
    void getVoiceMessagePlaybackViaApi({ conversationId, messageId }).then((result) => {
      if (disposed) return;
      if (result.ok && result.playback) {
        setPlayback(result.playback);
        setFailed(false);
      }
    });
    return () => {
      disposed = true;
      audioRef.current?.pause();
    };
  }, [conversationId, messageId]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !playback) return;
      if (voicePlaybackNeedsRefresh(playback.expiresAt)) void loadPlayback(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadPlayback, playback]);

  async function toggle() {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
      return;
    }

    // Never reuse an expired URL, and never try to autoplay once an async
    // fetch resolves: on iOS/WebKit that later audio.play() call is no
    // longer inside this tap's user-activation window and gets silently
    // blocked, which is exactly what made sent voice notes look like they
    // "cut off" instead of playing. A second explicit tap (now almost always
    // unnecessary thanks to the prefetch above) keeps the play() call inside
    // its own real gesture.
    if (!playback || voicePlaybackNeedsRefresh(playback.expiresAt)) {
      await loadPlayback(true);
      return;
    }

    if (!audio) return;
    setFailed(false);
    try {
      audio.playbackRate = speed;
      await audio.play();
      setPlaying(true);
    } catch {
      reportVoiceFailure("playback_failed");
      setPlaying(false);
      setFailed(true);
    }
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speed;
  }, [speed]);

  function seek(event: React.PointerEvent<HTMLButtonElement>) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const next = ratio * audio.duration;
    audio.currentTime = next;
    setElapsed(next);
    if (!playing) void audio.play().then(() => setPlaying(true)).catch(() => undefined);
  }

  function persistPosition(next: number) {
    if (Math.abs(next - lastPersistedRef.current) < 3) return;
    lastPersistedRef.current = next;
    void updateConversationUserPreferencesAction({
      conversationId,
      voicePlaybackMessageId: messageId,
      voicePlaybackSeconds: next
    });
  }

  return (
    <div>
      <div className="voice-bubble min-w-[220px]">
        {src ? (
          <audio
            ref={audioRef}
            src={src}
            preload="metadata"
            playsInline
            onLoadedMetadata={(event) => {
              event.currentTarget.playbackRate = speed;
              if (initialSeconds > 0 && initialSeconds < event.currentTarget.duration) event.currentTarget.currentTime = initialSeconds;
            }}
            onTimeUpdate={(event) => {
              const next = event.currentTarget.currentTime;
              setElapsed(next);
              persistPosition(next);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              setElapsed(0);
              lastPersistedRef.current = 0;
              void updateConversationUserPreferencesAction({ conversationId, voicePlaybackMessageId: null, voicePlaybackSeconds: 0 });
            }}
            onError={() => {
              reportVoiceFailure("playback_failed");
              setPlaying(false);
              setFailed(true);
              if (playback && voicePlaybackNeedsRefresh(playback.expiresAt)) setPlayback(null);
            }}
          />
        ) : null}

        <button
          type="button"
          onClick={() => void toggle()}
          disabled={loading}
          aria-label={
            failed
              ? `Retry voice message from ${senderName}`
              : playing
                ? `Pause voice message from ${senderName}`
                : `Play voice message from ${senderName}`
          }
          className="voice-bubble-play transition-transform active:scale-90"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          ) : failed ? (
            <RotateCcw className="h-4 w-4" />
          ) : playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </button>

        <button
          ref={progressRef}
          type="button"
          onPointerDown={seek}
          onPointerMove={(event) => {
            if (event.buttons === 1) seek(event);
          }}
          aria-label={`Seek voice message. ${formatDuration(elapsed)} of ${formatDuration(durationSeconds)}`}
          className="focus-ring min-w-0 flex-1 cursor-pointer rounded-lg px-0.5 py-2 touch-none"
        >
          <StaticVoiceWaveform waveform={asset.waveform} progress={elapsed / durationSeconds} />
        </button>

        <span className="voice-bubble-time">{formatDuration(playing || elapsed > 0 ? elapsed : durationSeconds)}</span>

        <button
          type="button"
          onClick={() => setSpeedIndex((index) => (index + 1) % SPEEDS.length)}
          className="focus-ring min-w-8 rounded-full px-1.5 py-1 text-xs font-semibold transition-transform active:scale-90"
          aria-label={`Playback speed ${speed} times. Tap to change.`}
        >
          {speed}×
        </button>

        {failed ? <span className="sr-only" role="alert">This voice message could not be played. Tap retry.</span> : null}
      </div>
      <MessageRetentionV4 conversationId={conversationId} messageId={messageId} mine={mine} />
    </div>
  );
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
