import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { eligibleQuickActions } from "@/lib/messaging/quick-action-eligibility";
import { planPhase, PLAN_NEAR_START_MS, PLAN_DEFAULT_ACTIVE_MS } from "@/lib/social/plans";

/**
 * "I'm here" appears when the plan is happening, and not before.
 *
 * The composer used to render QUICK_ACTIONS.slice(0, 3) everywhere, so arrival
 * language appeared in ordinary DMs and in Plan Chats days early. The first
 * fix gated on context but still passed a hardcoded "active" phase, because
 * the conversation projection carried no timing. It now carries the resolved
 * planPhase, so these assert the real end-to-end matrix.
 */

const NOW = Date.UTC(2026, 7, 14, 20, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const ALL = ["on_my_way", "im_here", "running_late", "where_to_meet", "cant_make_it", "start_without_me"];

/** Phase straight from the canonical Plan authority, as the server does. */
const phaseFor = (startOffset: number, endOffset?: number) =>
  planPhase(
    {
      status: "confirmed",
      startAt: iso(NOW + startOffset),
      endAt: endOffset === undefined ? null : iso(NOW + endOffset)
    },
    NOW
  );

const actions = (context: Parameters<typeof eligibleQuickActions>[0]["context"], phase: Parameters<typeof eligibleQuickActions>[0]["phase"]) =>
  eligibleQuickActions({ context, phase, actionIds: ALL });

describe("an ordinary DM offers no meeting actions", () => {
  it("offers nothing at all", () => {
    expect(actions("none", "active")).toEqual([]);
  });
});

describe("Plan Chat, upcoming", () => {
  const phase = phaseFor(3 * 24 * 60 * 60 * 1000); // three days out

  it("is upcoming", () => {
    expect(phase).toBe("upcoming");
  });

  it("offers logistics only", () => {
    // "cant_make_it" is withheld from Plan Chats: it would contradict the
    // RSVP it cannot change.
    expect(actions("plan", "upcoming").sort()).toEqual(["where_to_meet"]);
  });

  it("does NOT offer 'I'm here'", () => {
    expect(actions("plan", "upcoming")).not.toContain("im_here");
  });

  it("does NOT offer 'I'm on my way'", () => {
    expect(actions("plan", "upcoming")).not.toContain("on_my_way");
  });
});

describe("Plan Chat, near start", () => {
  const phase = phaseFor(30 * 60 * 1000); // thirty minutes away

  it("is near_start", () => {
    expect(phase).toBe("near_start");
  });

  it("offers travel intent as well as logistics", () => {
    const near = actions("plan", "near_start");
    expect(near).toContain("on_my_way");
    expect(near).toContain("running_late");
    expect(near).toContain("start_without_me");
    expect(near).toContain("where_to_meet");
    expect(near).not.toContain("cant_make_it");
  });

  it("still withholds 'I'm here' until it starts", () => {
    expect(actions("plan", "near_start")).not.toContain("im_here");
  });

  it("opens exactly 45 minutes before", () => {
    expect(phaseFor(PLAN_NEAR_START_MS)).toBe("near_start");
    expect(phaseFor(PLAN_NEAR_START_MS + 1)).toBe("upcoming");
  });
});

describe("Plan Chat, happening now", () => {
  it("is active just after the start", () => {
    expect(phaseFor(-60_000)).toBe("active");
  });

  it("offers 'I'm here'", () => {
    expect(actions("plan", "active")).toContain("im_here");
  });

  it("stays active for a plan with a real end time", () => {
    expect(phaseFor(-60 * 60 * 1000, 2 * 60 * 60 * 1000)).toBe("active");
  });

  it("stays active for the fallback window when no end time was given", () => {
    expect(phaseFor(-(PLAN_DEFAULT_ACTIVE_MS - 60_000))).toBe("active");
  });
});

describe("Plan Chat, finished", () => {
  it("is past once the end time passes", () => {
    expect(phaseFor(-3 * 60 * 60 * 1000, -60 * 60 * 1000)).toBe("past");
  });

  it("is past once the fallback window elapses", () => {
    expect(phaseFor(-(PLAN_DEFAULT_ACTIVE_MS + 60_000))).toBe("past");
  });

  it("offers no arrival or travel actions", () => {
    expect(actions("plan", "ended")).toEqual([]);
  });
});

describe("the projection carries real timing", () => {
  const mobile = stripComments(readFileSync("lib/messaging/mobile.ts", "utf8"));
  const page = stripComments(readFileSync("components/messages/messages-page.tsx", "utf8"));

  it("resolves the phase on the server from the canonical authority", () => {
    expect(mobile).toContain("planPhaseByPlanId");
    expect(mobile).toContain("planPhase(");
  });

  it("reads Plan timing only for conversations stored as Plan Chats", () => {
    // Not a guess from "has dates nearby": context_type is the stored
    // authority, so an Event or Circle can never be treated as a Plan.
    expect(mobile).toContain('conversation.context_type === "plan"');
  });

  it("no longer hardcodes a phase in the composer", () => {
    /* Asserts the DERIVATION, not the absence of one string.
     *
     * An earlier version of this test only checked that `phase: "active",` was
     * gone, which a mutation satisfied by writing
     * `const phase: MeetingPhase = "active";` instead -- the placeholder was
     * back, the test still passed. Requiring the phase to be computed from the
     * server's answer is what makes this bite. */
    const start = page.indexOf("const visibleQuickActions");
    const block = page.slice(start, page.indexOf("}, [selected]);", start));
    expect(block).toContain("selected?.planPhase ===");
    expect(block).not.toMatch(/const phase: MeetingPhase\s*=\s*"/);
  });

  it("maps the server phase rather than re-deriving time on the client", () => {
    expect(page).toContain("selected?.planPhase");
    // No client-side clock arithmetic for this decision.
    const quickActionBlock = page.slice(page.indexOf("const visibleQuickActions"), page.indexOf("const duplicateTitles"));
    expect(quickActionBlock).not.toContain("Date.now()");
  });
});
