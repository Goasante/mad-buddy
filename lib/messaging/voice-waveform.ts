export const VOICE_WAVEFORM_POINT_COUNT = 48;
export const VOICE_WAVEFORM_MAX_POINTS = 64;

export type VoiceWaveformValidation =
  | { valid: true; waveform: number[] | null }
  | { valid: false; reason: "not_array" | "too_many_points" | "invalid_value" };

/** Presentation-only metadata. Never use this for trust or authorization. */
export function validateVoiceWaveform(input: unknown): VoiceWaveformValidation {
  if (input === undefined || input === null) return { valid: true, waveform: null };
  if (!Array.isArray(input)) return { valid: false, reason: "not_array" };
  if (input.length === 0 || input.length > VOICE_WAVEFORM_MAX_POINTS) {
    return { valid: false, reason: "too_many_points" };
  }
  if (!input.every((point) => Number.isInteger(point) && point >= 0 && point <= 100)) {
    return { valid: false, reason: "invalid_value" };
  }
  return { valid: true, waveform: [...input] as number[] };
}

export function normalizeVoiceEnvelope(
  channels: readonly Float32Array[],
  pointCount = VOICE_WAVEFORM_POINT_COUNT
): number[] {
  const count = Math.max(1, Math.min(VOICE_WAVEFORM_MAX_POINTS, Math.floor(pointCount)));
  const samples = channels.reduce((maximum, channel) => Math.max(maximum, channel.length), 0);
  if (samples === 0) return Array.from({ length: count }, () => 0);

  const envelope = Array.from({ length: count }, (_, bucket) => {
    const start = Math.floor((bucket * samples) / count);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * samples) / count));
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      let mono = 0;
      let contributors = 0;
      for (const channel of channels) {
        if (index >= channel.length) continue;
        mono += channel[index] ?? 0;
        contributors += 1;
      }
      if (contributors > 0) peak = Math.max(peak, Math.abs(mono / contributors));
    }
    return peak;
  });

  const maximum = Math.max(...envelope);
  if (maximum <= 0) return envelope.map(() => 0);
  return envelope.map((point) => Math.max(0, Math.min(100, Math.round((point / maximum) * 100))));
}

type AudioContextLike = {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  close(): Promise<void>;
};

export async function generateVoiceWaveform(
  blob: Blob,
  createContext: () => AudioContextLike = () => {
    const Context = globalThis.AudioContext;
    if (!Context) throw new Error("Web Audio is unavailable");
    return new Context();
  }
): Promise<number[] | null> {
  let context: AudioContextLike | null = null;
  try {
    context = createContext();
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    return normalizeVoiceEnvelope(channels);
  } catch {
    return null;
  } finally {
    await context?.close().catch(() => undefined);
  }
}
