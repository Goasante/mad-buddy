import { describe, expect, it } from "vitest";
import {
  eligibleQuickActions,
  isCoordinationContext,
  meetingPhase,
  NEAR_START_WINDOW_MS
} from "@/lib/messaging/quick-action-eligibility";

/**
 * "I'm here" must mean you are there.
 *
 * THE REPORTED DEFECT. The composer rendered QUICK_ACTIONS.slice(0, 3) --
 * "I'm on my way", "I'm here", "Running late" -- in every conversation,
 * always. So a Plan Chat offered arrival language days before the plan, and a
 * plain direct message offered it with no meeting in existence at all.
 */

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-08-14T20:00:00.000Z");
const ALL = ["on_my_way", "im_here", "running_late", "where_to_meet", "cant_make_it", "start_without_me"];

const actionsFor = (context: Parameters<typeof eligibleQuickActions>[0]["context"], phase: Parameters<typeof eligibleQuickActions>[0]["phase"]) =>
  eligibleQuickActions({ context, phase, actionIds: ALL });

describe("phase from timing", () => {
  it("is upcoming when the meeting is days away", () => {
    expect(meetingPhase({ startsAtMs: NOW + 72 * HOUR }, NOW)).toBe("upcoming");
  });

  it("becomes near_start inside the arrival window", () => {
    expect(meetingPhase({ startsAtMs: NOW + 30 * 60 * 1000 }, NOW)).toBe("near_start");
  });

  it("is active once it has started", () => {
    expect(meetingPhase({ startsAtMs: NOW - 5 * 60 * 1000 }, NOW)).toBe("active");
  });

  it("stays active until its end time, not its start time", () => {
    // A plan running 19:00-23:00 is still on at 20:00.
    expect(meetingPhase({ startsAtMs: NOW - HOUR, endsAtMs: NOW + 3 * HOUR }, NOW)).toBe("active");
  });

  it("is ended after the end time", () => {
    expect(meetingPhase({ startsAtMs: NOW - 5 * HOUR, endsAtMs: NOW - HOUR }, NOW)).toBe("ended");
  });

  it("keeps an end-less meeting active rather than ending it instantly", () => {
    // Most plans carry no end time. Falling back to the start time marked them
    // ended the moment they began, so arrival actions appeared for one tick.
    expect(meetingPhase({ startsAtMs: NOW - 30 * 60 * 1000 }, NOW)).toBe("active");
  });

  it("eventually ends an end-less meeting", () => {
    // ...but not forever: "I'm here" must not still be offered next morning.
    expect(meetingPhase({ startsAtMs: NOW - 6 * HOUR }, NOW)).toBe("ended");
  });

  it("treats a cancelled meeting as ended whatever the clock says", () => {
    expect(meetingPhase({ startsAtMs: NOW + 72 * HOUR, cancelled: true }, NOW)).toBe("ended");
  });

  it("is undated when there is no start time", () => {
    expect(meetingPhase({ startsAtMs: null }, NOW)).toBe("undated");
  });

  it("uses the documented window boundary exactly", () => {
    expect(meetingPhase({ startsAtMs: NOW + NEAR_START_WINDOW_MS }, NOW)).toBe("near_start");
    expect(meetingPhase({ startsAtMs: NOW + NEAR_START_WINDOW_MS + 1 }, NOW)).toBe("upcoming");
  });
});

describe("a direct message is not a coordination surface", () => {
  it("offers no coordination actions at all", () => {
    // The most visible half of the bug: arrival language in an ordinary chat.
    expect(actionsFor("none", "undated")).toEqual([]);
  });

  it("offers none even if some phase were somehow supplied", () => {
    expect(actionsFor("none", "active")).toEqual([]);
  });

  it("recognises which contexts are about a meeting", () => {
    expect(isCoordinationContext("plan")).toBe(true);
    expect(isCoordinationContext("event")).toBe(true);
    expect(isCoordinationContext("none")).toBe(false);
  });
});

describe("arrival language waits for the meeting", () => {
  it("does NOT offer 'I'm here' days before a plan", () => {
    // The exact reported complaint.
    expect(actionsFor("plan", "upcoming")).not.toContain("im_here");
  });

  it("does not offer 'I'm on my way' days before either", () => {
    expect(actionsFor("plan", "upcoming")).not.toContain("on_my_way");
  });

  it("still allows logistics while a plan is being arranged", () => {
    // Something must remain, or an upcoming Plan Chat loses its quick actions.
    const upcoming = actionsFor("plan", "upcoming");
    expect(upcoming).toContain("where_to_meet");
    // No decline here: a Plan carries a canonical RSVP, and this chip only
    // sends a sentence. Attendance language lives on the Plan itself.
    expect(upcoming).not.toContain("cant_make_it");
  });

  it("offers travel intent once the meeting is close", () => {
    const near = actionsFor("plan", "near_start");
    expect(near).toContain("on_my_way");
    expect(near).toContain("running_late");
  });

  it("still withholds 'I'm here' until it has actually started", () => {
    expect(actionsFor("plan", "near_start")).not.toContain("im_here");
  });

  it("offers 'I'm here' only once the meeting is active", () => {
    expect(actionsFor("plan", "active")).toContain("im_here");
  });
});

describe("a finished meeting coordinates nothing", () => {
  it("offers no actions once ended", () => {
    expect(actionsFor("plan", "ended")).toEqual([]);
  });

  it("never offers arrival for a cancelled plan", () => {
    const phase = meetingPhase({ startsAtMs: NOW + HOUR, cancelled: true }, NOW);
    expect(actionsFor("plan", phase)).toEqual([]);
  });
});

describe("safety of the rule itself", () => {
  it("withholds an action that has no rule rather than showing it", () => {
    // A new id added to QUICK_ACTIONS must not inherit "always visible".
    expect(eligibleQuickActions({ context: "plan", phase: "active", actionIds: ["brand_new_action"] })).toEqual([]);
  });

  it("preserves the caller's ordering", () => {
    const ordered = eligibleQuickActions({
      context: "plan",
      phase: "active",
      actionIds: ["im_here", "on_my_way"]
    });
    expect(ordered).toEqual(["im_here", "on_my_way"]);
  });

  it("applies to Events and Circles built around an Event too", () => {
    expect(actionsFor("event", "active")).toContain("im_here");
    expect(actionsFor("event_circle", "active")).toContain("im_here");
  });
});
