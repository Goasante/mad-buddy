import { describe, it, expect } from "vitest";
import { featureForHref, featureForNotification, LOCKED_FEATURES } from "./availability";
import { availableSmartCard } from "@/lib/smart-card/availability";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard, type SmartCard } from "@/lib/smart-card/smart-card";
const now = new Date("2026-10-05T12:00:00Z");
const base: SmartCardInput = { now, journey: null, safeArrival: null, birthday: null, agenda: [], weekendPlanCount: 0, nearbyFriends: [], locationFreshForProximity: true, muddyCount: 2, buddyScore: null, recentAchievement: null, suggestionCount: 0 };
const allOn = { upfor: true, linkr: true, events: true, conference: true, safe_arrival: true };
const select = (availability = LOCKED_FEATURES, extra: Partial<SmartCardInput> = {}, acknowledgedIds = new Set<string>()) => resolveSmartCard(smartCardProviders({ ...base, ...extra, availability }), { now: now.getTime(), acknowledgedIds });
describe("optional feature launch controls", () => {
  it("maps deep links and aliases without touching core routes", () => {
    expect(featureForHref("/events/top?event=x")).toBe("events");
    expect(featureForHref("/discover?eventId=x")).toBe("linkr");
    expect(featureForHref("/conference/topic")).toBe("conference");
    for (const path of ["/plans", "/messages", "/friends", "/settings/privacy", "/dashboard", "/events-other", "https://example.com/events"]) expect(featureForHref(path)).toBeNull();
  });
  it("suppresses promotion but preserves existing safety and Plans delivery", () => {
    expect(featureForNotification("hangout:x")).toBe("upfor");
    expect(featureForNotification("event_room:x")).toBe("events");
    expect(featureForNotification("conference_reply:x")).toBe("conference");
    expect(featureForNotification("safe_arrival:x")).toBeNull();
    expect(featureForNotification("plan:x")).toBeNull();
  });
  it("uses a core fallback with all optional products locked", () => {
    expect(select()?.id).toBe("core_fallback");
    expect(select()?.destination).toBe("/friends");
  });
  it("does not change selection or ranking when all products are enabled", () => {
    expect(select(allOn)).toEqual(resolveSmartCard(smartCardProviders(base), { now: now.getTime() }));
  });
  it("retains safety obligations when new journeys are locked", () => {
    expect(select(LOCKED_FEATURES, { safeArrival: { travelling: true, watcherCount: 1, status: "active", expectedArrivalAt: "2026-10-05T13:00:00Z" } })?.id).toBe("safe_arrival");
  });
  it("removes mixed secondary actions without mutating the original card", () => {
    const card: SmartCard = { id: "plan_starting", priority: 2, illustration: "calendar", title: "A Plan", subtitle: "Soon", cta: "Open", destination: "/plans?plan=x", secondaryAction: { label: "Meet others", destination: "/linkr" } };
    expect(availableSmartCard(card, LOCKED_FEATURES)?.secondaryAction).toBeUndefined();
    expect(card.secondaryAction).toBeDefined();
  });
  it("keeps history and cooldowns through lock/unlock cycles", () => {
    const history = new Set(["upfor_fallback", "journey_complete"]);
    expect(select(LOCKED_FEATURES, {}, history)?.id).toBe("core_fallback");
    expect(select(allOn, {}, history)).toBeNull();
    expect([...history]).toEqual(["upfor_fallback", "journey_complete"]);
  });
  it("blocks a journey recommendation whose destination is locked", () => {
    const card: SmartCard = { id: "journey", priority: 0, illustration: "target", title: "Try Safe Arrival", subtitle: "Try it", cta: "Start", destination: "/safe-arrival" };
    expect(availableSmartCard(card, LOCKED_FEATURES)).toBeNull();
    expect(availableSmartCard(card, allOn)).toBe(card);
  });
  it("checks Event Linkr dependencies independently", () => {
    const card: SmartCard = { id: "event_linkr_ready", priority: 0, illustration: "people", title: "Meet people", subtitle: "Here", cta: "See", destination: "/events?event=x" };
    expect(availableSmartCard(card, { ...allOn, events: false })).toBeNull();
    // Both domain controls are required even when the CTA opens the Event.
    expect(availableSmartCard(card, { ...allOn, linkr: false })).toBeNull();
  });
});
