import { describe, expect, it, vi } from "vitest";
import {
  inspectVoiceAudio,
  isSupportedVoiceContentType,
  MAX_VOICE_NOTE_BYTES,
  MAX_VOICE_NOTE_DURATION_MS,
  normalizeVoiceAudioMime,
  sniffVoiceAudioContainer,
  type ParsedAudioMetadata,
  type VoiceAudioMime
} from "@/lib/media/audio-inspection";
import {
  agreedRecordingFamily,
  VOICE_RECORDING_MIME_CANDIDATES
} from "@/lib/messaging/voice-recording";
import {
  generateVoiceWaveform,
  normalizeVoiceEnvelope,
  validateVoiceWaveform,
  VOICE_WAVEFORM_POINT_COUNT
} from "@/lib/messaging/voice-waveform";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const webmHeader = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
const mp4Header = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

function parser(format: ParsedAudioMetadata["format"]) {
  return vi.fn(async (bytes: Uint8Array, mime: VoiceAudioMime) => {
    void bytes;
    void mime;
    return { format };
  });
}

describe("voice waveform", () => {
  it("creates exactly 48 normalized integer points", () => {
    const channel = Float32Array.from({ length: 480 }, (_, index) => Math.sin(index / 8) * ((index + 1) / 480));
    const waveform = normalizeVoiceEnvelope([channel]);
    expect(waveform).toHaveLength(VOICE_WAVEFORM_POINT_COUNT);
    expect(waveform.every((point) => Number.isInteger(point) && point >= 0 && point <= 100)).toBe(true);
    expect(Math.max(...waveform)).toBe(100);
  });

  it("mixes channels and remains deterministic", () => {
    const left = Float32Array.from([0, 0.2, 0.4, 0.8]);
    const right = Float32Array.from([0, -0.2, -0.4, -0.8]);
    expect(normalizeVoiceEnvelope([left, right], 4)).toEqual([0, 0, 0, 0]);
    expect(normalizeVoiceEnvelope([left], 4)).toEqual(normalizeVoiceEnvelope([left], 4));
  });

  it("treats decode failure as a non-fatal null waveform and closes context", async () => {
    const close = vi.fn(async () => undefined);
    const waveform = await generateVoiceWaveform(new Blob(["voice"]), () => ({
      decodeAudioData: vi.fn(async () => { throw new Error("unsupported local decoder"); }),
      close
    }));
    expect(waveform).toBeNull();
    expect(close).toHaveBeenCalledOnce();
  });

  it("validates only compact 0-100 integer arrays", () => {
    expect(validateVoiceWaveform(undefined)).toEqual({ valid: true, waveform: null });
    expect(validateVoiceWaveform([0, 50, 100]).valid).toBe(true);
    expect(validateVoiceWaveform("wave").valid).toBe(false);
    expect(validateVoiceWaveform([]).valid).toBe(false);
    expect(validateVoiceWaveform(Array.from({ length: 65 }, () => 1)).valid).toBe(false);
    expect(validateVoiceWaveform([2.5]).valid).toBe(false);
    expect(validateVoiceWaveform([-1, 101]).valid).toBe(false);
  });
});

