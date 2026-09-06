import { describe, expect, it } from "vitest";
import { SMART_CARD_APPROVED_STATES } from "@/lib/smart-card/catalog";

describe("Smart Card v2 product catalog", () => {
  it("keeps Moments out while the feature is paused", () => {
    const ids = SMART_CARD_APPROVED_STATES.map((state) => state.id);
    expect(ids.some((id) => id.includes("moment"))).toBe(false);
  });

  it("contains the approved cross-product states", () => {
    const ids = new Set(SMART_CARD_APPROVED_STATES.map((state) => state.id));
    for (const id of [
      "safe_arrival_overdue",
      "plan_rsvp",
      "upfor_requests",
      "nearby_muddy",
      "linkr_mutual",
      "event_live",
      "event_linkr_ready",
      "muddy_request",
      "notification_action_bundle",
      "profile_blocking",
      "journey",
      "buddy_progress",
      "upfor_fallback"
    ]) {
      expect(ids, `${id} must remain in the approved Smart Card catalog`).toContain(id);
    }
  });

  it("keeps safety above obligations, live social context, opportunities and progression", () => {
    const tier = new Map(SMART_CARD_APPROVED_STATES.map((state) => [state.id, state.tier]));
    expect(tier.get("safe_arrival_overdue")).toBeLessThan(tier.get("plan_rsvp")!);
    expect(tier.get("plan_rsvp")).toBeLessThan(tier.get("event_live")!);
    expect(tier.get("event_live")).toBeLessThan(tier.get("linkr_mutual")!);
    expect(tier.get("linkr_mutual")).toBeLessThan(tier.get("event_starting")!);
    expect(tier.get("event_starting")).toBeLessThan(tier.get("journey")!);
  });

  it("never lets Buddy Score outrank real social life", () => {
    const tier = new Map(SMART_CARD_APPROVED_STATES.map((state) => [state.id, state.tier]));
    expect(tier.get("buddy_progress")).toBe(5);
    expect(tier.get("nearby_muddy")).toBe(2);
    expect(tier.get("plan_rsvp")).toBe(1);
  });
});
