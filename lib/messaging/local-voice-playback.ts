export type LocalAudioPlaybackTarget = Pick<
  HTMLAudioElement,
  "muted" | "defaultMuted" | "volume" | "readyState" | "duration" | "play"
>;

export type LocalVoicePlaybackResult =
  | {
      ok: true;
      readyState: number;
      duration: number | null;
      muted: false;
      volume: number;
    }
  | {
      ok: false;
      readyState: number;
      duration: number | null;
      muted: boolean;
      volume: number;
      errorName: string;
      errorCode: number | null;
    };

/**
 * Starts only from an explicit UI action. Native audio owns output routing;
 * waveform/Web Audio state is intentionally not involved.
 */
export async function playLocalVoicePreview(
  audio: LocalAudioPlaybackTarget
): Promise<LocalVoicePlaybackResult> {
  audio.defaultMuted = false;
  audio.muted = false;
  audio.volume = 1;

  try {
    await audio.play();
    return {
      ok: true,
      readyState: audio.readyState,
      duration: finiteDuration(audio.duration),
      muted: false,
      volume: audio.volume
    };
  } catch (error) {
    return {
      ok: false,
      readyState: audio.readyState,
      duration: finiteDuration(audio.duration),
      muted: audio.muted,
      volume: audio.volume,
      errorName: safeErrorName(error),
      errorCode: safeErrorCode(error)
    };
  }
}

function finiteDuration(duration: number): number | null {
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function safeErrorName(error: unknown): string {
  if (error instanceof DOMException) return error.name;
  if (typeof error === "object" && error && "name" in error) return String(error.name);
  return "PlaybackError";
}

function safeErrorCode(error: unknown): number | null {
  if (typeof error !== "object" || !error || !("code" in error)) return null;
  const code = Number(error.code);
  return Number.isFinite(code) ? code : null;
}