describe("trusted audio inspection", () => {
  it("accepts parsed WebM Opus and ignores any client timer", async () => {
    const result = await inspectVoiceAudio(webmHeader, "audio/webm;codecs=opus", parser({
      container: "EBML/webm",
      codec: "Opus",
      duration: 12.345,
      hasAudio: true,
      hasVideo: false,
      trackInfo: []
    }));
    expect(result).toEqual({
      valid: true,
      mimeType: "audio/webm",
      container: "webm",
      codec: "opus",
      durationMs: 12345
    });
  });

  it("accepts parsed MP4 AAC", async () => {
    const result = await inspectVoiceAudio(mp4Header, "audio/mp4", parser({
      container: "M4A/isom",
      codec: "MPEG-4/AAC",
      duration: 5.2,
      hasAudio: true,
      hasVideo: false,
      trackInfo: []
    }));
    expect(result.valid && result.codec).toBe("aac");
    expect(result.valid && result.durationMs).toBe(5200);
  });

  it("rejects spoofed MIME, malformed containers, wrong codecs and video", async () => {
    expect((await inspectVoiceAudio(mp4Header, "audio/webm", parser({}))).valid).toBe(false);
    expect((await inspectVoiceAudio(new Uint8Array([1, 2, 3]), "audio/mp4", parser({}))).valid).toBe(false);
    expect(await inspectVoiceAudio(webmHeader, "audio/webm", parser({
      container: "webm", codec: "Vorbis", duration: 2, hasAudio: true, hasVideo: false, trackInfo: []
    }))).toEqual({ valid: false, reason: "wrong_codec" });
    expect(await inspectVoiceAudio(mp4Header, "audio/mp4", parser({
      container: "MP4", codec: "AAC", duration: 2, hasAudio: true, hasVideo: true, trackInfo: []
    }))).toEqual({ valid: false, reason: "invalid_container" });
  });

  it("rejects parser failure and untrusted or absent duration", async () => {
    const failedParser = vi.fn(async () => { throw new Error("broken"); });
    expect(await inspectVoiceAudio(webmHeader, "audio/webm", failedParser)).toEqual({ valid: false, reason: "invalid_container" });
    expect(await inspectVoiceAudio(webmHeader, "audio/webm", parser({
      container: "webm", codec: "Opus", hasAudio: true, hasVideo: false, trackInfo: []
    }))).toEqual({ valid: false, reason: "invalid_duration" });
  });

  /**
   * MediaRecorder writes webm with NO Duration element when start() is called
   * without a timeslice -- verified against music-metadata, which returns
   * `duration: undefined` for such a file. Rejecting those outright meant
   * every webm engine got "Couldn't record that voice message" on send.
   */
  it("falls back to the client duration when the container carries none", async () => {
    const result = await inspectVoiceAudio(
      webmHeader,
      "audio/webm",
      parser({ container: "webm", codec: "Opus", hasAudio: true, hasVideo: false, trackInfo: [] }),
      8_000
    );
    expect(result).toEqual({
      valid: true,
      mimeType: "audio/webm",
      container: "webm",
      codec: "opus",
      durationMs: 8_000
    });
  });

  it("prefers the container's own duration over the client's claim", async () => {
    // The bytes are authoritative whenever they can answer the question.
    const result = await inspectVoiceAudio(
      webmHeader,
      "audio/webm",
      parser({ container: "webm", codec: "Opus", duration: 3, hasAudio: true, hasVideo: false, trackInfo: [] }),
      900_000
    );
    expect(result.valid && result.durationMs).toBe(3_000);
  });

  it("bounds a client duration so an absent header cannot become any claim", async () => {
    const result = await inspectVoiceAudio(
      webmHeader,
      "audio/webm",
      parser({ container: "webm", codec: "Opus", hasAudio: true, hasVideo: false, trackInfo: [] }),
      Number.MAX_SAFE_INTEGER
    );
    expect(result.valid && result.durationMs).toBe(MAX_VOICE_NOTE_DURATION_MS);
  });

  it("still rejects a nonsensical client duration", async () => {
    const durationless = parser({ container: "webm", codec: "Opus", hasAudio: true, hasVideo: false, trackInfo: [] });
    for (const hint of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await inspectVoiceAudio(webmHeader, "audio/webm", durationless, hint)).toEqual({
        valid: false,
        reason: "invalid_duration"
      });
    }
  });

  it("never lets a client duration rescue an otherwise invalid recording", async () => {
    // Codec and container failures must not become negotiable.
    expect(await inspectVoiceAudio(webmHeader, "audio/webm", parser({
      container: "webm", codec: "Vorbis", hasAudio: true, hasVideo: false, trackInfo: []
    }), 8_000)).toEqual({ valid: false, reason: "wrong_codec" });
    expect(await inspectVoiceAudio(new Uint8Array([1, 2, 3]), "audio/mp4", parser({}), 8_000)).toEqual({
      valid: false,
      reason: "content_mismatch"
    });
  });

  it("enforces the 3 MB ceiling before parsing", async () => {
    const parse = parser({});
    const result = await inspectVoiceAudio(new Uint8Array(MAX_VOICE_NOTE_BYTES + 1), "audio/webm", parse);
    expect(result).toEqual({ valid: false, reason: "too_large" });
    expect(parse).not.toHaveBeenCalled();
  });

  it("normalizes only the audited MIME allowlist", () => {
    expect(normalizeVoiceAudioMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normalizeVoiceAudioMime("audio/mp4")).toBe("audio/mp4");
    expect(normalizeVoiceAudioMime("audio/mpeg")).toBeNull();
    expect(sniffVoiceAudioContainer(webmHeader)).toBe("webm");
    expect(sniffVoiceAudioContainer(mp4Header)).toBe("mp4");
  });
});

// ---------------------------------------------------------------------------
// REAL RECORDER MIME STRINGS
// ---------------------------------------------------------------------------

