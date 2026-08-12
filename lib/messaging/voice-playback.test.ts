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
