import { describe, expect, it } from "vitest";
import { isFreshSignal, parseLiveSignal } from "@/lib/notifications/live-signal";

const SENDER = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("parseLiveSignal", () => {
  it("reads the sender id out of a wave notification type", () => {
    expect(parseLiveSignal(`wave:${SENDER}`)).toEqual({ kind: "wave", senderId: SENDER });
  });

  it("reads the code out of an achievement notification type", () => {
    expect(parseLiveSignal("achievement:first_muddy")).toEqual({ kind: "achievement", code: "first_muddy" });
  });

  it("ignores notification types that are not live signals", () => {
    for (const type of [`message:${SENDER}`, `friend_request_received:${SENDER}`, `moment:${SENDER}`]) {
      expect(parseLiveSignal(type)).toBeNull();
    }
  });

  it("does not treat a base that merely starts with a signal base as one", () => {
    expect(parseLiveSignal(`wavelength:${SENDER}`)).toBeNull();
    expect(parseLiveSignal("achievements:first_muddy")).toBeNull();
  });

  it("rejects a missing, empty, or malformed subject", () => {
    for (const type of ["wave", "wave:", "wave:not-a-uuid", "achievement", "achievement:", "", null, undefined]) {
      expect(parseLiveSignal(type)).toBeNull();
    }
  });

  it("rejects an achievement code with unexpected characters", () => {
    expect(parseLiveSignal("achievement:First Muddy")).toBeNull();
    expect(parseLiveSignal("achievement:../etc")).toBeNull();
  });
});

describe("isFreshSignal", () => {
  const now = Date.parse("2026-07-23T12:00:00.000Z");

  it("accepts a signal that just arrived", () => {
    expect(isFreshSignal("2026-07-23T11:59:58.000Z", now)).toBe(true);
  });

  it("rejects a replayed older signal, so a reconnect never fakes a live one", () => {
    expect(isFreshSignal("2026-07-23T11:00:00.000Z", now)).toBe(false);
  });

  it("tolerates small clock skew where the database is slightly ahead", () => {
    expect(isFreshSignal("2026-07-23T12:00:02.000Z", now)).toBe(true);
  });

  it("rejects a timestamp far in the future", () => {
    expect(isFreshSignal("2026-07-23T13:00:00.000Z", now)).toBe(false);
  });

  it("rejects an unparseable timestamp", () => {
    expect(isFreshSignal("not a date", now)).toBe(false);
  });
});
