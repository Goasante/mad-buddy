import { describe, expect, it } from "vitest";
import {
  archiveRetentionDaysFor,
  archivesAtMs,
  canManageMembers,
  canModerateEventCircle,
  canSendAnnouncement,
  canTransitionEventCircle,
  eventCircleMaxMembersFor,
  isEventCircleWritable,
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