describe("MediaRecorder's own reported type", () => {
  /**
   * Chrome frequently reports `audio/x-matroska;codecs=opus` from
   * MediaRecorder.mimeType even when audio/webm was requested and
   * isTypeSupported("audio/webm") returned true. WebM is a Matroska profile
   * and the bytes carry the same EBML magic number, so rejecting the NAME
   * failed a recording that was byte-for-byte what we asked for.
   */
  it("accepts the matroska spelling of a webm recording", () => {
    expect(normalizeVoiceAudioMime("audio/x-matroska;codecs=opus")).toBe("audio/webm");
    expect(normalizeVoiceAudioMime("video/x-matroska")).toBe("audio/webm");
    expect(normalizeVoiceAudioMime("audio/matroska")).toBe("audio/webm");
  });

  it("still accepts the ordinary spellings", () => {
    expect(normalizeVoiceAudioMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normalizeVoiceAudioMime("audio/webm; codecs=opus")).toBe("audio/webm");
    expect(normalizeVoiceAudioMime("audio/mp4; codecs=mp4a.40.2")).toBe("audio/mp4");
  });

  it("still rejects formats the pipeline cannot handle", () => {
    // Widening the NAME must not widen what is accepted overall.
    expect(normalizeVoiceAudioMime("audio/ogg;codecs=opus")).toBeNull();
    expect(normalizeVoiceAudioMime("audio/wav")).toBeNull();
    expect(normalizeVoiceAudioMime("")).toBeNull();
  });

  it("verifies matroska-named bytes as a real webm container", async () => {
    // The alias only renames; container and codec still come from the bytes.
    const result = await inspectVoiceAudio(
      webmHeader,
      "audio/x-matroska;codecs=opus",
      parser({ container: "Matroska", codec: "Opus", duration: 4, hasAudio: true, hasVideo: false, trackInfo: [] })
    );
    expect(result).toEqual({
      valid: true,
      mimeType: "audio/webm",
      container: "webm",
      codec: "opus",
      durationMs: 4000
    });
  });

  it("still rejects matroska-named bytes that are not webm", async () => {
    expect(await inspectVoiceAudio(mp4Header, "audio/x-matroska", parser({}))).toEqual({
      valid: false,
      reason: "content_mismatch"
    });
  });
});

// ---------------------------------------------------------------------------
// ONE SOURCE OF TRUTH FOR ACCEPTED FORMATS
// ---------------------------------------------------------------------------

