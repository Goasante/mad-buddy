import "server-only";

export const MAX_VOICE_NOTE_BYTES = 3 * 1024 * 1024;
export const VOICE_AUDIO_MIME_TYPES = ["audio/webm", "audio/mp4"] as const;

export type VoiceAudioMime = (typeof VOICE_AUDIO_MIME_TYPES)[number];
export type VoiceAudioContainer = "webm" | "mp4";

export type ParsedAudioMetadata = {
  format: {
    container?: string;
    codec?: string;
    duration?: number;
    hasAudio?: boolean;
    hasVideo?: boolean;
    trackInfo?: Array<{ type?: number; codecName?: string }>;
  };
};

export type VoiceAudioInspection =
  | { valid: true; mimeType: VoiceAudioMime; container: VoiceAudioContainer; codec: "opus" | "aac"; durationMs: number }
  | {
      valid: false;
      reason: "empty" | "too_large" | "unsupported_mime" | "content_mismatch" | "invalid_container" | "wrong_codec" | "invalid_duration";
    };

export function normalizeVoiceAudioMime(input: string): VoiceAudioMime | null {
  const normalized = input.split(";", 1)[0]?.trim().toLowerCase();
  return (VOICE_AUDIO_MIME_TYPES as readonly string[]).includes(normalized ?? "")
    ? normalized as VoiceAudioMime
    : null;
}

export function voiceAudioExtension(mimeType: VoiceAudioMime): VoiceAudioContainer {
  return mimeType === "audio/webm" ? "webm" : "mp4";
}

export function sniffVoiceAudioContainer(bytes: Uint8Array): VoiceAudioContainer | null {
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "webm";
  }
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return "mp4";
  }
  return null;
}

async function parseAudio(bytes: Uint8Array, mimeType: VoiceAudioMime): Promise<ParsedAudioMetadata> {
  const { parseBuffer } = await import("music-metadata");
  return parseBuffer(bytes, { mimeType, size: bytes.byteLength }, { duration: true, skipCovers: true });
}

/**
 * Parses the complete stored object. Magic bytes are only an early mismatch
 * check; trusted codec/container/duration all come from the media parser.
 */
export async function inspectVoiceAudio(
  bytes: Uint8Array,
  claimedMimeType: string,
  parser: (bytes: Uint8Array, mimeType: VoiceAudioMime) => Promise<ParsedAudioMetadata> = parseAudio
): Promise<VoiceAudioInspection> {
  if (bytes.byteLength === 0) return { valid: false, reason: "empty" };
  if (bytes.byteLength > MAX_VOICE_NOTE_BYTES) return { valid: false, reason: "too_large" };
  const mimeType = normalizeVoiceAudioMime(claimedMimeType);
  if (!mimeType) return { valid: false, reason: "unsupported_mime" };
  const actualContainer = sniffVoiceAudioContainer(bytes);
  const expectedContainer = voiceAudioExtension(mimeType);
  if (!actualContainer || actualContainer !== expectedContainer) return { valid: false, reason: "content_mismatch" };

  let metadata: ParsedAudioMetadata;
  try {
    metadata = await parser(bytes, mimeType);
  } catch {
    return { valid: false, reason: "invalid_container" };
  }

  const format = metadata.format;
  const container = (format.container ?? "").toLowerCase();
  const codecNames = [format.codec, ...(format.trackInfo ?? []).map((track) => track.codecName)]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  const hasAudio = format.hasAudio === true || Boolean(format.codec);
  const hasVideo = format.hasVideo === true;
  const containerMatches = expectedContainer === "webm"
    ? /webm|matroska|ebml/.test(container)
    : /mp4|m4a|mpeg-?4|isom|quicktime/.test(container);
  if (!containerMatches || !hasAudio || hasVideo) return { valid: false, reason: "invalid_container" };

  const codecMatches = expectedContainer === "webm"
    ? /opus/.test(codecNames)
    : /aac|mp4a/.test(codecNames);
  if (!codecMatches) return { valid: false, reason: "wrong_codec" };

  const durationSeconds = format.duration;
  if (!Number.isFinite(durationSeconds) || !durationSeconds || durationSeconds <= 0) {
    return { valid: false, reason: "invalid_duration" };
  }
  const durationMs = Math.round(durationSeconds * 1000);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) return { valid: false, reason: "invalid_duration" };

  return {
    valid: true,
    mimeType,
    container: expectedContainer,
    codec: expectedContainer === "webm" ? "opus" : "aac",
    durationMs
  };
}

export function voiceAudioInspectionMessage(reason: Extract<VoiceAudioInspection, { valid: false }>["reason"]): string {
  switch (reason) {
    case "empty":
      return "No audio was uploaded. Record the voice message again.";
    case "too_large":
      return "That voice message is larger than 3 MB. Record a shorter one.";
    case "unsupported_mime":
    case "content_mismatch":
    case "invalid_container":
    case "wrong_codec":
      return "That recording format could not be verified. Record it again.";
    case "invalid_duration":
      return "The recording duration could not be verified. Record it again.";
  }
}
