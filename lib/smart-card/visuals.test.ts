import { describe, expect, it } from "vitest";
import type { SmartCard } from "@/lib/smart-card/smart-card";
import { curatedPlanSmartCardMedia, smartCardVisualTreatment } from "@/lib/smart-card/visuals";

function card(overrides: Partial<SmartCard> = {}): SmartCard {
  return {
    id: "upfor_fallback",
    priority: 0,
    illustration: "people",
    title: "What are you UpFor today?",
    subtitle: "Let your Muddies know.",
    cta: "Open UpFor",
    destination: "/hangout-mode",
    ...overrides
  };
}

describe("Smart Card visual volume", () => {
  it("always quiets the Smart Card when another Home card owns the screen", () => {
    const withMedia = card({
      media: { url: "/visuals/activities/coffee.jpg", alt: "Coffee" }
    });
    expect(smartCardVisualTreatment(withMedia, true)).toBe("quiet");
  });

  it("keeps Safe Arrival calm even if media is accidentally supplied", () => {
    const safety = card({
      id: "safe_arrival",
      media: { url: "/visuals/activities/party.jpg", alt: "Should not win" }
    });
    expect(smartCardVisualTreatment(safety, false)).toBe("safety");
  });

  it("lets truthful contextual media outrank the branded fallback", () => {
    expect(
      smartCardVisualTreatment(
        card({ media: { url: "/visuals/activities/dinner.jpg", alt: "Dinner" } }),
        false
      )
    ).toBe("media");
    expect(smartCardVisualTreatment(card(), false)).toBe("branded");
  });
});

describe("curated activity artwork", () => {
  it("reuses the approved visual registry rather than hardcoding paths", () => {
    expect(curatedPlanSmartCardMedia("coffee", "Coffee after class")?.url).toBe(
      "/visuals/activities/coffee.jpg"
    );
  });

  it("falls back cleanly when a category has no approved photography", () => {
    expect(curatedPlanSmartCardMedia("workout", "Gym this evening")).toBeUndefined();
  });
});
