import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planAttendancePairs } from "@/lib/life/plan-attendance";
import { buildLifeEvent, LIFE_EVENT_CLASSIFICATION } from "@/lib/life/events";
import { buildTimeline, timelineFacts, type TimelineSourceRow } from "@/lib/life/timeline";
import { stripComments } from "@/lib/content/strip-comments";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CARA = "33333333-3333-4333-8333-333333333333";
const AT = "2026-08-01T18:00:00.000Z";

describe("planAttendancePairs", () => {
  it("turns a group into one fact per relationship", () => {
    const pairs = planAttendancePairs(
      [
        { planId: "plan-1", userId: ALICE },
        { planId: "plan-1", userId: BOB },
        { planId: "plan-1", userId: CARA }
      ],
      AT
    );
    // Three attendees are three relationships, not one group event.
    expect(pairs).toHaveLength(3);
    expect(pairs.every((pair) => pair.eventType === "plan.attended_together")).toBe(true);
  });

  it("is order-independent, so a replay cannot double-record", () => {
    const forward = planAttendancePairs(
      [
        { planId: "plan-1", userId: ALICE },
        { planId: "plan-1", userId: BOB }
      ],
      AT
    );
    const reversed = planAttendancePairs(
      [
        { planId: "plan-1", userId: BOB },
        { planId: "plan-1", userId: ALICE }
      ],
      AT
    );
    expect(buildLifeEvent(forward[0]!).dedupeKey).toBe(buildLifeEvent(reversed[0]!).dedupeKey);
  });

  it("emits nothing for a plan only one person attended", () => {
    expect(planAttendancePairs([{ planId: "plan-1", userId: ALICE }], AT)).toEqual([]);
  });

  it("does not pair attendees across different plans", () => {
    const pairs = planAttendancePairs(
      [
        { planId: "plan-1", userId: ALICE },
        { planId: "plan-2", userId: BOB }
      ],
      AT
    );
    expect(pairs).toEqual([]);
  });

  it("skips oversized plans whole rather than partially", () => {
    // 200 attendees is 19,900 pairs — a job hazard, not a timeline. A partial
    // set would be arbitrary, and arbitrary history is worse than none.
    const many = Array.from({ length: 40 }, (_, index) => ({ planId: "big", userId: `user-${index}` }));
    expect(planAttendancePairs(many, AT)).toEqual([]);
  });

  it("dedupes a user passed twice", () => {
    const pairs = planAttendancePairs(
      [
        { planId: "plan-1", userId: ALICE },
        { planId: "plan-1", userId: ALICE },
        { planId: "plan-1", userId: BOB }
      ],
      AT
    );
    expect(pairs).toHaveLength(1);
  });

  it("carries ids only — never a plan title or place", () => {
    const [pair] = planAttendancePairs(
      [
        { planId: "plan-1", userId: ALICE },
        { planId: "plan-1", userId: BOB }
      ],
      AT
    );
    expect(Object.keys(pair!.payload ?? {})).toEqual(["planId"]);
  });

  it("uses the supplied time, not now", () => {
    const [pair] = planAttendancePairs(
      [
        { planId: "plan-1", userId: ALICE },
        { planId: "plan-1", userId: BOB }
      ],
      AT
    );
    expect(buildLifeEvent(pair!).occurredAt).toBe(AT);
  });
});

describe("plan attendance emission", () => {
  const handlers = stripComments(readFileSync(join(process.cwd(), "lib/jobs/handlers.ts"), "utf8"));

  it("is emitted from the job that completes plans", () => {
    // That job is the only thing that ever sets status = completed, so it is
    // the only place the fact becomes true.
    expect(handlers).toContain("planAttendancePairs");
  });

  it("counts only attendees who were going", () => {
    expect(handlers).toContain('.eq("rsvp_status", "going")');
  });

  it("is shared, since both people were there", () => {
    expect(LIFE_EVENT_CLASSIFICATION["plan.attended_together"].visibility).toBe("shared");
  });

  it("is not AI-readable", () => {
    expect(LIFE_EVENT_CLASSIFICATION["plan.attended_together"].aiEligible).toBe(false);
  });
});

describe("relationship.reactivated", () => {
  const source = readFileSync(join(process.cwd(), "lib/life/events.ts"), "utf8");

  it("is declared in the contract", () => {
    expect(LIFE_EVENT_CLASSIFICATION["relationship.reactivated"]).toBeDefined();
  });

  it("is shared and not AI-readable, like relationship.created", () => {
    expect(LIFE_EVENT_CLASSIFICATION["relationship.reactivated"]).toEqual(
      LIFE_EVENT_CLASSIFICATION["relationship.created"]
    );
  });

  it("is declared but nothing emits it yet", () => {
    // Reactivation itself is a later phase. Declaring the type early keeps the
    // contract stable; emitting it early would record a fact that has no
    // source of truth behind it.
    const emitters = ["lib/life/emit.ts", "lib/life/rebuild.ts", "lib/jobs/handlers.ts"];
    for (const file of emitters) {
      const body = stripComments(readFileSync(join(process.cwd(), file), "utf8"));
      expect(body, `${file} must not emit relationship.reactivated yet`).not.toContain(
        "relationship.reactivated"
      );
    }
    // The declaration itself lives in the contract, which is the one place it
    // is allowed to appear.
    expect(source).toContain("relationship.reactivated");
  });

  it("clears endedAt in the projection when it follows an ending", () => {
    const rows: TimelineSourceRow[] = [
      { eventType: "relationship.created", actorId: ALICE, occurredAt: "2026-01-01T00:00:00.000Z", payload: { subjectId: BOB } },
      { eventType: "relationship.ended", actorId: ALICE, occurredAt: "2026-02-01T00:00:00.000Z", payload: { subjectId: BOB } },
      { eventType: "relationship.reactivated", actorId: ALICE, occurredAt: "2026-03-01T00:00:00.000Z", payload: { subjectId: BOB } }
    ];
    const facts = timelineFacts(buildTimeline(rows, ALICE).entries);
    expect(facts.endedAtMs).toBeNull();
    expect(facts.reactivatedAtMs).not.toBeNull();
  });

  it("still reports ended when the ending is the later event", () => {
    const rows: TimelineSourceRow[] = [
      { eventType: "relationship.reactivated", actorId: ALICE, occurredAt: "2026-03-01T00:00:00.000Z", payload: { subjectId: BOB } },
      { eventType: "relationship.ended", actorId: ALICE, occurredAt: "2026-04-01T00:00:00.000Z", payload: { subjectId: BOB } }
    ];
    expect(timelineFacts(buildTimeline(rows, ALICE).entries).endedAtMs).not.toBeNull();
  });
});
