import { describe, expect, it } from "vitest";

import {
  DEFAULT_PLAN_CHAT_CLOSE_DAYS,
  isPlanChatClosed,
  isPlanChatCloseDays,
  PLAN_CHAT_CLOSE_DAY_OPTIONS,
  PLAN_DEFAULT_ACTIVE_MS,
  planChatClosesAtMs,
  UNSCHEDULED_PLAN_GRACE_DAYS
} from "@/lib/social/plans";
import { planChatClosedNotice, planEndedLabel } from "@/lib/messaging/plan-chat-closure";

/**
 * THE CLOSURE RULE, in isolation.
 *
 * These pin the arithmetic and the edges. The database-backed suite proves the
 * enforcement; this proves the rule those enforcements read.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 29, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

const dated = (overrides: Record<string, unknown> = {}) => ({
  status: "confirmed" as const,
  startAt: iso(NOW - 5 * DAY),
  endAt: iso(NOW - 5 * DAY + 2 * 60 * 60 * 1000),
  createdAt: iso(NOW - 10 * DAY),
  ...overrides
});

describe("the offered windows", () => {
  it("offers exactly 1, 3, 7 and 14 days", () => {
    expect([...PLAN_CHAT_CLOSE_DAY_OPTIONS]).toEqual([1, 3, 7, 14]);
  });

  it("defaults to three days", () => {
    expect(DEFAULT_PLAN_CHAT_CLOSE_DAYS).toBe(3);
    expect(PLAN_CHAT_CLOSE_DAY_OPTIONS).toContain(DEFAULT_PLAN_CHAT_CLOSE_DAYS);
  });

  /* THE FORGERY GUARD, at the rule layer. Anything not in the list is refused
     before it can reach a database write. */
  it("refuses any window that was not offered", () => {
    for (const bad of [0, 2, 5, 15, 365, -3, 3.5, NaN, Infinity, "3", null, undefined, {}]) {
      expect(isPlanChatCloseDays(bad), `accepted ${String(bad)}`).toBe(false);
    }
    for (const good of PLAN_CHAT_CLOSE_DAY_OPTIONS) {
      expect(isPlanChatCloseDays(good)).toBe(true);
    }
  });
});

describe("a dated plan closes a window after it ends", () => {
  it("counts from end_at when the plan has one", () => {
    const endMs = NOW - 5 * DAY + 2 * 60 * 60 * 1000;
    expect(planChatClosesAtMs(dated({ closeDays: 3 }), NOW)).toBe(endMs + 3 * DAY);
  });

  it("honours each offered window", () => {
    const endMs = NOW - 5 * DAY + 2 * 60 * 60 * 1000;
    for (const days of PLAN_CHAT_CLOSE_DAY_OPTIONS) {
      expect(planChatClosesAtMs(dated({ closeDays: days }), NOW)).toBe(endMs + days * DAY);
    }
  });

  /* THE FALLBACK IS THE SHARED ONE. A start-only plan -- which is almost every
     plan in production -- must use the same 3h window planPhase uses, not a
     second duration invented here. */
  it("uses the canonical fallback end when the plan states no end", () => {
    const startMs = NOW - 5 * DAY;
    const plan = dated({ endAt: null, startAt: iso(startMs), closeDays: 3 });
    expect(planChatClosesAtMs(plan, NOW)).toBe(startMs + PLAN_DEFAULT_ACTIVE_MS + 3 * DAY);
  });

  it("falls back to the default window when none was chosen", () => {
    const withNone = planChatClosesAtMs(dated({ closeDays: null }), NOW);
    const withDefault = planChatClosesAtMs(dated({ closeDays: DEFAULT_PLAN_CHAT_CLOSE_DAYS }), NOW);
    expect(withNone).toBe(withDefault);
  });

  /* A FORGED VALUE THAT SOMEHOW REACHED STORAGE STILL CANNOT EXTEND ANYTHING.
     The rule ignores it and applies the default. */
  it("ignores a stored window that is not one of the four", () => {
    expect(planChatClosesAtMs(dated({ closeDays: 3650 }), NOW)).toBe(
      planChatClosesAtMs(dated({ closeDays: DEFAULT_PLAN_CHAT_CLOSE_DAYS }), NOW)
    );
  });
});

describe("closed or open", () => {
  it("is open right up to the close instant and closed at it", () => {
    const plan = dated({ closeDays: 3 });
    const closesAt = planChatClosesAtMs(plan, NOW)!;
    expect(isPlanChatClosed(plan, closesAt - 1)).toBe(false);
    expect(isPlanChatClosed(plan, closesAt)).toBe(true);
    expect(isPlanChatClosed(plan, closesAt + DAY)).toBe(true);
  });

  it("keeps a chat open while the plan is still ahead", () => {
    const ahead = dated({ startAt: iso(NOW + 2 * DAY), endAt: null, closeDays: 1 });
    expect(isPlanChatClosed(ahead, NOW)).toBe(false);
  });

  /* NEVER CLOSE ON A MISSING FIELD. An undated plan with no creation date has
     nothing to measure from, and the safe direction is to leave it open. */
  it("never closes a chat it cannot date", () => {
    const unknowable = { status: "inviting" as const, startAt: null, endAt: null, createdAt: null };
    expect(planChatClosesAtMs(unknowable, NOW)).toBeNull();
    expect(isPlanChatClosed(unknowable, NOW + 3650 * DAY)).toBe(false);
  });
});

