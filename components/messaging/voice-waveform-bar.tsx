"use client";

import { useEffect, useState } from "react";
import { LIVE_WAVEFORM_BAR_COUNT, startVoiceAnalyser } from "@/lib/messaging/voice-analyser";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * Real microphone levels while recording.
 *
 * Reads the SAME stream MediaRecorder is recording, so the bars move because
 * the microphone actually hears something -- not on a CSS timer. If the
 * analyser cannot start (no AudioContext, autoplay policy, reduced motion),
 * this renders a resting line and recording is completely unaffected.
 *
 * Decorative: the elapsed timer and the recording controls carry the state,
 * so a live-updating loudness readout would be noise to a screen reader.
 */
export function LiveVoiceWaveform({ stream }: { stream: MediaStream | null }) {
  const reducedMotion = useReducedMotion();
  const [levels, setLevels] = useState<number[]>([]);
  useEffect(() => {
    if (!stream) return;
    const analyser = startVoiceAnalyser(stream, setLevels, { reducedMotion });
    // One teardown for every exit -- stop, cancel, error, unmount and a
    // changed stream all land here, and stop() is idempotent.
    return () => {
      analyser.stop();
      setLevels([]);
    };
  }, [reducedMotion, stream]);

  // Right-aligned: the newest sample sits at the right edge and older ones
  // scroll left, so the shape moves with the voice instead of filling up
  // from the left and then jumping.
  const bars = Array.from({ length: LIVE_WAVEFORM_BAR_COUNT }, (_, index) => {
    const offset = index - (LIVE_WAVEFORM_BAR_COUNT - levels.length);
    return offset >= 0 ? levels[offset] : 0;
  });

  return (
    <span aria-hidden="true" className="voice-wave">
      {bars.map((level, index) => (
        <span
          key={index}
          className="voice-wave-bar"
          // Height is data, not animation: no transition, so the bars track
          // the microphone rather than easing behind it.
          style={{ height: `${Math.round(10 + level * 90)}%` }}
        />
      ))}
    </span>
  );
}

/**
 * The captured recording's own shape, with playback progress.
 *
 * Static: this is the stored waveform, not a live one. Bars before the
 * playhead are filled so progress is legible without a separate progress
 * bar competing for width in a composer-sized row.
 */
export function StaticVoiceWaveform({
  waveform,
  progress
}: {
  waveform: number[] | null;
  /** 0..1 playback position. */
  progress: number;
}) {
  // A recording with no analysed waveform still needs a shape rather than an
  // empty gap, so it falls back to an even line.
  const points = waveform?.length
    ? waveform
    : Array.from({ length: LIVE_WAVEFORM_BAR_COUNT }, () => 32);
  const playedUpTo = Math.round(points.length * Math.min(1, Math.max(0, progress)));

  return (
    <span aria-hidden="true" className="voice-wave">
      {points.map((point, index) => (
        <span
          key={index}
          className={cn("voice-wave-bar", index < playedUpTo && "is-played")}
          style={{ height: `${Math.max(10, Math.min(100, point))}%` }}
        />
      ))}
    </span>
  );
}
