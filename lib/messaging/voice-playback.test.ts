import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  claimVoicePlayback,
  formatVoiceDuration,
  releaseVoicePlayback,
  resetVoicePlaybackForTests,
  voicePlaybackNeedsRefresh
} from "@/lib/messaging/voice-playback";

const read = (path: string) => readFileSync(path, "utf8");

describe("canonical voice playback", () => {
  it("allows only one active player", () => {
    resetVoicePlaybackForTests();
    const pauseFirst = vi.fn();
    const pauseSecond = vi.fn();
    claimVoicePlayback("first", pauseFirst);
    claimVoicePlayback("second", pauseSecond);
    expect(pauseFirst).toHaveBeenCalledOnce();
    expect(pauseSecond).not.toHaveBeenCalled();
    releaseVoicePlayback("second");
    claimVoicePlayback("third", vi.fn());
    expect(pauseSecond).not.toHaveBeenCalled();
  });

  it("formats trusted duration and refreshes expiring grants", () => {
    expect(formatVoiceDuration(65_999)).toBe("1:05");
    expect(voicePlaybackNeedsRefresh("2026-08-08T23:00:14.000Z", Date.parse("2026-08-08T23:00:00.000Z"))).toBe(true);
    expect(voicePlaybackNeedsRefresh("2026-08-08T23:00:16.000Z", Date.parse("2026-08-08T23:00:00.000Z"))).toBe(false);
    expect(voicePlaybackNeedsRefresh("invalid", 0)).toBe(true);
  });
});

describe("Phase 4E boundaries", () => {
  const service = read("lib/media/voice-playback-service.ts");
  const player = read("components/messaging/voice-note-player.tsx");
  const preview = read("components/messaging/voice-recording-preview.tsx");
  const actions = read("app/(app)/messaging-actions.ts");

  it("authorizes the prepared parent before signing private storage", () => {
    expect(service.indexOf("canSendMessage(")).toBeLessThan(service.indexOf("createSignedUrl("));
    expect(service).toContain('.eq("owner_id", userId)');
    expect(service).toContain('.eq("intended_conversation_id", input.conversationId)');
    expect(service).toContain('.eq("intended_media_kind", "voice_note")');
    expect(service).toContain('.eq("processing_status", "ready")');
    expect(service).toContain('media_deletion_queue');
  });

  it("returns a safe playback projection without exposing storage keys", () => {
    expect(actions).toContain("getPreparedVoicePlaybackAction");
    expect(service).toContain("AuthorizedVoicePlayback");
    expect(service).not.toContain("storageKey:");
    expect(service).toContain("durationMs: asset.duration_ms");
    expect(service).toContain("validateVoiceWaveform(asset.waveform_data)");
  });

  it("supports accessible playback, seeking, retry and one-active coordination", () => {
    expect(player).toContain('aria-label={playing ? "Pause voice message" : "Play voice message"}');
    expect(player).toContain('aria-label="Seek voice message"');
    expect(player).toContain("claimVoicePlayback");
    expect(player).toContain("voicePlaybackNeedsRefresh");
    expect(player).toContain("Retry");
    expect(preview).toContain("<VoiceNotePlayer");
  });

  it("does not connect prepared audio to message sending or conversation rendering", () => {
    expect(player).not.toContain("sendMessage");
    expect(actions).not.toContain("sendVoiceMessageAction");
    expect(preview).toContain("Sending arrives in the next phase.");
  });
});
