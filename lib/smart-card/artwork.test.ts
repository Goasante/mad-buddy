import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SMART_CARD_APPROVED_STATES } from "./catalog";
import { SMART_CARD_IDS } from "./smart-card";
import { SMART_CARD_ARTWORK_TILES, SMART_CARD_SCENES, smartCardArtwork } from "./artwork";

describe("reviewed SmartCard artwork", () => {
  it("covers every catalog scenario exactly once", () => {
    expect(Object.keys(SMART_CARD_SCENES).sort()).toEqual(SMART_CARD_APPROVED_STATES.map(s => s.id).sort());
    expect(new Set(Object.values(SMART_CARD_SCENES)).size).toBe(58);
  });
  it("uses neutral art for every approved scenario including personal states", () => {
    expect(Object.keys(SMART_CARD_ARTWORK_TILES).sort()).toEqual(SMART_CARD_APPROVED_STATES.map(s => s.id).sort());
    for (const state of SMART_CARD_APPROVED_STATES) {
      const art = smartCardArtwork({ id: state.id });
      expect(art.src).toBe("/illustrations/smart-card/neutral-scenarios-v1.webp");
      expect(art.tile).toBeGreaterThanOrEqual(0);
      expect(art.tile).toBeLessThan(16);
    }
    expect(smartCardArtwork({ id: "birthday" }).tile).toBe(12);
    expect(smartCardArtwork({ id: "muddy_birthday" }).tile).toBe(12);
    expect(smartCardArtwork({ id: "event_live" }).tile).toBe(10);
    expect(smartCardArtwork({ id: "linkr_mutual_event" }).tile).toBe(11);
  });
  it("resolves every live provider to an existing asset and valid viewport", () => {
    for (const id of SMART_CARD_IDS) {
      const art = smartCardArtwork({ id });
      expect(existsSync(`public${art.src}`), id).toBe(true);
      const [x, y, width, height] = art.viewBox.split(" ").map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(x + width).toBeLessThanOrEqual(1024);
      expect(y + height).toBeLessThanOrEqual(1536);
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
