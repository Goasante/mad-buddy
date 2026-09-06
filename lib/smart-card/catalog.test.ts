import { describe, expect, it } from "vitest";
import { SMART_CARD_APPROVED_STATES } from "@/lib/smart-card/catalog";

describe("Smart Card v2 product catalog", () => {
  it("keeps Moments out while the feature is paused", () => {
    /* Matched precisely rather than by substring. `id.includes("moment")` also
       catches `upfor_momentum` -- a legitimate UpFor state with no relationship
       to the Moments feature -- which fails this test for the wrong reason and
       invites someone to "fix" it by renaming a good state. What must never
       come back is a Moments SOURCE: a moments-family state, or an id that is
       the word on its own or as a whole segment. */
    const offenders = SMART_CARD_APPROVED_STATES.filter(
      (state) =>
        state.family === ("moments" as typeof state.family) ||
        /(^|_)moments?($|_)/.test(state.id)
    ).map((state) => state.id);
    expect(offenders).toEqual([]);
  });

  it("declares no moments family at all", () => {
    const families = new Set(SMART_CARD_APPROVED_STATES.map((state) => state.family));
    expect([...families]).not.toContain("moments");
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
