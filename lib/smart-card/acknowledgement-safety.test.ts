import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard } from "@/lib/smart-card/smart-card";

const NOW = new Date("2026-09-23T10:00:00.000Z");
const actionSource = readFileSync(
  join(__dirname, "..", "..", "app", "(app)", "smart-card-actions.ts"),
  "utf8"
);

function base(over: Partial<SmartCardInput> = {}): SmartCardInput {
  return {
    now: NOW,
    journey: { completedCount: 8, totalCount: 8, currentStep: null, steps: [] },
    safeArrival: null,
    birthday: null,
    agenda: [],
    weekendPlanCount: 0,
    nearbyFriends: [],
    locationFreshForProximity: false,
    muddyCount: 5,
    buddyScore: null,
    recentAchievement: null,
    suggestionCount: 0,
    ...over
  };
}

describe("Smart Card acknowledgement safety", () => {
  it("cannot suppress a live Safe Arrival even if a stale acknowledgement row exists", () => {
    const input = base({ safeArrival: { travelling: true, watcherCount: 1 } });
    const card = resolveSmartCard(smartCardProviders(input), {
      now: input.now.getTime(),
      acknowledgedIds: new Set(["safe_arrival", "journey_complete"])
    });
    expect(card?.id).toBe("safe_arrival");
  });

  it("cannot suppress an unanswered Plan invitation", () => {
    const input = base({
      agenda: [
        {
          kind: "plan",
          id: "p1",
          title: "Dinner",
          startsAt: "2026-09-23T18:00:00.000Z",
          endsAt: "2026-09-23T20:00:00.000Z",
          startAt: "2026-09-23T18:00:00.000Z",
          endAt: "2026-09-23T20:00:00.000Z",
          organiserName: "Ama",
          myRsvp: "invited",
          invitedCount: 3,
          goingCount: 1,
          maybeCount: 0,
          placeText: null,
          category: null,
          coverImageUrl: null,
          attendees: []
        }
      ]
    });
    const card = resolveSmartCard(smartCardProviders(input), {
      now: input.now.getTime(),
      acknowledgedIds: new Set(["plan_rsvp", "journey_complete"])
    });
    expect(card?.id).toBe("plan_rsvp");
  });

  it("still retires a genuinely dismissible one-off milestone", () => {
    const input = base();
    const card = resolveSmartCard(smartCardProviders(input), {
      now: input.now.getTime(),
      acknowledgedIds: new Set(["journey_complete"])
    });
    expect(card?.id).toBe("upfor_fallback");
  });

  it("the server action accepts only dismissible card ids or earned achievement instances", () => {
    expect(actionSource).toContain("DISMISSIBLE_SMART_CARD_IDS");
    expect(actionSource).not.toContain("(SMART_CARD_IDS as readonly string[])");
    expect(actionSource).toContain('from("user_achievements")');
    expect(actionSource).toContain('.eq("achievement_code", achievementCode)');
    expect(actionSource).toContain("if (!earned) return;");
  });
});
