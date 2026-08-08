import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { playLocalVoicePreview, type LocalAudioPlaybackTarget } from "@/lib/messaging/local-voice-playback";

function audioTarget(play: () => Promise<void>): LocalAudioPlaybackTarget {
  return {
    muted: true,
    defaultMuted: true,
    volume: 0,
    readyState: 4,
    duration: 2.5,
    play
  };
}

describe("local voice preview playback", () => {
  it("unmutes native audio and restores full volume before explicit playback", async () => {
    const play = vi.fn(async () => undefined);
    const audio = audioTarget(play);

    expect(await playLocalVoicePreview(audio)).toMatchObject({ ok: true, muted: false, volume: 1 });
    expect(audio.defaultMuted).toBe(false);
    expect(audio.muted).toBe(false);
    expect(audio.volume).toBe(1);
    expect(play).toHaveBeenCalledOnce();
  });

  it("returns only safe play rejection metadata", async () => {
    const audio = audioTarget(vi.fn(async () => Promise.reject({ name: "NotAllowedError", code: 1 })));
    expect(await playLocalVoicePreview(audio)).toEqual({
      ok: false,
      readyState: 4,
      duration: 2.5,
      muted: false,
      volume: 1,
      errorName: "NotAllowedError",
      errorCode: 1
    });
  });

  it("uses native inline audio without autoplay and gates diagnostics from production", () => {
    const source = readFileSync(
      join(process.cwd(), "components/messaging/voice-recording-preview.tsx"),
      "utf8"
    );
    expect(source).toContain("playsInline");
    expect(source).toContain('muted={false}');
    expect(source).toContain('preload="auto"');
    expect(source).not.toContain("autoPlay");
    expect(source).toContain('process.env.NODE_ENV !== "production"');
    expect(source).toContain("playLocalVoicePreview(audio)");
  });
});
