import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STORY_ACTIVE_LIMIT,
  STORY_LIFETIME_HOURS,
  storySlotsRemaining
} from "@/lib/stories/types";

const read = (path: string) => readFileSync(path, "utf8");

const migration = read("supabase/migrations/20260929123000_stories_replace_moments.sql");
const actions = read("app/(app)/stories-actions.ts");
const composer = read("components/stories/story-composer.tsx");
const popup = read("components/glow/muddy-profile-modal.tsx");
const friends = read("components/friends/friends-page.tsx");
const appShell = read("components/app-shell/app-shell.tsx");
const dashboard = read("components/dashboard/dashboard-page.tsx");
const momentsRoute = read("app/(app)/moments/page.tsx");

describe("Stories product limits", () => {
  it("uses a fixed 12-hour lifetime and five active slots", () => {
    expect(STORY_LIFETIME_HOURS).toBe(12);
    expect(STORY_ACTIVE_LIMIT).toBe(5);
    expect(storySlotsRemaining(0)).toBe(5);
    expect(storySlotsRemaining(4)).toBe(1);
    expect(storySlotsRemaining(5)).toBe(0);
    expect(storySlotsRemaining(8)).toBe(0);
  });

  it("enforces lifetime and active capacity inside the database transaction", () => {
    expect(migration).toContain("v_active_count >= 5");
    expect(migration).toContain("interval '12 hours'");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("surface = 'story'");
  });

  it("does not expose the Story creation RPC to browser roles", () => {
    expect(migration).toContain(
      "revoke all on function public.create_story(uuid, uuid, text, text, uuid[])"
    );
    expect(migration).toContain(
      "grant execute on function public.create_story(uuid, uuid, text, text, uuid[])"
    );
    expect(migration).toContain("to service_role");
  });
});

describe("Story creation stays lightweight", () => {
  it("is photo-only and only uploads during Share", () => {
    expect(composer).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(composer).toContain("function publish()");
    expect(composer).toContain("formData.set(\"media\", file)");
    expect(composer).toContain("createStoryAction(formData)");
    expect(composer).not.toContain("uploadMomentMediaAction");
  });

  it("reuses server image hardening and leaves expiry to the database", () => {
    expect(actions).toContain("processImageUpload");
    expect(actions).toContain("sniffImageKind");
    expect(actions).toContain('context: "moment"');
    expect(actions).toContain('admin.rpc("create_story"');
    expect(actions).not.toContain("expiresAt:");
  });
});

describe("Story and Glow signals do not compete", () => {
  it("removes repeated proximity Glow from the Muddy popup and uses Story ring there", () => {
    expect(popup).toContain("<StoryRing");
    expect(popup).toContain("<StoryViewer");
    expect(popup).not.toContain("<ProximityGlowAvatar");
  });

  it("lets the Muddies page show Story state directly while keeping proximity elsewhere", () => {
    expect(friends).toContain("onClick={hasStory ? onViewStory : onViewProfile}");
    expect(friends).toContain("{hasStory ? (");
    expect(friends).toContain("<StoryRing");
    expect(friends).toContain(") : band ? (");
    expect(friends).toContain("<ProximityGlowAvatar");
  });
});

describe("Moments is retired as a product surface", () => {
  it("has no Moments navigation or Home rail", () => {
    expect(appShell).not.toContain('{ href: "/moments", label: "Moments"');
    expect(dashboard).not.toContain("<MomentsPreview");
  });

  it("keeps old Moment links safe by sending them to Profile", () => {
    expect(momentsRoute).toContain('redirect("/profile")');
    expect(momentsRoute).not.toContain("<MomentsPage");
  });
});

describe("Story storage cleanup", () => {
  it("queues legacy Moment media during cutover and stale unattached Story media later", () => {
    expect(migration).toContain("media_deletion_queue");
    expect(migration).toContain("queue_stale_unattached_story_media");
    expect(migration).toContain("upload_expires_at");
  });
});
