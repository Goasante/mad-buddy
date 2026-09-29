import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const home = read("components/dashboard/dashboard-page.tsx");
const loader = read("app/(app)/dashboard/page.tsx");
const route = read("app/(app)/moments/page.tsx");
const shell = read("components/app-shell/app-shell.tsx");
const storyService = read("lib/stories/service.ts");

describe("retired Moments surface", () => {
  it("does not load or render a Moments feed on Home", () => {
    expect(loader).not.toContain("buildMomentFeed(admin, user.id)");
    expect(loader).not.toContain("buildSpotlightFeed(admin, user.id)");
    expect(loader).not.toContain("HOME_MOMENTS_LIMIT");
    expect(loader).not.toContain("moments={");
    expect(home).not.toContain("<MomentsPreview");
    expect(home).not.toContain("moments?: VisibleMoment[]");
  });

  it("has no Moments navigation entry", () => {
    expect(shell).not.toContain('{ href: "/moments", label: "Moments"');
  });

  it("keeps old links safe without reviving the old product", () => {
    expect(route).toContain('redirect("/profile")');
    expect(route).not.toContain("<MomentsPage");
  });
});

describe("Stories own temporary sharing", () => {
  it("authorizes active Story rows through the Story service", () => {
    expect(storyService).toContain('.eq("surface", "story")');
    expect(storyService).toContain('.eq("status", "active")');
    expect(storyService).toContain('.gt("expires_at", nowIso)');
    expect(storyService).toContain('from("friendships")');
    expect(storyService).toContain('.is("ended_at", null)');
    expect(storyService).toContain('from("blocked_users")');
  });

  it("does not reintroduce public Air or Spotlight into Stories", () => {
    expect(storyService).not.toContain("buildSpotlightFeed");
    expect(storyService).not.toContain('audience_type", "public"');
  });
});
