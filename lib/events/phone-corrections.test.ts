import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Event phone corrections", () => {
  it("shares through an Event-specific metadata route", () => {
    expect(read("components/events/event-share.tsx")).toContain("/events/${eventId}");
    expect(read("app/(app)/event-actions.ts")).toContain("/events/${eventId}");
    expect(read("app/events/[eventId]/page.tsx")).toContain("generateMetadata");
    const protection = read("lib/security/route-protection.ts");
    expect(protection).toContain("isPublicEventSharePath");
    expect(protection).toContain("(?:\\/preview)?");
  });

  it("does not disclose restricted Event media to preview crawlers", () => {
    const policy = read("lib/events/share-metadata.ts");
    expect(policy).toContain('event.visibility === "public" || event.visibility === "link"');
    const preview = read("app/events/[eventId]/preview/route.ts");
    expect(preview).toContain("eventMetadataMayDisclose(event)");
    expect(preview).toContain("mad-buddy-social-share.jpg");
  });

  it("forces audience descriptions to shrink and wrap on narrow sheets", () => {
    const selector = read("components/events/audience-selector.tsx");
    expect(selector).toContain("min-w-0 max-w-full");
    expect(selector).toContain("[overflow-wrap:anywhere]");
    expect(selector).not.toContain('truncate">{option.detail}');
  });
});
