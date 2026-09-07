import { describe, expect, it } from "vitest";

import {
  type EventParticipationView,
  explainEventAccess,
  explainSafeArrival,
  findStalledSafeArrival,
  isSafeArrivalLive,
  type SafeArrivalView,
  verifySafeArrivalClosure
} from "@/lib/admin/event-safety-diagnostics";

/**
 * Safe Arrival is the strictest surface in the product, so a large share of
 * these cases are about what Admin must NOT do or say: never close an
 * unconfirmed arrival, never accept a watch on somebody's behalf, never imply a
 * person is safe, and never let a journey detail reach an operator's screen.
 */

const journey = (overrides: Partial<SafeArrivalView> = {}): SafeArrivalView => ({
  sessionId: "session-1",
  status: "active",
  pastExpectedArrival: false,
  pastGracePeriod: false,
  acknowledgedWatcherCount: 1,
  pendingWatcherCount: 0,
  ...overrides
});

const event = (overrides: Partial<EventParticipationView> = {}): EventParticipationView => ({
  eventId: "event-1",
  eventStatus: "active",
  rsvp: "going",
  circleExists: true,
  joinedCircle: true,
  inviteOnly: false,
  invited: false,
  ...overrides
});

describe("an unconfirmed arrival is a safety signal, never a stuck record", () => {
  it("is refused as a product rule, not offered as a repair", () => {
    const result = explainSafeArrival(journey({ status: "unconfirmed", pastGracePeriod: true }));

    expect(result.outcome).toBe("blocked_by_product_rule");
    expect(result.summary).toMatch(/must not close it/i);
    expect(result.summary).toMatch(/escalate/i);
  });

  it("is excluded from the stalled-journey sweep entirely", () => {
    /* The most important line in the module: closing these would erase a
       safety signal somebody may still be acting on. */
    expect(findStalledSafeArrival([journey({ status: "unconfirmed", pastGracePeriod: true })])).toEqual([]);
  });
});

describe("a journey stalled past its grace period is real drift", () => {
  it("finds an active journey past grace", () => {
    const found = findStalledSafeArrival([journey({ pastExpectedArrival: true, pastGracePeriod: true })]);

    expect(found).toHaveLength(1);
    expect(found[0].repairable).toBe(true);
  });

  it("finds extended and grace_period journeys too", () => {
    for (const status of ["extended", "grace_period"] as const) {
      expect(findStalledSafeArrival([journey({ status, pastGracePeriod: true })])).toHaveLength(1);
    }
  });

  it("leaves a journey still within its grace period alone", () => {
    expect(findStalledSafeArrival([journey({ pastExpectedArrival: true, pastGracePeriod: false })])).toEqual([]);
  });

  it("leaves journeys that already ended properly alone", () => {
    for (const status of ["completed", "cancelled", "expired"] as const) {
      expect(findStalledSafeArrival([journey({ status, pastGracePeriod: true })])).toEqual([]);
    }
  });
});

describe("nobody can be made to watch", () => {
  it("an unanswered watch request is explained, not repaired", () => {
    const result = explainSafeArrival(
      journey({ status: "pending_acknowledgement", acknowledgedWatcherCount: 0, pendingWatcherCount: 2 })
    );

    expect(result.outcome).toBe("blocked_by_product_rule");
    expect(result.summary).toMatch(/cannot accept on their behalf/i);
  });
});

