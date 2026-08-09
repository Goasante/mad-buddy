import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  browserIsOnline,
  reportVoiceFailure,
  VOICE_FAILURE_CATEGORIES
} from "@/lib/messaging/voice-reliability";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("voice reliability diagnostics", () => {
  it("uses a fixed privacy-safe failure taxonomy", () => {
    expect(VOICE_FAILURE_CATEGORIES).toEqual(expect.arrayContaining([
      "recording_interrupted",
      "upload_intent_failed",
      "upload_failed",
      "finalize_failed",
      "send_failed",
      "playback_authorization_failed",
      "playback_failed",
      "refresh_failed"
    ]));
    const source = read("lib/messaging/voice-reliability.ts");
    for (const forbidden of ["blob", "signedUrl", "waveform", "messageContent", "audioBytes"]) {
      expect(source).not.toContain(`${forbidden}:`);
    }
  });

  it("reports only the category and connectivity state", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    reportVoiceFailure("send_failed");
    expect(warn).toHaveBeenCalledWith("[voice-note] operation failed", {
      category: "send_failed",
      online: expect.any(Boolean)
    });
    warn.mockRestore();
    expect(browserIsOnline()).toBe(true);
  });
});

describe("voice stage recovery", () => {
  const preview = read("components/messaging/voice-recording-preview.tsx");
  const composer = read("components/messaging/message-composer.tsx");
  const player = read("components/messaging/voice-note-player.tsx");
  const recorder = read("lib/messaging/voice-recording.ts");

  it("allows local preview offline but blocks network preparation honestly", () => {
    expect(preview).toContain("Your recording is safe here");
    expect(preview).toContain('window.addEventListener("online"');
    expect(preview).toContain('window.addEventListener("offline"');
    expect(recorder).not.toContain("navigator.onLine");
  });

  it("retries finalize without recreating or reuploading a successful intent", () => {
    expect(preview).toContain("let mediaId = intentRef.current");
    expect(preview).toContain("if (!mediaId)");
    const finalizeCatch = preview.slice(preview.indexOf("finalized = await"), preview.indexOf("if (operation !== operationRef.current) return;", preview.indexOf("finalized = await")));
    expect(finalizeCatch).not.toContain("discardMessageAttachmentAction");
    expect(finalizeCatch).not.toContain("intentRef.current = null");
  });

  it("preserves the same ready asset and client id for send retry", () => {
    expect(composer).toContain("clientMessageIdRef.current ?? crypto.randomUUID()");
    expect(composer).toContain("setVoiceSendFailed(Boolean(preparedVoice))");
    expect(composer).not.toContain("setPreparedVoice(null);\n        onFeedback(");
  });

  it("does not discard a READY asset when successful send unmounts preview", () => {
    expect(preview).toContain("intentRef.current = null;\n    setState({ kind: \"ready\", attachment })");
    expect(preview).toContain('state.kind === "ready" ? state.attachment.mediaId : null');
    const cleanup = preview.slice(preview.indexOf("useEffect(() => () =>"), preview.indexOf("async function togglePlayback"));
    expect(cleanup).toContain("intentRef.current");
    expect(cleanup).not.toContain("state.attachment.mediaId");
  });

  it("stops on background, track end, and recorder suspension", () => {
    expect(recorder).toContain('this.interruption = "backgrounded"');
    expect(recorder).toContain('this.interruption = "microphone_ended"');
    expect(recorder).toContain("recorder.onpause");
    expect(preview).toContain("Your captured audio was kept");
  });

  it("handles playback waiting, stalls, errors, expiry, and conversation cleanup", () => {
    for (const event of ["waiting", "stalled", "playing", "canplay", "error"]) {
      expect(player).toContain(`addEventListener(\"${event}\"`);
      expect(player).toContain(`removeEventListener(\"${event}\"`);
    }
    expect(player).toContain("voicePlaybackNeedsRefresh");
    expect(player).toContain("refreshes.get(key)");
    expect(player).toContain("audio.pause()");
    expect(player).toContain("releaseVoicePlayback(instanceId)");
  });

  it("keeps all interactive voice targets accessible", () => {
    expect(preview).toContain('aria-label="Seek voice preview"');
    expect(preview).toContain("min-h-11");
    expect(player).toContain('aria-label="Seek voice message"');
    expect(player).toContain('aria-live="polite"');
    expect(player).toContain("h-11 w-11");
  });
});

describe("private media and bundle boundaries", () => {
  it("keeps the service worker network-only", () => {
    const worker = read("public/sw.js");
    expect(worker).not.toMatch(/\bcaches\.(?:open|match|put|delete)\b/);
    expect(worker).toContain("fetch(event.request)");
  });

  it("keeps music-metadata behind server-only modules", () => {
    const inspection = read("lib/media/audio-inspection.ts");
    expect(inspection).toContain('import "server-only"');
    expect(inspection).toContain('import("music-metadata")');
    for (const clientPath of [
      "components/messaging/message-composer.tsx",
      "components/messaging/voice-recording-preview.tsx",
      "components/messaging/voice-note-player.tsx"
    ]) {
      expect(read(clientPath)).not.toContain("music-metadata");
    }
  });
});
