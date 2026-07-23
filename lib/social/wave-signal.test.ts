import { describe, expect, it } from "vitest";
import { isFreshWave, waveSenderIdFromType } from "@/lib/social/wave-signal";

const SENDER = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("waveSenderIdFromType", () => {
  it("reads the sender id out of a wave notification type", () => {
    expect(waveSenderIdFromType(`wave:${SENDER}`)).toBe(SENDER);
  });

  it("ignores every other notification base", () => {
    for (const type of [`message:${SENDER}`, `friend_request_received:${SENDER}`, `moment:${SENDER}`]) {
      expect(waveSenderIdFromType(type)).toBeNull();
    }
  });

  it("does not treat a base that merely starts with 'wave' as a wave", () => {
    expect(waveSenderIdFromType(`wavelength:${SENDER}`)).toBeNull();
  });

  it("rejects a missing, empty, or malformed sender id", () => {
    for (const type of ["wave", "wave:", "wave:not-a-uuid", "", null, undefined]) {
      expect(waveSenderIdFromType(type)).toBeNull();
    }
  });
});

describe("isFreshWave", () => {
  const now = Date.parse("2026-07-23T12:00:00.000Z");

  it("accepts a wave that just arrived", () => {
    expect(isFreshWave("2026-07-23T11:59:58.000Z", now)).toBe(true);
  });

  it("rejects a replayed older wave, so a reconnect never fakes a live one", () => {
    expect(isFreshWave("2026-07-23T11:00:00.000Z", now)).toBe(false);
  });

  it("tolerates small clock skew where the database is slightly ahead", () => {
    expect(isFreshWave("2026-07-23T12:00:02.000Z", now)).toBe(true);
  });

  it("rejects a timestamp far in the future", () => {
    expect(isFreshWave("2026-07-23T13:00:00.000Z", now)).toBe(false);
  });

  it("rejects an unparseable timestamp", () => {
    expect(isFreshWave("not a date", now)).toBe(false);
  });
});