describe("no journey detail reaches the operator", () => {
  it("nothing the module can say carries a destination, route or time", () => {
    /* The view has no such fields, so this is really a guard against a future
       edit adding one and quietly widening what Support can see. */
    const outputs = [
      explainSafeArrival(journey()),
      explainSafeArrival(journey({ status: "unconfirmed" })),
      explainSafeArrival(journey({ status: "completed" })),
      explainSafeArrival(journey({ pastGracePeriod: true })),
      explainSafeArrival(journey({ status: "pending_acknowledgement", acknowledgedWatcherCount: 0 })),
      verifySafeArrivalClosure({ attempted: 1, stillLive: 0 }),
      ...findStalledSafeArrival([journey({ pastGracePeriod: true })])
    ].map((r) => ("summary" in r ? r.summary : r.explanation));

    for (const text of outputs) {
      expect(text).not.toMatch(/destination|address|route|coordinate|latitude|longitude|postcode|km|miles/i);
    }
  });

  it("the view type cannot carry any sensitive journey column", () => {
    /* Checked against the real column names on safe_arrival_sessions rather
       than a remembered list, so adding a field to the view that happens to
       match one of them fails here instead of shipping. */
    const sensitive = [
      "destination_type",
      "destination_label",
      "destination_event_id",
      "expected_arrival_at",
      "grace_period_minutes",
      "note",
      "started_at",
      "confirmed_at",
      "unconfirmed_at"
    ];
    const view: SafeArrivalView = journey();
    const keys = Object.keys(view);
    for (const column of sensitive) {
      expect(keys).not.toContain(column);
      // Also reject the camelCase form a TypeScript author would reach for.
      expect(keys).not.toContain(column.replace(/_([a-z])/g, (_, c) => c.toUpperCase()));
    }
  });

  it("watcher identities are never named, only counted", () => {
    const view = journey({ acknowledgedWatcherCount: 3, pendingWatcherCount: 2 });
    expect(Object.keys(view)).not.toContain("watchers");
    expect(explainSafeArrival(view).summary).not.toMatch(/@|user-|watcher-/);
  });
});

describe("closing a journey corrects the record, and claims nothing more", () => {
  it("never implies the person is safe", () => {
    const result = verifySafeArrivalClosure({ attempted: 2, stillLive: 0 });

    expect(result.outcome).toBe("fixed");
    expect(result.summary).toMatch(/says nothing about whether the person arrived safely/i);
    expect(result.summary).toMatch(/no watcher alert was withdrawn/i);
  });

  it("reports still broken when a journey stays live", () => {
    expect(verifySafeArrivalClosure({ attempted: 2, stillLive: 1 }).outcome).toBe("still_broken");
  });

  it("reports nothing-to-do rather than success when there was no drift", () => {
    expect(verifySafeArrivalClosure({ attempted: 0, stillLive: 0 }).outcome).toBe("not_applicable");
  });
});

describe("safe arrival liveness", () => {
  it("counts every in-progress status as live", () => {
    for (const s of ["draft", "pending_acknowledgement", "active", "grace_period", "extended", "unconfirmed"] as const) {
      expect(isSafeArrivalLive(s)).toBe(true);
    }
  });

  it("and every finished one as not live", () => {
    for (const s of ["completed", "cancelled", "expired"] as const) expect(isSafeArrivalLive(s)).toBe(false);
  });
});

describe("why an account cannot reach an Event circle", () => {
  it("a finished or cancelled Event keeps its circle closed", () => {
    for (const eventStatus of ["ended", "cancelled"] as const) {
      expect(explainEventAccess(event({ eventStatus, joinedCircle: false })).outcome).toBe("blocked_by_product_rule");
    }
  });

  it("an invite-only Event without an invitation is the host's decision", () => {
    const result = explainEventAccess(event({ inviteOnly: true, invited: false, joinedCircle: false }));

    expect(result.outcome).toBe("blocked_by_product_rule");
    expect(result.summary).toMatch(/only the host can invite/i);
  });

  it("someone who is only interested is not in the circle yet", () => {
    expect(explainEventAccess(event({ rsvp: "interested", joinedCircle: false })).outcome).toBe(
      "blocked_by_product_rule"
    );
  });

  it("someone who answered no is out, and that is theirs to change", () => {
    const result = explainEventAccess(event({ rsvp: "not_going", joinedCircle: false }));

    expect(result.summary).toMatch(/theirs to do/i);
  });

  it("a missing circle on a live Event is nothing to repair", () => {
    expect(explainEventAccess(event({ circleExists: false, joinedCircle: false })).outcome).toBe("not_applicable");
  });

  it("someone going who is not joined IS a fault", () => {
    expect(explainEventAccess(event({ joinedCircle: false })).outcome).toBe("still_broken");
  });

  it("a joined attendee is healthy", () => {
    expect(explainEventAccess(event()).outcome).toBe("fixed");
  });

  it("an invited person who is going reaches the circle normally", () => {
    expect(explainEventAccess(event({ inviteOnly: true, invited: true })).outcome).toBe("fixed");
  });
});
