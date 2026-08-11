import { describe, expect, it } from "vitest";
import {
  archiveRetentionDaysFor,
  archivesAtMs,
  canManageMembers,
  canModerateEventCircle,
  canSendAnnouncement,
  canTransitionEventCircle,
  eventCircleMaxMembersFor,
  eventPhase,
  isCurrentEvent,
  isEventCircleWritable,
  isPastEvent,
  isUpcomingEvent,
  resolveCheckInWindow,
  resolveEventGlow,
  resolveJoinEventCircle,
  type EventGlowInput,
  type JoinCircleInput
} from "@/lib/events/rules";

const NOW = Date.parse("2026-07-16T20:00:00.000Z");
const MIN = 60 * 1000;

describe("check-in window (spec §25)", () => {
  const base = {
    eventStatus: "scheduled" as const,
    startsAtMs: NOW,
    endsAtMs: NOW + 3 * 60 * MIN,
    opensMinutesBefore: 60,
    nowMs: NOW
  };

  it("allows check-in inside the window", () => {
    expect(resolveCheckInWindow(base)).toEqual({ allowed: true, reason: "allowed" });
    expect(resolveCheckInWindow({ ...base, nowMs: NOW - 30 * MIN })).toEqual({ allowed: true, reason: "allowed" });
  });

  it("refuses check-in days in advance", () => {
    expect(resolveCheckInWindow({ ...base, nowMs: NOW - 24 * 60 * MIN })).toEqual({
      allowed: false,
      reason: "too_early"
    });
  });

  it("refuses after the event ends", () => {
    expect(resolveCheckInWindow({ ...base, nowMs: NOW + 4 * 60 * MIN }).allowed).toBe(false);
    expect(resolveCheckInWindow({ ...base, eventStatus: "ended" }).allowed).toBe(false);
  });

  it("refuses cancelled and draft events", () => {
    expect(resolveCheckInWindow({ ...base, eventStatus: "cancelled" })).toEqual({
      allowed: false,
      reason: "event_cancelled"
    });
  });
});

describe("Event Glow eligibility (spec §34, §37)", () => {
  function glow(overrides: Partial<EventGlowInput> = {}): EventGlowInput {
    return {
      viewerCheckedIn: true,
      targetCheckedIn: true,
      targetGlowEnabled: true,
      targetVisibility: "participants",
      areApprovedMuddies: true,
      isBlockedEitherDirection: false,
      targetGhostMode: false,
      eventActive: true,
      ...overrides
    };
  }

  it("shows an eligible checked-in Muddy", () => {
    expect(resolveEventGlow(glow())).toEqual({ visible: true, reason: "visible" });
  });

  it("requires the viewer to be present too, it answers 'who else is here'", () => {
    expect(resolveEventGlow(glow({ viewerCheckedIn: false })).reason).toBe("not_checked_in");
  });

  it("never activates from proximity alone, the target must have checked in", () => {
    expect(resolveEventGlow(glow({ targetCheckedIn: false })).reason).toBe("target_not_present");
  });

  it("Ghost Mode overrides Event Glow", () => {
    expect(resolveEventGlow(glow({ targetGhostMode: true })).reason).toBe("ghost_mode");
  });

  it("respects a disabled Glow and a private/anonymous check-in", () => {
    expect(resolveEventGlow(glow({ targetGlowEnabled: false })).reason).toBe("glow_disabled");
    expect(resolveEventGlow(glow({ targetVisibility: "private" })).reason).toBe("private_check_in");
    expect(resolveEventGlow(glow({ targetVisibility: "anonymous_count" })).reason).toBe("private_check_in");
  });

  it("blocks and non-Muddies never appear", () => {
    expect(resolveEventGlow(glow({ isBlockedEitherDirection: true })).reason).toBe("blocked");
    expect(resolveEventGlow(glow({ areApprovedMuddies: false })).reason).toBe("not_muddies");
  });

  it("ends when the event is no longer active", () => {
    expect(resolveEventGlow(glow({ eventActive: false })).reason).toBe("event_inactive");
  });
});

