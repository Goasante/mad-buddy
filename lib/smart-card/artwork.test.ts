import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SMART_CARD_APPROVED_STATES } from "./catalog";
import { SMART_CARD_IDS } from "./smart-card";
import { SMART_CARD_ARTWORK_FILES, SMART_CARD_SCENES, smartCardArtwork } from "./artwork";

describe("reviewed SmartCard artwork", () => {
  it("covers every catalog scenario exactly once", () => {
    expect(Object.keys(SMART_CARD_SCENES).sort()).toEqual(SMART_CARD_APPROVED_STATES.map(s => s.id).sort());
    expect(new Set(Object.values(SMART_CARD_SCENES)).size).toBe(58);
  });
  it("assigns a distinct reviewed image to all 58 approved states", () => {
    expect(Object.keys(SMART_CARD_ARTWORK_FILES).sort()).toEqual(SMART_CARD_APPROVED_STATES.map(s => s.id).sort());
    expect(new Set(Object.values(SMART_CARD_ARTWORK_FILES)).size).toBe(58);
    for (const state of SMART_CARD_APPROVED_STATES) {
      expect(smartCardArtwork({ id: state.id }).src).toBe(`/illustrations/smart-card/scenes-v2/${SMART_CARD_ARTWORK_FILES[state.id]}`);
    }
  });
  it("resolves every live provider to an existing production asset", () => {
    for (const id of SMART_CARD_IDS) {
      expect(existsSync(`public${smartCardArtwork({ id }).src}`), id).toBe(true);
    }
  });
  it("distinguishes an unconfirmed check-in from a normal journey", () => {
    expect(smartCardArtwork({ id: "safe_arrival", eyebrow: "SAFE ARRIVAL · CHECK IN" }).scene).toBe(2);
    expect(smartCardArtwork({ id: "safe_arrival", eyebrow: "SAFE ARRIVAL" }).scene).toBe(3);
  });
  it("keeps social meaning distinct and never changes provider data", () => {
    const card = { id: "plan_rsvp" as const, eyebrow: "NEEDS YOUR RESPONSE" };
    const before = { ...card };
    expect(smartCardArtwork(card).scene).toBe(5);
    expect(smartCardArtwork({ id: "weekend_plans" }).scene).toBe(42);
    expect(smartCardArtwork({ id: "core_fallback" }).scene).toBe(1);
    expect(card).toEqual(before);
  });
});
