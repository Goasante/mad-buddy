import { describe, expect, it } from "vitest";

import {
  appearsInDiscover,
  resolveRelationshipState,
  type RelationshipInput
} from "@/lib/linkr/relationship-state";

/**
 * The Linkr state model, exercised as BEHAVIOUR.
 *
 * Every case below is a question the product asks at runtime -- "does this
 * person show up in the deck", "did a lapsed pass bring them back", "can a
 * mutual connection outrank a block" -- answered against real inputs rather
 * than by scanning source text. Time is injected, so a 30-day cooldown is
 * tested in milliseconds instead of waiting a month.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-25T12:00:00.000Z");

const input = (overrides: Partial<RelationshipInput> = {}): RelationshipInput => ({
  viewerAction: null,
  hasActiveConnection: false,
  blockedEitherDirection: false,
  otherEligible: true,
  now: NOW,
  ...overrides
});

describe("the ordinary path", () => {
  it("somebody undecided is UNSEEN and appears in Discover", () => {
    const state = resolveRelationshipState(input());
    expect(state).toBe("UNSEEN");
    expect(appearsInDiscover(state)).toBe(true);
  });

  it("a pass suppresses them", () => {
    const state = resolveRelationshipState(
      input({
        viewerAction: {
          action: "pass",
          expiresAt: new Date(NOW + 30 * DAY).toISOString(),
          createdAt: new Date(NOW).toISOString()
        }
      })
    );
    expect(state).toBe("PASSED");
    expect(appearsInDiscover(state)).toBe(false);
  });

  it("a connect is PENDING_CONNECT and leaves the deck", () => {
    const state = resolveRelationshipState(
      input({
        viewerAction: { action: "connect", expiresAt: null, createdAt: new Date(NOW).toISOString() }
      })
    );
    expect(state).toBe("PENDING_CONNECT");
    expect(appearsInDiscover(state)).toBe(false);
  });
});

describe("pass cooldown recycling", () => {
  const passedAt = NOW - 31 * DAY;

  it("a pass still inside its window keeps suppressing", () => {
    const state = resolveRelationshipState(
      input({
        viewerAction: {
          action: "pass",
          expiresAt: new Date(NOW + DAY).toISOString(),
          createdAt: new Date(passedAt).toISOString()
        }
      })
    );
    expect(state).toBe("PASSED");
  });

  it("a LAPSED pass returns them to Discover rather than erasing them", () => {
    const state = resolveRelationshipState(
      input({
        viewerAction: {
          action: "pass",
          // Expired one day ago.
          expiresAt: new Date(NOW - DAY).toISOString(),
          createdAt: new Date(passedAt).toISOString()
        }
      })
    );
    expect(state).toBe("UNSEEN");
    expect(appearsInDiscover(state)).toBe(true);
  });

  it("an explicit hide (no expiry) never lapses", () => {
    const state = resolveRelationshipState(
      input({
        viewerAction: {
          action: "pass",
          expiresAt: null,
          createdAt: new Date(NOW - 3650 * DAY).toISOString()
        }
      })
    );
    expect(state).toBe("PASSED");
    expect(appearsInDiscover(state)).toBe(false);
  });

  it("lapsing is decided at the boundary, not approximately", () => {
    const exactly = new Date(NOW).toISOString();
    expect(resolveRelationshipState(
      input({ viewerAction: { action: "pass", expiresAt: exactly, createdAt: exactly } })
    )).toBe("UNSEEN");
  });
});

describe("blocks and eligibility beat everything", () => {
  it("a block hides an otherwise unseen person", () => {
    expect(resolveRelationshipState(input({ blockedEitherDirection: true }))).toBe(
      "BLOCKED_OR_INELIGIBLE"
    );
  });

  it("a block outranks a MUTUAL CONNECTION", () => {
    // The important one: matching somebody must never buy a route past a
    // block they placed afterwards.
    const state = resolveRelationshipState(
      input({ hasActiveConnection: true, blockedEitherDirection: true })
    );
    expect(state).toBe("BLOCKED_OR_INELIGIBLE");
    expect(state).not.toBe("MUTUAL_CLICKED");
  });

  it("a block outranks pending interest", () => {
    expect(
      resolveRelationshipState(
        input({
          blockedEitherDirection: true,
          viewerAction: { action: "connect", expiresAt: null, createdAt: new Date(NOW).toISOString() }
        })
      )
    ).toBe("BLOCKED_OR_INELIGIBLE");
  });

  it("an ineligible person never reaches the deck", () => {
    expect(resolveRelationshipState(input({ otherEligible: false }))).toBe(
      "BLOCKED_OR_INELIGIBLE"
    );
    expect(appearsInDiscover("BLOCKED_OR_INELIGIBLE")).toBe(false);
  });

  it("an existing connection survives the other person merely going quiet", () => {
    // Turning Linkr off is not a block: the pair stay connected and reachable
    // in Clicked rather than the relationship silently evaporating.
    expect(
      resolveRelationshipState(input({ hasActiveConnection: true, otherEligible: false }))
    ).toBe("MUTUAL_CLICKED");
  });
});

describe("mutual people leave the deck but not the product", () => {
  it("a connection is MUTUAL_CLICKED", () => {
    expect(resolveRelationshipState(input({ hasActiveConnection: true }))).toBe("MUTUAL_CLICKED");
  });

  it("and never returns as an ordinary candidate", () => {
    expect(appearsInDiscover("MUTUAL_CLICKED")).toBe(false);
  });
});
