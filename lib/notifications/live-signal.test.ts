import { describe, expect, it } from "vitest";
import { parseLiveSignal, selectNewSignals } from "@/lib/notifications/live-signal";

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

describe("selectNewSignals", () => {
  const wave = { id: "n1", type: `wave:${SENDER}` };
  const achievement = { id: "n2", type: "achievement:first_muddy" };
  const chatter = { id: "n3", type: "message:new" };

  it("returns nothing for rows already accounted for", () => {
    const seen = new Set(["n1", "n2"]);
    expect(selectNewSignals([wave, achievement], seen)).toEqual([]);
  });

  it("returns only unseen rows that are live signals", () => {
    const seen = new Set<string>();
    const picked = selectNewSignals([chatter, achievement, wave], seen);
    expect(picked.map((entry) => entry.id)).toEqual(["n1", "n2"]);
  });

  it("marks every row seen, including non-signals, so nothing repeats", () => {
    const seen = new Set<string>();
    selectNewSignals([chatter, achievement, wave], seen);
    expect(seen).toEqual(new Set(["n1", "n2", "n3"]));
    // A second pass over the same list must produce nothing.
    expect(selectNewSignals([chatter, achievement, wave], seen)).toEqual([]);
  });

  it("orders oldest first, so the newest signal ends up on screen last", () => {
    // The API returns newest first; the newest must be presented last.
    const seen = new Set<string>();
    const picked = selectNewSignals([achievement, wave], seen);
    expect(picked.map((entry) => entry.id)).toEqual(["n1", "n2"]);
  });

  it("never depends on a timestamp, a wrong device clock must not hide signals", () => {
    const seen = new Set<string>();
    const ancient = { id: "old", type: "achievement:first_wave" };
    expect(selectNewSignals([ancient], seen)).toHaveLength(1);
  });

  it("tolerates malformed rows", () => {
    const seen = new Set<string>();
    const rows = [{ id: "", type: "wave:x" }, achievement] as Array<{ id: string; type: string }>;
    expect(selectNewSignals(rows, seen).map((entry) => entry.id)).toEqual(["n2"]);
  });
});
