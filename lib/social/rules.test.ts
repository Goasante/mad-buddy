import { describe, expect, it } from "vitest";
import {
  STATUS_MAX_DURATION_MS,
  WAVE_PAIR_COOLDOWN_MS,
  canTransitionPing,
  canViewStatus,
  isPingExpired,
  isStatusActive,
  pingActorAllowed,
  pingExpiryMs,
  responseTypeToStatus,
  validateStatusExpiry,
  wavePairCooldownRemaining
} from "@/lib/social/rules";

const NOW = Date.parse("2026-07-16T12:00:00.000Z");

// ---------------------------------------------------------------------------
// Status rules
// ---------------------------------------------------------------------------

describe("validateStatusExpiry", () => {
  it("rejects past, invalid, and over-long expiries", () => {
    expect(validateStatusExpiry(NOW - 1000, NOW)).toMatch(/future/);
    expect(validateStatusExpiry(Number.NaN, NOW)).toMatch(/valid/);
    expect(validateStatusExpiry(NOW + STATUS_MAX_DURATION_MS + 60_000, NOW)).toMatch(/24 hours/);
  });

  it("accepts a normal 2-hour expiry", () => {
    expect(validateStatusExpiry(NOW + 2 * 60 * 60 * 1000, NOW)).toBeNull();
  });
});

describe("status visibility (privacy floor)", () => {
  const base = {
    areMutualMuddies: true,
    isBlockedEitherDirection: false,
    ownerVisibilityStatus: "visible" as const,
    statusExpiresAtMs: NOW + 60_000,
    nowMs: NOW
  };

  it("allows a mutual, unblocked, visible, unexpired status", () => {
    expect(canViewStatus(base)).toBe(true);
  });

  it("denies non-Muddies — no status ever leaks outside approved friendships", () => {
    expect(canViewStatus({ ...base, areMutualMuddies: false })).toBe(false);
  });

  it("denies when blocked in either direction", () => {
    expect(canViewStatus({ ...base, isBlockedEitherDirection: true })).toBe(false);
  });

  it("hides status under Ghost Mode by default (spec §7)", () => {
    expect(canViewStatus({ ...base, ownerVisibilityStatus: "ghost" })).toBe(false);
  });

  it("denies expired statuses", () => {
    expect(canViewStatus({ ...base, statusExpiresAtMs: NOW - 1 })).toBe(false);
    expect(isStatusActive({ expires_at: new Date(NOW - 1).toISOString() }, NOW)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Wave rules
// ---------------------------------------------------------------------------

describe("wavePairCooldownRemaining", () => {
  it("is zero when the pair has never waved", () => {
    expect(wavePairCooldownRemaining(null, NOW)).toBe(0);
  });

  it("enforces the 30-minute pair cooldown", () => {
    const tenMinutesAgo = NOW - 10 * 60 * 1000;
    const remaining = wavePairCooldownRemaining(tenMinutesAgo, NOW);
    expect(remaining).toBe(WAVE_PAIR_COOLDOWN_MS - 10 * 60 * 1000);
  });

  it("clears exactly at the boundary", () => {
    expect(wavePairCooldownRemaining(NOW - WAVE_PAIR_COOLDOWN_MS, NOW)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Ping state machine
// ---------------------------------------------------------------------------

describe("canTransitionPing", () => {
  it("allows every documented valid transition (spec §36)", () => {
    const valid: Array<[string, string]> = [
      ["pending", "seen"],
      ["pending", "accepted"],
      ["pending", "declined"],
      ["pending", "maybe"],
      ["pending", "cancelled"],
      ["pending", "expired"],
      ["maybe", "accepted"],
      ["maybe", "declined"],
      ["maybe", "counter_proposed"],
      ["counter_proposed", "accepted"],
      ["accepted", "completed"],
      ["accepted", "cancelled"]
    ];
    for (const [from, to] of valid) {
      expect(canTransitionPing(from as never, to as never), `${from} -> ${to}`).toBe(true);
    }
  });

  it("rejects transitions out of terminal states", () => {
    for (const terminal of ["declined", "cancelled", "expired", "completed"] as const) {
      for (const to of ["accepted", "pending", "maybe", "seen"] as const) {
        expect(canTransitionPing(terminal, to), `${terminal} -> ${to}`).toBe(false);
      }
    }
  });

  it("rejects double-acceptance", () => {
    expect(canTransitionPing("accepted", "accepted")).toBe(false);
  });
});

describe("pingActorAllowed", () => {
  it("only the recipient may decline, maybe, or counter-propose", () => {
    for (const transition of ["declined", "maybe", "counter_proposed"] as const) {
      expect(pingActorAllowed({ transition, actorIsSender: true, actorIsRecipient: false })).toBe(false);
      expect(pingActorAllowed({ transition, actorIsSender: false, actorIsRecipient: true })).toBe(true);
    }
  });

  it("only the sender may cancel", () => {
    expect(pingActorAllowed({ transition: "cancelled", actorIsSender: true, actorIsRecipient: false })).toBe(true);
    expect(pingActorAllowed({ transition: "cancelled", actorIsSender: false, actorIsRecipient: true })).toBe(false);
  });

  it("strangers may do nothing", () => {
    expect(pingActorAllowed({ transition: "accepted", actorIsSender: false, actorIsRecipient: false })).toBe(false);
  });
});

describe("pingExpiryMs (spec §35)", () => {
  it("gives 'now' pings 20 minutes", () => {
    expect(pingExpiryMs(NOW, NOW)).toBe(NOW + 20 * 60 * 1000);
  });

  it("gives 30-minute pings 45 minutes", () => {
    expect(pingExpiryMs(NOW + 30 * 60 * 1000, NOW)).toBe(NOW + 45 * 60 * 1000);
  });

  it("expires later-today pings at the proposed time", () => {
    const tonight = NOW + 6 * 60 * 60 * 1000;
    expect(pingExpiryMs(tonight, NOW)).toBe(tonight);
  });
});

describe("isPingExpired", () => {
  it("marks overdue open pings as expired", () => {
    expect(
      isPingExpired({ expires_at: new Date(NOW - 1000).toISOString(), status: "pending" }, NOW)
    ).toBe(true);
  });

  it("never re-expires settled pings — an accepted plan survives its ping window", () => {
    expect(
      isPingExpired({ expires_at: new Date(NOW - 1000).toISOString(), status: "accepted" }, NOW)
    ).toBe(false);
  });
});

describe("responseTypeToStatus", () => {
  it("maps every response type", () => {
    expect(responseTypeToStatus("accept")).toBe("accepted");
    expect(responseTypeToStatus("maybe")).toBe("maybe");
    expect(responseTypeToStatus("decline")).toBe("declined");
    expect(responseTypeToStatus("counter_propose")).toBe("counter_proposed");
    expect(responseTypeToStatus("message")).toBeNull();
  });
});
