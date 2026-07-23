import { describe, expect, it } from "vitest";
import { resolveJourneyState, watcherSummary } from "@/lib/safety/journey-status";

const HOUR = 60 * 60 * 1000;
const now = Date.parse("2026-07-23T12:00:00.000Z");

describe("resolveJourneyState", () => {
  it("shows In transit while active before the expected time", () => {
    const state = resolveJourneyState("active", {
      expectedArrivalMs: now + HOUR,
      gracePeriodMinutes: 20,
      nowMs: now
    });
    expect(state).toMatchObject({ key: "in_transit", status: "In transit", motion: "active", isLive: true });
  });

  it("softens to Still on the way past the expected time but within grace", () => {
    const state = resolveJourneyState("active", {
      expectedArrivalMs: now - 5 * 60 * 1000,
      gracePeriodMinutes: 20,
      nowMs: now
    });
    expect(state.status).toBe("Still on the way");
    expect(state.motion).toBe("active");
  });

  it("treats grace_period and extended as still live and in transit", () => {
    expect(resolveJourneyState("grace_period").key).toBe("in_transit");
    expect(resolveJourneyState("extended").isLive).toBe(true);
  });

  it("shows a neutral, non-alarmist waiting state for unconfirmed", () => {
    const state = resolveJourneyState("unconfirmed");
    expect(state).toMatchObject({ key: "waiting", motion: "waiting", isLive: true, announce: true });
    // Never implies danger.
    expect(state.status.toLowerCase()).not.toMatch(/missing|danger|emergency|alert|lost/);
  });

  it("stops the animation and announces on arrival", () => {
    const state = resolveJourneyState("completed");
    expect(state).toMatchObject({ key: "arrived", status: "Arrived safely", motion: "arrived", isLive: false, announce: true });
  });

  it("stops all animation for cancelled and expired sessions", () => {
    expect(resolveJourneyState("cancelled")).toMatchObject({ motion: "none", isLive: false });
    expect(resolveJourneyState("expired")).toMatchObject({ motion: "none", isLive: false });
  });

  it("shows a starting pulse for draft and pending acknowledgement", () => {
    expect(resolveJourneyState("draft").key).toBe("starting");
    expect(resolveJourneyState("pending_acknowledgement").motion).toBe("active");
  });

  it("never returns any location, distance, or route wording in the status", () => {
    const statuses = [
      "draft",
      "pending_acknowledgement",
      "active",
      "grace_period",
      "extended",
      "unconfirmed",
      "completed",
      "cancelled",
      "expired"
    ] as const;
    for (const status of statuses) {
      const label = resolveJourneyState(status).status.toLowerCase();
      expect(label).not.toMatch(/\bkm\b|metre|meter|mile|coordinate|latitude|longitude|street|route|distance|speed|map/);
    }
  });
});

describe("watcherSummary", () => {
  it("reassures when nobody has accepted yet", () => {
    expect(watcherSummary([], 0)).toBe("Your approved contacts can view your journey status.");
  });

  it("uses the safe shared-with wording when only a count is known", () => {
    expect(watcherSummary([], 3)).toBe("Shared with 3 approved Muddies.");
    expect(watcherSummary([], 1)).toBe("Shared with 1 approved Muddy.");
  });

  it("names one or two watchers, then falls back to a count", () => {
    expect(watcherSummary(["Ama"], 1)).toBe("Ama is watching your journey");
    expect(watcherSummary(["Ama", "Kojo"], 2)).toBe("Ama and Kojo are watching your journey");
    expect(watcherSummary(["Ama", "Kojo", "Efua"], 3)).toBe("3 approved Muddies are watching your journey");
  });

  it("never says 'monitoring'", () => {
    for (const copy of [watcherSummary([], 2), watcherSummary(["Ama"], 1), watcherSummary(["A", "B", "C"], 3)]) {
      expect(copy.toLowerCase()).not.toContain("monitor");
    }
  });
});
