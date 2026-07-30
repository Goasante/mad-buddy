import { describe, expect, it } from "vitest";
import { contactStatusLine, resolveJourneyState } from "@/lib/safety/journey-status";

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

describe("contactStatusLine", () => {
  it("says nobody is on the journey when there are no contacts", () => {
    expect(contactStatusLine({ acceptedCount: 0, invitedCount: 0 })).toBe("No Safe Arrival contacts on this journey.");
  });

  it("reports invitations as waiting, never as cover", () => {
    const line = contactStatusLine({ acceptedCount: 0, invitedCount: 3 });
    expect(line).toBe("Waiting on 3 invitations.");
    expect(contactStatusLine({ acceptedCount: 0, invitedCount: 1 })).toBe("Waiting on 1 invitation.");
    // The count must not be presented as anyone actually checking in.
    expect(line.toLowerCase()).not.toContain("checking in");
    expect(line.toLowerCase()).not.toContain("confirmed");
  });

  it("counts ONLY accepted contacts as confirmed", () => {
    // The reported bug: 3 invited, 2 accepted must never read as 3.
    expect(contactStatusLine({ acceptedCount: 2, invitedCount: 1 })).toBe("2 confirmed · 1 awaiting response");
    expect(contactStatusLine({ acceptedCount: 2, invitedCount: 1 })).not.toContain("3");
  });

  it("drops the awaiting clause once everyone has answered", () => {
    expect(contactStatusLine({ acceptedCount: 3, invitedCount: 0 })).toBe("3 confirmed");
  });

  it("never uses surveillance wording", () => {
    const lines = [
      contactStatusLine({ acceptedCount: 0, invitedCount: 2 }),
      contactStatusLine({ acceptedCount: 1, invitedCount: 1 }),
      contactStatusLine({ acceptedCount: 3, invitedCount: 0 })
    ];
    for (const line of lines) {
      const lower = line.toLowerCase();
      for (const word of ["monitor", "watching", "watch over", "tracking"]) {
        expect(lower).not.toContain(word);
      }
    }
  });
});
