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
      "components/messaging/voice-waveform-bar.tsx",
      "hooks/use-voice-upload.ts"
    ]) {
      expect(read(clientPath)).not.toContain("music-metadata");
    }
  });
});
