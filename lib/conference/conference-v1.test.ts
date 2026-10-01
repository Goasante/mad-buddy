import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Conference V1 product boundaries", () => {
  it("uses the same 15km outer radius chosen for Conference Around You", () => {
    const conference = stripComments(read("lib/conference/server.ts"));
    const proximity = stripComments(read("lib/proximity/backend.ts"));
    expect(conference).toContain("CONFERENCE_RADIUS_METERS = 15_000");
    expect(proximity).toContain("FAR_MAX_METERS = 15_000");
  });

  it("keeps Around You fixed rather than presenting a location picker", () => {
    const page = stripComments(read("components/conference/conference-page.tsx"));
    expect(page).toContain("Around You");
    expect(page).toContain("Conversations within 15 km");
    expect(page).not.toContain("Home Area");
    expect(page).not.toContain("Choose location");
  });

  it("never projects location fields in public Conference types", () => {
    const types = stripComments(read("lib/conference/types.ts"));
    expect(types).not.toContain("latitude");
    expect(types).not.toContain("longitude");
    expect(types).not.toContain("authorUserId");
  });

  it("keeps private location anchors behind server-only code and RLS", () => {
    const service = read("lib/conference/server.ts");
    const migration = read("supabase/migrations/20261001170000_conference_v1.sql");
    expect(service).toContain('import "server-only"');
    expect(migration).toContain("origin_latitude");
    expect(migration).toContain("origin_longitude");
    expect(migration).toContain("enable row level security");
  });

  it("uses per-topic anonymous Voice identity", () => {
    const migration = read("supabase/migrations/20261001170000_conference_v1.sql");
    expect(migration).toContain("conference_voice_ids");
    expect(migration).toContain("unique (topic_id, voice_number)");
    expect(stripComments(read("components/conference/conference-page.tsx"))).toContain("You’ll appear as a Voice");
  });

  it("lives in Quick Actions, not permanent navigation, and Focus remains a Settings feature", () => {
    const quick = stripComments(read("lib/navigation/quick-actions.ts"));
    const shell = stripComments(read("components/app-shell/app-shell.tsx"));
    expect(quick).toContain('id: "conference"');
    expect(quick).toContain('href: "/conference"');
    expect(quick).not.toContain('id: "focus"');
    expect(shell).not.toContain('{ href: "/conference"');
    expect(read("app/(app)/settings/engagement/page.tsx")).toBeTruthy();
  });

  it("ships Hype and Pass instead of the old Lift/Lower wording", () => {
    const feed = read("components/conference/conference-page.tsx");
    const detail = read("components/conference/conference-topic-page.tsx");
    expect(feed).toContain('"Hype"');
    expect(feed).toContain('"Pass"');
    expect(detail).toContain('"Hype"');
    expect(detail).toContain('"Pass"');
    expect(feed).not.toContain("Lift");
    expect(feed).not.toContain("Lower");
  });
});