describe("a cancelled plan closes its chat promptly", () => {
  const cancelledAt = iso(NOW - 60 * 1000);

  it("closes at the moment it was cancelled, not days later", () => {
    const plan = dated({ status: "cancelled", terminalAt: cancelledAt, closeDays: 14 });
    expect(planChatClosesAtMs(plan, NOW)).toBe(Date.parse(cancelledAt));
    expect(isPlanChatClosed(plan, NOW)).toBe(true);
  });

  /* THE WINDOW MUST NOT RESCUE A CANCELLED PLAN. Picking 14 days cannot keep
     the chat of a plan that will never happen open for a fortnight. */
  it("ignores the chosen window entirely", () => {
    for (const days of PLAN_CHAT_CLOSE_DAY_OPTIONS) {
      const plan = dated({ status: "cancelled", terminalAt: cancelledAt, closeDays: days });
      expect(isPlanChatClosed(plan, NOW)).toBe(true);
    }
  });

  it("treats an expired plan the same way", () => {
    const plan = dated({ status: "expired", terminalAt: cancelledAt, closeDays: 14 });
    expect(isPlanChatClosed(plan, NOW)).toBe(true);
  });

  /* COMPLETED IS DIFFERENT. The plan happened, so the window is the point --
     people are still talking about it. */
  it("still gives a completed plan its full window", () => {
    const endMs = NOW - 5 * DAY + 2 * 60 * 60 * 1000;
    const plan = dated({ status: "completed", terminalAt: iso(endMs), closeDays: 7 });
    expect(planChatClosesAtMs(plan, NOW)).toBe(endMs + 7 * DAY);
    expect(isPlanChatClosed(plan, NOW)).toBe(false);
  });
});

describe("an undated plan closes after its grace window", () => {
  const created = NOW - 10 * DAY;
  const undated = (closeDays: number) => ({
    status: "inviting" as const,
    startAt: null,
    endAt: null,
    createdAt: iso(created),
    closeDays
  });

  it("counts from the same deadline that sets the plan aside", () => {
    const deadline = created + UNSCHEDULED_PLAN_GRACE_DAYS * DAY;
    expect(planChatClosesAtMs(undated(3), NOW)).toBe(deadline + 3 * DAY);
  });

  it("is still open while inside the grace window", () => {
    expect(isPlanChatClosed(undated(3), NOW)).toBe(false);
  });
});

/* RESCHEDULING. There is no stored close instant, so moving the plan moves the
   closure. This is the property that made a derived time non-negotiable:
   confirmPollAction writes a poll winner into plans.start_at. */
describe("a rescheduled plan reschedules its own closure", () => {
  it("moves the close time when the start moves", () => {
    const before = planChatClosesAtMs(
      {
        status: "confirmed",
        startAt: iso(NOW - 5 * DAY),
        endAt: null,
        createdAt: iso(NOW - 10 * DAY),
        closeDays: 3
      },
      NOW
    )!;
    const after = planChatClosesAtMs(
      {
        status: "confirmed",
        startAt: iso(NOW + 5 * DAY),
        endAt: null,
        createdAt: iso(NOW - 10 * DAY),
        closeDays: 3
      },
      NOW
    )!;
    expect(after - before).toBe(10 * DAY);
  });

  it("reopens a chat that a poll pushed into the future", () => {
    const wasClosed = {
      status: "confirmed" as const,
      startAt: iso(NOW - 5 * DAY),
      endAt: null,
      createdAt: iso(NOW - 10 * DAY),
      closeDays: 1
    };
    expect(isPlanChatClosed(wasClosed, NOW)).toBe(true);
    const rescheduled = { ...wasClosed, startAt: iso(NOW + 5 * DAY) };
    expect(isPlanChatClosed(rescheduled, NOW)).toBe(false);
  });
});

describe("the closed-chat notice", () => {
  it("says closed, and names the day the plan ended", () => {
    const notice = planChatClosedNotice(iso(Date.UTC(2026, 7, 30, 19, 0, 0)));
    expect(notice.title).toBe("This Plan Chat is closed");
    expect(notice.detail).toBe("The plan ended on 30 Aug.");
  });

  /* NEVER READS AS BROKEN OR DELETED. The history is intact, and the words
     must not suggest otherwise. */
  it("never implies the messages are gone", () => {
    const notice = planChatClosedNotice(iso(NOW));
    const words = `${notice.title} ${notice.detail}`.toLowerCase();
    for (const alarming of ["deleted", "removed", "unavailable", "error", "went wrong"]) {
      expect(words, `the notice said "${alarming}"`).not.toContain(alarming);
    }
  });

  it("still stands as a sentence when the end date is unknown", () => {
    const notice = planChatClosedNotice(null);
    expect(notice.title).toBe("This Plan Chat is closed");
    expect(notice.detail).toBeNull();
  });

  it("ignores an unparseable date rather than printing rubbish", () => {
    expect(planEndedLabel("not a date")).toBeNull();
    expect(planChatClosedNotice("not a date").detail).toBeNull();
  });
});