describe("event circle lifecycle + roles (spec §47, §49, §51)", () => {
  it("moves open→active→closing→archived and blocks revival", () => {
    expect(canTransitionEventCircle("open", "active")).toBe(true);
    expect(canTransitionEventCircle("closing", "archived")).toBe(true);
    expect(canTransitionEventCircle("archived", "open")).toBe(false);
    expect(canTransitionEventCircle("deleted", "open")).toBe(false);
  });

  it("makes content read-only once closing/archived", () => {
    expect(isEventCircleWritable("active")).toBe(true);
    expect(isEventCircleWritable("closing")).toBe(false);
    expect(isEventCircleWritable("archived")).toBe(false);
  });

  it("scopes moderation and announcements by role", () => {
    expect(canModerateEventCircle("moderator")).toBe(true);
    expect(canModerateEventCircle("member")).toBe(false);
    expect(canSendAnnouncement("moderator")).toBe(false);
    expect(canSendAnnouncement("host")).toBe(true);
    expect(canManageMembers("co_host")).toBe(true);
  });

  it("uses tier archive retention and capacity", () => {
    expect(archiveRetentionDaysFor("free")).toBe(7);
    expect(archiveRetentionDaysFor("buddy_plus")).toBe(30);
    expect(archivesAtMs(NOW, "free")).toBe(NOW + 7 * 24 * 60 * MIN);
    expect(eventCircleMaxMembersFor("free")).toBe(50);
    expect(eventCircleMaxMembersFor("buddy_pro")).toBe(5000);
  });
});

describe("join event circle (spec §48, §57)", () => {
  function join(overrides: Partial<JoinCircleInput> = {}): JoinCircleInput {
    return {
      status: "open",
      joinMode: "invite",
      memberStatus: null,
      memberCount: 0,
      maxMembers: 50,
      hasEventCheckIn: false,
      hasValidToken: true,
      opensAtMs: null,
      nowMs: NOW,
      ...overrides
    };
  }

  it("allows a valid invited join", () => {
    expect(resolveJoinEventCircle(join())).toEqual({ allowed: true, reason: "allowed" });
  });

  it("never lets a banned user rejoin", () => {
    expect(resolveJoinEventCircle(join({ memberStatus: "banned", hasValidToken: true }))).toEqual({
      allowed: false,
      reason: "banned"
    });
  });

  it("refuses a closed or not-yet-open circle", () => {
    expect(resolveJoinEventCircle(join({ status: "archived" })).reason).toBe("closed");
    expect(resolveJoinEventCircle(join({ opensAtMs: NOW + MIN })).reason).toBe("not_open_yet");
  });

  it("enforces capacity", () => {
    expect(resolveJoinEventCircle(join({ memberCount: 50, maxMembers: 50 })).reason).toBe("full");
  });

  it("requires a check-in for check_in mode and a token for qr/invite", () => {
    expect(resolveJoinEventCircle(join({ joinMode: "check_in", hasEventCheckIn: false })).reason).toBe(
      "needs_check_in"
    );
    expect(resolveJoinEventCircle(join({ joinMode: "check_in", hasEventCheckIn: true })).allowed).toBe(true);
    expect(resolveJoinEventCircle(join({ joinMode: "qr", hasValidToken: false })).reason).toBe("needs_token");
  });

  it("lets a member who left rejoin", () => {
    expect(resolveJoinEventCircle(join({ memberStatus: "left" })).allowed).toBe(true);
    expect(resolveJoinEventCircle(join({ memberStatus: "joined" })).reason).toBe("already_joined");
  });
});

/**
 * eventPhase (Plans + Events lifecycle, Stage C).
 *
 * NO FALLBACK DURATION IS TESTED, deliberately: events.ends_at is NOT NULL
 * with an ends_at > starts_at check constraint, and a production audit before
 * this was written found zero events with a null end. There is no code path
 * for a missing end time to exercise.
 */
