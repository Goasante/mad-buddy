import { describe, expect, it, vi } from "vitest";
import {
  inspectVoiceAudio,
  MAX_VOICE_NOTE_BYTES,
  normalizeVoiceAudioMime,
  sniffVoiceAudioContainer,
  type ParsedAudioMetadata,
  type VoiceAudioMime
} from "@/lib/media/audio-inspection";
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

describe("Phase 4C/4D architecture boundaries", () => {
  const composer = read("components/messaging/message-composer.tsx");
  const preview = read("components/messaging/voice-recording-preview.tsx");
  const actions = read("app/(app)/messaging-actions.ts");
  const service = read("lib/media/chat-upload-service.ts");

  it("uses one compact local preview with accessible playback, seek, delete and re-record", () => {
    expect(composer).toContain("VoiceRecordingPreview");
    expect(preview).toContain('aria-label={playing ? "Pause voice preview" : "Play voice preview"}');
    expect(preview).toContain('aria-label="Seek voice preview"');
    expect(preview).toContain('aria-label="Delete voice recording"');
    expect(preview).toContain("Re-record");
  });

  it("preserves text and reports image/voice exclusivity instead of discarding", () => {
    expect(composer).toContain("Remove the photo before recording a voice message.");
    expect(composer).not.toContain("setDraft(\"\");\n              void voice.start()");
  });

  it("uses the canonical conversation-bound intent and direct upload lifecycle", () => {
    expect(actions).toContain("createVoiceMessageUploadIntentAction");
    expect(preview).toContain("uploadToSignedUrl");
    expect(service).toContain('intended_media_kind: input.mediaKind');
    expect(service).toContain('expectedMediaKind: ChatMediaKind');
  });

  it("binds finalize to the authenticated owner, chat context, conversation and media kind", () => {
    expect(service).toContain('.eq("owner_id", userId)');
    expect(service).toContain('.eq("context_type", "chat")');
    expect(service).toContain("asset.intended_conversation_id !== input.conversationId");
    expect(service).toContain("asset.intended_media_kind !== input.expectedMediaKind");
    expect(service).toContain("canSendMessage(admin, userId, input.conversationId)");
  });

  it("enforces actual uploaded bytes and canonical entitlements before ready", () => {
    expect(service).toContain("new Uint8Array(await raw.arrayBuffer())");
    expect(service).toContain("inspection.durationMs > entitlements.max_voice_note_seconds * 1000");
    expect(service).toContain("MAX_VOICE_NOTE_BYTES");
    expect(service.indexOf("inspectVoiceAudio(")).toBeLessThan(service.indexOf("duration_ms: inspection.durationMs"));
  });

  it("keeps finalize idempotent and reuses canonical discard/orphan cleanup", () => {
    expect(service).toContain('if (asset.processing_status === "ready")');
    expect(service).toContain('.eq("processing_status", "pending")');
    expect(preview).toContain("discardMessageAttachmentAction");
    expect(read("supabase/migrations/20260808260000_messaging_media_hardening.sql"))
      .toContain("queue_stale_unattached_chat_media");
  });

  it("derives trusted duration server-side and never creates a playback URL", () => {
    expect(service).toContain("inspectVoiceAudio(");
    expect(service).toContain("inspection.durationMs");
    expect(service).toContain("resolveUserEntitlements");
    expect(service).toContain('previewUrl: null');
    expect(preview).not.toContain("createSignedUrl");
  });

  it("hands the canonical prepared asset to the shared send path", () => {
    expect(preview).toContain("Ready to send.");
    expect(composer).toContain("preparedVoice?.mediaId ?? attachment?.mediaId");
    expect(actions).not.toContain("sendVoiceMessageAction");
  });
});
