import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const page = read("components/events/events-page.tsx");
const modal = read("components/events/event-settings-modal.tsx");
const actions = read("app/(app)/event-actions.ts");
const service = read("lib/events/mobile.ts");
const selector = read("components/events/audience-selector.tsx");

describe("Event settings", () => {
  it("opens a real published-Event settings surface instead of the draft editor", () => {
    expect(page).toContain("<EventSettingsModal");
    expect(page).toContain("setEventSettingsOpen(true)");
    expect(page).toContain("setHostToolsOpen(false)");
    expect(page).not.toContain('else if (row === "settings") continueDraft(selectedEvent.id)');
  });

  it("loads and saves the existing audience through host-only server authority", () => {
    expect(actions).toContain("getEventAudienceSettingsAction");
    expect(actions).toContain("updateEventAudienceSettingsAction");
    expect(service).toContain("getEventAudienceSettingsForHost");
    expect(service).toContain("updateEventAudienceSettings");
    expect(service).toContain("event.host_id !== userId");
    expect(service).toContain('action: "events.update"');
  });

  it("re-authorizes targeted audiences and preserves Nearby requirements", () => {
    expect(service).toContain("batchEligibleMuddyIds");
    expect(service).toContain("eligibleCommunityTargetIds");
    expect(service).toContain("validateAudienceRequirements");
    expect(service).toContain("event_audience_targets");
    expect(service).toContain("event_locations");
  });

  it("offers all five Event audience modes after publishing", () => {
    expect(modal).toContain("<AudienceSelector");
    expect(modal).toContain("invited people, link-only, a community, nearby discovery and public");
    for (const value of ["invite", "link", "community", "nearby", "public"]) {
      expect(selector).toContain(`id: "${value}"`);
    }
  });

  it("keeps ended and cancelled Event audience history immutable", () => {
    expect(service).toContain('event.status === "ended" || event.status === "cancelled"');
    expect(modal).toContain('currentProjection?.status === "ended"');
  });
});