describe("eventPhase (Plans + Events lifecycle, Stage C)", () => {
  const timing = { startsAtMs: NOW, endsAtMs: NOW + 3 * 60 * MIN };

  it("is upcoming strictly before the start", () => {
    expect(eventPhase(timing, NOW - 1)).toBe("upcoming");
    expect(eventPhase(timing, NOW - MIN)).toBe("upcoming");
    expect(isUpcomingEvent(timing, NOW - 1)).toBe(true);
  });

  it("is live at the exact start instant", () => {
    // Closed on the live side: the event has begun the moment now === start.
    expect(eventPhase(timing, NOW)).toBe("live");
  });

  it("is live throughout the middle", () => {
    expect(eventPhase(timing, NOW + 90 * MIN)).toBe("live");
  });

  it("is past at the exact end instant", () => {
    // Open on the live side, closed on the past side: the event has finished
    // the moment now === end, mirroring how a start-only Plan becomes past
    // the instant it begins (lib/social/plans.ts planPhase).
    expect(eventPhase(timing, timing.endsAtMs)).toBe("past");
  });

  it("is past strictly after the end", () => {
    expect(eventPhase(timing, timing.endsAtMs + 1)).toBe("past");
    expect(isPastEvent(timing, timing.endsAtMs + MIN)).toBe(true);
  });

  it("is exact at one millisecond either side of both boundaries", () => {
    expect(eventPhase(timing, NOW - 1)).toBe("upcoming");
    expect(eventPhase(timing, NOW)).toBe("live");
    expect(eventPhase(timing, timing.endsAtMs - 1)).toBe("live");
    expect(eventPhase(timing, timing.endsAtMs)).toBe("past");
  });

  it("treats upcoming and live as current; past as not", () => {
    expect(isCurrentEvent(timing, NOW - MIN)).toBe(true);
    expect(isCurrentEvent(timing, NOW + 90 * MIN)).toBe(true);
    expect(isCurrentEvent(timing, timing.endsAtMs)).toBe(false);
  });

  it("compares absolute instants, so every timezone offset agrees", () => {
    // The same moment written three ways must resolve identically -- the
    // same guarantee planPhase's timezone tests establish for Plans, applied
    // here because eventPhase makes the identical claim about starts_at/
    // ends_at being real UTC instants regardless of how a client formatted
    // them.
    const sameStart = [
      "2026-07-16T20:00:00.000Z",
      "2026-07-16T21:00:00.000+01:00",
      "2026-07-16T13:00:00.000-07:00"
    ];
    for (const startsAt of sameStart) {
      const t = { startsAtMs: Date.parse(startsAt), endsAtMs: Date.parse(startsAt) + 60 * MIN };
      expect(eventPhase(t, Date.parse(startsAt)), startsAt).toBe("live");
    }
  });

  it("does not use the local calendar day to decide", () => {
    // An event at 00:30 UTC is upcoming at 23:00 UTC the day before, even
    // though that instant falls on "tomorrow" locally west of Greenwich --
    // phase is about the instant, never a display-day concern.
    const dayBefore = Date.parse("2026-07-16T23:00:00.000Z");
    const t = {
      startsAtMs: Date.parse("2026-07-17T00:30:00.000Z"),
      endsAtMs: Date.parse("2026-07-17T02:30:00.000Z")
    };
    expect(eventPhase(t, dayBefore)).toBe("upcoming");
  });

  it("rolls over a date boundary the same way in every direction", () => {
    // An event spanning midnight UTC: still live one minute before the
    // rollover and one minute after.
    const spansMidnight = {
      startsAtMs: Date.parse("2026-07-16T23:30:00.000Z"),
      endsAtMs: Date.parse("2026-07-17T00:30:00.000Z")
    };
    expect(eventPhase(spansMidnight, Date.parse("2026-07-16T23:59:00.000Z"))).toBe("live");
    expect(eventPhase(spansMidnight, Date.parse("2026-07-17T00:01:00.000Z"))).toBe("live");
    expect(eventPhase(spansMidnight, Date.parse("2026-07-17T00:30:00.000Z"))).toBe("past");
  });
});
