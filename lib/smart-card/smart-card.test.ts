import { describe, expect, it } from "vitest";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard, SMART_CARD_IDS } from "@/lib/smart-card/smart-card";
import type { JourneyData } from "@/lib/journey/journey";

const NOW = new Date(2026, 7, 5, 10, 0, 0);
const completeJourney: JourneyData = { completedCount: 9, totalCount: 9, currentStep: null, steps: [] };

function input(overrides: Partial<SmartCardInput> = {}): SmartCardInput {
  return {
    now: NOW,
    journey: completeJourney,
    safeArrival: null,
    birthday: null,
    weekendPlanCount: 0,
    nearbyCount: 0,
    buddyScore: null,
    recentAchievement: null,
    suggestionCount: 0,
    ...overrides
  };
}

describe("Home Smart Card convergence", () => {
  it("has no membership upsell provider", () => {
    expect(SMART_CARD_IDS).not.toContain("membership" as never);
    expect(smartCardProviders(input()).some((provider) => provider.id === ("membership" as never))).toBe(false);
  });

  it("keeps exactly-one-card fallback behavior", () => {
    const built = input();
    const card = resolveSmartCard(smartCardProviders(built), {
      now: built.now.getTime(),
      acknowledgedIds: new Set(["journey_complete"])
    });
    expect(card?.id).toBe("suggestions");
  });

  it("still prioritizes safety over ordinary engagement", () => {
    const built = input({ safeArrival: { travelling: true, watcherCount: 2 } });
    expect(resolveSmartCard(smartCardProviders(built), { now: built.now.getTime() })?.id).toBe("safe_arrival");
  });
});
