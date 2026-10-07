import { describe, expect, it } from "vitest";
import { featureForHref, featureForNotification, LOCKED_FEATURES, type FeatureAvailability } from "./availability";
import { availableSmartCard } from "@/lib/smart-card/availability";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard, type SmartCard } from "@/lib/smart-card/smart-card";

const now = new Date("2026-10-07T12:00:00Z");
const base: SmartCardInput = { now, journey: null, safeArrival: null, birthday: null, agenda: [], weekendPlanCount: 0, nearbyFriends: [], locationFreshForProximity: false, muddyCount: 2, buddyScore: null, recentAchievement: null, suggestionCount: 0, meetups: [] };
const allOn: FeatureAvailability = { linkr: true, events: true, conference: true, meet_up: true };
const select = (availability: FeatureAvailability) => resolveSmartCard(smartCardProviders({ ...base, availability }), { now: now.getTime() });

describe("optional feature launch controls after Meetups convergence", () => {
  it("maps retired coordination URLs to Meetups", () => {
    for (const path of ["/meet-up", "/plans", "/safe-arrival", "/hangout-mode", "/upfor"]) expect(featureForHref(path)).toBe("meet_up");
    expect(featureForHref("/messages")).toBeNull();
  });

  it("maps historical UpFor notifications into the Meetups release control", () => {
    expect(featureForNotification("hangout:x")).toBe("meet_up");
    expect(featureForNotification("upfor:x")).toBe("meet_up");
    expect(featureForNotification("meetup:x")).toBe("meet_up");
  });

  it("uses a neutral core fallback while optional products are locked", () => {
    expect(select(LOCKED_FEATURES)?.id).toBe("core_fallback");
    expect(select(LOCKED_FEATURES)?.destination).toBe("/friends");
  });

  it("uses Meetups as the social fallback when Meetups is available", () => {
    expect(select(allOn)?.id).toBe("meetup_fallback");
    expect(select(allOn)?.destination).toBe("/meet-up");
  });

  it("blocks cards whose destination is a locked retired alias", () => {
    const card: SmartCard = { id: "journey", priority: 0, illustration: "target", title: "Meet up", subtitle: "Coordinate", cta: "Open", destination: "/plans" };
    expect(availableSmartCard(card, LOCKED_FEATURES)).toBeNull();
    expect(availableSmartCard(card, allOn)).toBe(card);
  });

  it("still requires both Events and Linkr for Event Linkr", () => {
    const card: SmartCard = { id: "event_linkr_ready", priority: 0, illustration: "people", title: "Meet people", subtitle: "Here", cta: "See", destination: "/events?event=x" };
    expect(availableSmartCard(card, { ...allOn, events: false })).toBeNull();
    expect(availableSmartCard(card, { ...allOn, linkr: false })).toBeNull();
  });
});
