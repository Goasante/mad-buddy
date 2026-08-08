export type PreparedVoiceAsset = {
  mediaId: string;
  durationMs: number;
  waveform: number[] | null;
};

export type AuthorizedVoicePlayback = PreparedVoiceAsset & {
  url: string;
  expiresAt: string;
  contentType: "audio/webm" | "audio/mp4";
};

type ActivePlayback = {
  id: string;
  pause: () => void;
};

let activePlayback: ActivePlayback | null = null;

/** Coordinates every web voice player without introducing global React state. */
export function claimVoicePlayback(id: string, pause: () => void): void {
  if (activePlayback?.id !== id) activePlayback?.pause();
  activePlayback = { id, pause };
}

export function releaseVoicePlayback(id: string): void {
  if (activePlayback?.id === id) activePlayback = null;
}

export function resetVoicePlaybackForTests(): void {
  activePlayback = null;
}

export function formatVoiceDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function voicePlaybackNeedsRefresh(expiresAt: string, nowMs = Date.now()): boolean {
  const expiry = Date.parse(expiresAt);
  return !Number.isFinite(expiry) || expiry - nowMs <= 15_000;
}