describe("the upload intent's accepted formats", () => {
  const actions = read("app/(app)/messaging-actions.ts");

  /**
   * THE BUG: the intent schema hardcoded z.enum([...]) with the three strings
   * the CLIENT requests. MediaRecorder reports what it actually produced,
   * which legitimately differs, so real recordings were rejected at the very
   * first server call with "That voice recording isn't supported."
   */
  it("validates through the shared normalizer, not a duplicated list", () => {
    expect(actions).toContain("normalizeVoiceAudioMime(value) !== null");
  });

  it("does not reintroduce a hardcoded format enum", () => {
    // A second list drifts from the real one the moment a browser changes.
    expect(actions).not.toContain('z.enum(["audio/webm;codecs=opus"');
  });

  it("accepts every string a real recorder reports", () => {
    for (const reported of [
      "audio/webm;codecs=opus",
      "audio/webm; codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/mp4; codecs=mp4a.40.2",
      "audio/x-matroska;codecs=opus"
    ]) {
      expect(normalizeVoiceAudioMime(reported), reported).not.toBeNull();
    }
  });

  it("keeps rejecting formats the pipeline cannot store", () => {
    for (const rejected of ["audio/ogg;codecs=opus", "audio/wav", "text/plain", ""]) {
      expect(normalizeVoiceAudioMime(rejected), rejected).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// isTypeSupported() IS A REQUEST, NOT A FACT
// ---------------------------------------------------------------------------

describe("what the recorder will actually emit", () => {
  /**
   * Chromium returns isTypeSupported("audio/mp4") === true and then emits
   * WebM bytes. The pipeline was told "mp4", the bytes said WebM, and the
   * recording failed byte verification while also refusing to play back.
   * Only MediaRecorder.mimeType, read after construction, is authoritative.
   */
  it("detects the chromium mp4-request-webm-output mismatch", () => {
    expect(agreedRecordingFamily("audio/mp4", "audio/webm;codecs=opus")).toBeNull();
  });

  it("agrees when the engine honours the request", () => {
    expect(agreedRecordingFamily("audio/webm;codecs=opus", "audio/webm;codecs=opus")).toBe("webm");
    expect(agreedRecordingFamily("audio/mp4", "audio/mp4")).toBe("mp4");
  });

  it("treats matroska output as the webm it is", () => {
    // WebM is a Matroska profile; this is agreement, not a mismatch.
    expect(agreedRecordingFamily("audio/webm", "audio/x-matroska;codecs=opus")).toBe("webm");
  });

  it("accepts equivalent mp4 spellings", () => {
    expect(agreedRecordingFamily("audio/mp4", "audio/x-m4a")).toBe("mp4");
    expect(agreedRecordingFamily("audio/mp4", "audio/mp4; codecs=mp4a.40.2")).toBe("mp4");
  });

  it("believes the request when the engine declines to say", () => {
    // An empty mimeType is silence, not disagreement.
    expect(agreedRecordingFamily("audio/webm", "")).toBe("webm");
  });

  it("reports a mismatch for an unrecognised output", () => {
    expect(agreedRecordingFamily("audio/webm", "audio/ogg;codecs=opus")).toBeNull();
  });
});

describe("recording format preference", () => {
  const recorder = read("lib/messaging/voice-recording.ts");

  it("prefers webm/opus, the format chromium actually produces", () => {
    // Leading with mp4 made every Chromium recording a lie about itself.
    expect(VOICE_RECORDING_MIME_CANDIDATES[0]).toBe("audio/webm;codecs=opus");
    expect(VOICE_RECORDING_MIME_CANDIDATES).toContain("audio/mp4");
  });

  it("falls back to the engine's native container on disagreement", () => {
    // Mirrors the working prototype's plain `new MediaRecorder(stream)`.
    expect(recorder).toContain("agreedRecordingFamily(capability.mimeType, recorder.mimeType ?? \"\") === null");
    expect(recorder).toContain("createMediaRecorder!(stream, {})");
  });
});

// ---------------------------------------------------------------------------
// ONE MIME RULE ACROSS THE WHOLE VOICE PIPELINE
// ---------------------------------------------------------------------------

describe("supported voice content types", () => {
  it("accepts the approved containers, with or without codec parameters", () => {
    for (const supported of [
      "audio/webm",
      "audio/webm;codecs=opus",
      "audio/webm; codecs=opus",
      "AUDIO/WEBM;CODECS=OPUS",
      "audio/mp4",
      "audio/mp4;codecs=mp4a.40.2",
      "  audio/mp4  "
    ]) {
      expect(isSupportedVoiceContentType(supported), supported).toBe(true);
    }
  });

  it("stays strict about everything else", () => {
    // Never widened to a bare `audio/*` prefix test.
    for (const rejected of [
      "audio/mpeg",
      "audio/wav",
      "audio/ogg;codecs=opus",
      "video/webm",
      "video/mp4",
      "application/octet-stream",
      "audio/",
      "",
      null,
      undefined
    ]) {
      expect(isSupportedVoiceContentType(rejected as string), String(rejected)).toBe(false);
    }
  });

  it("is the same rule the upload path applies", () => {
    // Send and playback must not be able to disagree about a stored asset.
    for (const value of ["audio/webm", "audio/mp4", "audio/mpeg", "video/webm", ""]) {
      expect(isSupportedVoiceContentType(value)).toBe(normalizeVoiceAudioMime(value) !== null);
    }
  });
});

describe("every read-side check uses the shared rule", () => {
  /**
   * These lists were previously inlined in five places. Five copies of the
   * same list drift, and a drift between the send resolver and the playback
   * projection means a voice note that sends successfully and then vanishes
   * on reload.
   */
  it("leaves no inline content-type list in the voice services", () => {
    for (const path of [
      "lib/messaging/voice-message-service.ts",
      "lib/media/voice-playback-service.ts"
    ]) {
      const source = read(path);
      expect(source, path).not.toContain('["audio/webm", "audio/mp4"]');
      expect(source, path).toContain("isSupportedVoiceContentType");
    }
  });

  it("covers both sending and recipient projection", () => {
    const service = read("lib/messaging/voice-message-service.ts");
    // resolveSendableMessageMedia -- the send path.
    const send = service.slice(service.indexOf("resolveSendableMessageMedia"), service.indexOf("projectVoiceMessages"));
    expect(send).toContain("isSupportedVoiceContentType");
    // projectVoiceMessages -- what a reloaded conversation renders.
    const project = service.slice(service.indexOf("export async function projectVoiceMessages"));
    expect(project).toContain("isSupportedVoiceContentType");
  });

  it("covers both playback grant paths", () => {
    const playback = read("lib/media/voice-playback-service.ts");
    // Both grants: the sender's own prepared asset, and a sent message's
    // asset for any authorized viewer. Call sites only, not the import.
    expect((playback.match(/!isSupportedVoiceContentType\(/g) ?? []).length).toBe(2);
  });
});
