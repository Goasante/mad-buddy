"use client";

import { Loader2, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getMessageVoicePlaybackAction } from "@/app/(app)/messaging-actions";
import { StaticVoiceWaveform } from "@/components/messaging/voice-waveform-bar";
import type { PreparedVoiceAsset } from "@/lib/messaging/voice-playback";
import { reportVoiceFailure } from "@/lib/messaging/voice-reliability";

/**
 * A sent voice message in the thread.
 *
 * Compact by design: play, the recording's own shape, and a duration. It is
 * a message, not a media player -- so no seek bar, no volume, no download,
 * and nothing that would make a chat bubble look like an audio app.
 *
 * The signed URL is minted LAZILY, on first play, through the canonical
 * per-message grant. Nothing is fetched for a message you scroll past.
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
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [failed, setFailed] = useState(false);

  const durationSeconds = Math.max(1, Math.round(asset.durationMs / 1000));

  useEffect(() => {
    // Stop audio if the message unmounts mid-playback (conversation switch,
    // list virtualisation, navigation).
    const audio = audioRef.current;
    return () => audio?.pause();
  }, []);

  async function toggle() {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
      return;
    }
    if (!src) {
      setLoading(true);
      setFailed(false);
      const result = await getMessageVoicePlaybackAction({ conversationId, messageId });
      setLoading(false);
      if (!result.ok || !result.playback) {
        reportVoiceFailure("playback_authorization_failed");
        setFailed(true);
        return;
      }
      setSrc(result.playback.url);
      return;
    }
    await audio?.play().then(() => setPlaying(true)).catch(() => {
      reportVoiceFailure("playback_failed");
      setFailed(true);
    });
  }

  // Autoplay once the freshly minted URL lands, so first tap plays rather
  // than merely fetching.
  useEffect(() => {
    if (!src) return;
    const audio = audioRef.current;
    if (!audio) return;
    void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [src]);

  return (
    <div className="voice-bubble">
      {src ? (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          playsInline
          onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setElapsed(0);
          }}
        />
      ) : null}

      <button
        type="button"
        onClick={() => void toggle()}
        disabled={loading}
        aria-label={
          playing ? `Pause voice message from ${senderName}` : `Play voice message from ${senderName}`
        }
        className="voice-bubble-play"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : playing ? (
          <Pause className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Play className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      <StaticVoiceWaveform waveform={asset.waveform} progress={elapsed / durationSeconds} />

      <span className="voice-bubble-time">
        {formatDuration(playing || elapsed > 0 ? elapsed : durationSeconds)}
      </span>

      {failed ? (
        <span className="sr-only" role="alert">
          This voice message could not be played.
        </span>
      ) : null}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
