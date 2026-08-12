import "server-only";

export const MAX_VOICE_NOTE_BYTES = 3 * 1024 * 1024;

/**
 * Hard ceiling for a client-declared duration.
 *
 * Only ever applied to the fallback hint. Entitlement limits are stricter and
 * are enforced separately; this exists so an absent container duration can
 * never be turned into an arbitrary number.
 */
export const MAX_VOICE_NOTE_DURATION_MS = 5 * 60 * 1000;
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

/**
 * Matroska spellings that mean "this is a WebM recording".
 *
 * MediaRecorder often reports `audio/x-matroska;codecs=opus` even when
 * `audio/webm` was requested and `isTypeSupported("audio/webm")` returned
 * true -- WebM is a Matroska profile, and the bytes carry the same EBML
 * magic number this module already sniffs as "webm". Rejecting these names
 * fails a recording that is, byte for byte, exactly what we asked for.
 *
 * Only the NAME is treated as an alias. The container and codec are still
 * verified from the parsed bytes, so this widens what we recognise, never
 * what we trust.
 */
const WEBM_MIME_ALIASES = ["audio/x-matroska", "video/x-matroska", "audio/matroska"] as const;

export function normalizeVoiceAudioMime(input: string): VoiceAudioMime | null {
  const normalized = input.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if ((VOICE_AUDIO_MIME_TYPES as readonly string[]).includes(normalized)) {
    return normalized as VoiceAudioMime;
  }
  if ((WEBM_MIME_ALIASES as readonly string[]).includes(normalized)) return "audio/webm";
  return null;
}

export function voiceAudioExtension(mimeType: VoiceAudioMime): VoiceAudioContainer {
  return mimeType === "audio/webm" ? "webm" : "mp4";
}

/**
 * Whether a stored content type names a voice format this pipeline serves.
 *
 * The single rule for every read-side check. Storage writes a normalized,
 * enum-constrained value, so codec parameters cannot reach the column -- but
 * each call site previously inlined its own `["audio/webm", "audio/mp4"]`
 * literal, and five copies of a list drift. Normalizing here means a codec
 * suffix, odd spacing or casing can never split send from playback.
 *
 * Strict by construction: it delegates to normalizeVoiceAudioMime, so
 * `audio/mpeg`, `video/webm` and a bare `audio/*` stay rejected.
 */
export function isSupportedVoiceContentType(contentType: string | null | undefined): boolean {
  return typeof contentType === "string" && normalizeVoiceAudioMime(contentType) !== null;
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
  parser: (bytes: Uint8Array, mimeType: VoiceAudioMime) => Promise<ParsedAudioMetadata> = parseAudio,
  /**
   * Client-measured duration, in ms, used ONLY when the container itself
   * carries none.
   *
   * MediaRecorder writes webm with no Duration element when start() is called
   * without a timeslice -- the length is not known until stop, and it never
   * goes back to rewrite the header. That is a valid recording, so rejecting
   * it means webm engines can never send a voice message at all.
   *
   * This is a HINT, never a trusted value: it is bounded below and above here,
   * and the entitlement ceiling is still enforced by the caller against the
   * result. A client cannot use it to claim a longer recording than allowed.
   */
  clientDurationMsHint?: number
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

  // The container's own duration is always preferred: it is derived from the
  // bytes actually stored, so it cannot be overstated by a caller.
  const durationSeconds = format.duration;
  const parsedIsUsable =
    Number.isFinite(durationSeconds) && typeof durationSeconds === "number" && durationSeconds > 0;

  let durationMs: number;
  if (parsedIsUsable) {
    durationMs = Math.round(durationSeconds * 1000);
  } else if (
    typeof clientDurationMsHint === "number" &&
    Number.isFinite(clientDurationMsHint) &&
    clientDurationMsHint > 0
  ) {
    // Bounded, so a durationless container cannot become an unbounded claim.
    durationMs = Math.min(MAX_VOICE_NOTE_DURATION_MS, Math.round(clientDurationMsHint));
  } else {
    return { valid: false, reason: "invalid_duration" };
  }

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
