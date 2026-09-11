"use client";

import { Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { StaticVoiceWaveform } from "@/components/messaging/voice-waveform-bar";
import { getVoiceMessagePlaybackViaApi } from "@/lib/messaging/media-upload-client";
import type { AuthorizedVoicePlayback, PreparedVoiceAsset } from "@/lib/messaging/voice-playback";
import { voicePlaybackNeedsRefresh } from "@/lib/messaging/voice-playback";
import { reportVoiceFailure } from "@/lib/messaging/voice-reliability";

/**
 * A sent voice message in the thread.
 *
 * The old player waited until the first tap to call a Server Action, then put
 * the signed URL into state and tried to autoplay from a later React effect.
 * On iOS/WebKit that later `audio.play()` is no longer inside the user's tap
 * gesture, so the UI could finish "loading" and immediately stop without ever
 * producing sound. The action lane could also make the first tap wait a long
 * time before Storage was even contacted.
 *
 * Playback authority is now prefetched over the independent media JSON lane.
 * The actual `audio.play()` only happens directly inside a button tap. If a
 * person taps before prefetch has finished, that tap prepares the URL and the
 * next tap plays it rather than attempting a browser-blocked async autoplay.
 */
export function VoiceMessageBubble({
  conversationId,
  messageId,
  asset,
  senderName
}: {
  conversationId: string;
  messageId: string;
  asset: PreparedVoiceAsset;
  senderName: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playback, setPlayback] = useState<AuthorizedVoicePlayback | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [failed, setFailed] = useState(false);

  const durationSeconds = Math.max(1, Math.round(asset.durationMs / 1000));

  const loadPlayback = useCallback(async (showLoading: boolean) => {
    if (showLoading) setLoading(true);
    const result = await getVoiceMessagePlaybackViaApi({ conversationId, messageId });
    if (showLoading) setLoading(false);

    if (!result.ok) {
      reportVoiceFailure("playback_authorization_failed");
      setFailed(true);
      return null;
    }
    if (!result.playback) {
      reportVoiceFailure("playback_authorization_failed");
      setFailed(true);
      return null;
    }

    setPlayback(result.playback);
    setFailed(false);
    return result.playback;
  }, [conversationId, messageId]);

  useEffect(() => {
    let disposed = false;
    // Prefetch the small signed-playback grant while the bubble is visible.
    // State updates happen only in the async callback, keeping the effect a
    // synchronization boundary rather than a synchronous render cascade.
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

    // Never try to use an expired URL. Fetching a replacement is asynchronous,
    // so intentionally do not autoplay after it resolves; a second explicit tap
    // keeps WebKit's user-activation contract intact.
    if (!playback || voicePlaybackNeedsRefresh(playback.expiresAt)) {
      await loadPlayback(true);
      return;
    }

    if (!audio) return;
    setFailed(false);
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      reportVoiceFailure("playback_failed");
      setPlaying(false);
      setFailed(true);
    }
  }

  return (
    <div className="voice-bubble">
      {playback ? (
        <audio
          ref={audioRef}
          src={playback.url}
          preload="metadata"
          playsInline
          onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
          onPlaying={() => {
            setPlaying(true);
            setFailed(false);
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setElapsed(0);
          }}
          onError={() => {
            reportVoiceFailure("playback_failed");
            setPlaying(false);
            setFailed(true);
            if (voicePlaybackNeedsRefresh(playback.expiresAt)) setPlayback(null);
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
        className="voice-bubble-play"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : failed ? (
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        ) : playing ? (
          <Pause className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Play className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      <StaticVoiceWaveform waveform={asset.waveform} progress={elapsed / durationSeconds} />

      <span className={failed ? "voice-bubble-time text-destructive" : "voice-bubble-time"}>
        {failed ? "Retry" : formatDuration(playing || elapsed > 0 ? elapsed : durationSeconds)}
      </span>

      {failed ? (
        <span className="sr-only" role="alert">
          This voice message could not be played. Tap retry.
        </span>
      ) : null}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
