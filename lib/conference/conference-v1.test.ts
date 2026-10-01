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
    expect(page).toContain("Around You · 15 km");
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
    expect(stripComments(read("components/conference/conference-page.tsx"))).toContain("anonymous to others");
  });

  it("lives in Quick Actions, not permanent navigation, and Focus remains a Settings feature", () => {
    const quick = stripComments(read("lib/navigation/quick-actions.ts"));
    const shell = stripComments(read("components/app-shell/app-shell.tsx"));
    expect(quick).toContain('id: "conference"');
    expect(quick).toContain('href: "/conference"');
    expect(quick).not.toContain('id: "focus"');
    expect(shell).not.toContain('{ href: "/conference"');
    expect(read("app/(app)/settings/engagement/page.tsx")).toBeTruthy();
    expect(shell).toContain('"/conference"');
    expect(shell).toContain('pathname.startsWith("/conference/")');
  });

  it("keeps Conference location separate from Glow and respects Ghost Mode", () => {
    const feed = stripComments(read("components/conference/conference-page.tsx"));
    const sync = stripComments(read("components/conference/conference-location-sync.tsx"));
    const server = stripComments(read("lib/conference/server.ts"));
    expect(feed).toContain("/api/conference/location");
    expect(feed).not.toContain("/api/location/update");
    expect(sync).toContain("/api/conference/location");
    expect(server).toContain('profile?.visibility_status === "ghost"');
    expect(server).toContain("conferenceCandidate");
  });

  it("reuses Mad Buddy safety, moderation and retention systems", () => {
    const migration = stripComments(read("supabase/migrations/20261001170000_conference_v1.sql"));
    const server = stripComments(read("lib/conference/server.ts"));
    const moderation = stripComments(read("app/(admin)/admin/reports/actions.ts"));
    expect(migration).toContain("conference_report_once_per_user");
    expect(migration).toContain("cleanup_conference");
    expect(migration).toContain("conference_topic");
    expect(migration).toContain("conference_reply");
    expect(server).toContain('from("hidden_content")');
    expect(server).toContain('from("content_reports")');
    expect(moderation).toContain("conference_topics");
    expect(moderation).toContain("conference_replies");
  });

  it("fails closed behind an off-by-default feature flag", () => {
    const migration = stripComments(read("supabase/migrations/20261001170000_conference_v1.sql"));
    const layout = stripComments(read("app/(app)/layout.tsx"));
    const launcher = stripComments(read("components/app-shell/quick-actions-launcher.tsx"));
    expect(migration).toContain("'conference'");
    expect(migration).toContain("'off'");
    expect(layout).toContain("CONFERENCE_FLAG");
    expect(launcher).toContain('action.id !== "conference"');
  });

  it("includes Conference in account export and deletion", () => {
    const exportRoute = stripComments(read("app/api/account/export/route.ts"));
    const deletion = stripComments(read("lib/account/deletion.ts"));
    expect(exportRoute).toContain("conferenceTopics");
    expect(exportRoute).toContain("conferenceReplies");
    expect(exportRoute).not.toContain('select("latitude, longitude").eq("user_id", userId)');
    expect(deletion).toContain('"conference_locations"');
    expect(deletion).toContain('"conference_topics"');
    expect(deletion).toContain('"conference_replies"');
  });

  it("lets members delete their own Topics and Voices without needing current location", () => {
    const server = stripComments(read("lib/conference/server.ts"));
    const actions = stripComments(read("app/(app)/conference-actions.ts"));
    const feed = stripComments(read("components/conference/conference-page.tsx"));
    const detail = stripComments(read("components/conference/conference-topic-page.tsx"));
    expect(server).toContain("deleteConferenceContent");
    expect(server).toContain('status: "removed"');
    expect(server).toContain("origin_latitude: null");
    expect(server).toContain("origin_longitude: null");
    expect(actions).toContain("deleteConferenceContentAction");
    expect(feed).toContain("Delete");
    expect(detail).toContain("Delete Topic");
    expect(detail).toContain("Delete Voice");
  });

  it("switches Fresh and Hot locally without a server navigation", () => {
    const feed = stripComments(read("components/conference/conference-page.tsx"));
    expect(feed).toContain('setSort(next)');
    expect(feed).toContain('window.history.replaceState');
    expect(feed).not.toContain('href="/conference?sort=fresh"');
    expect(feed).not.toContain('href="/conference?sort=hot"');
  });

  it("keeps frequent Conference mutations optimistic instead of revalidating routes", () => {
    const actions = stripComments(read("app/(app)/conference-actions.ts"));
    const feed = stripComments(read("components/conference/conference-page.tsx"));
    const detail = stripComments(read("components/conference/conference-topic-page.tsx"));
    expect(actions).not.toContain("revalidatePath");
    expect(feed).toContain("optimistic-");
    expect(detail).toContain("optimistic-");
    expect(detail).not.toContain("router.refresh()");
  });

  it("limits feed Voice lookups to Topic authors", () => {
    const server = stripComments(read("lib/conference/server.ts"));
    expect(server).toContain("candidateAuthorIds");
    expect(server).toContain('.in("user_id", authorIds)');
  });

  it("never resurrects stale Conference content or sends it to the generic 404 page", () => {
    const server = stripComments(read("lib/conference/server.ts"));
    const feed = stripComments(read("components/conference/conference-page.tsx"));
    const detailRoute = stripComments(read("app/(app)/conference/[topicId]/page.tsx"));
    expect(server).toContain("stale: true");
    expect(server).toContain("is no longer available");
    expect(feed).toContain("!result.ok && !result.stale");
    expect(detailRoute).toContain('redirect("/conference?notice=unavailable")');
    expect(detailRoute).not.toContain("notFound()");
  });

  it("dismisses Conference action menus on outside tap or Escape and avoids blocking browser confirms", () => {
    const menu = stripComments(read("components/conference/conference-action-menu.tsx"));
    const feed = stripComments(read("components/conference/conference-page.tsx"));
    const detail = stripComments(read("components/conference/conference-topic-page.tsx"));
    expect(menu).toContain('document.addEventListener("pointerdown"');
    expect(menu).toContain('event.key === "Escape"');
    expect(feed).not.toContain("<details");
    expect(detail).not.toContain("<details");
    expect(feed).not.toContain("window.confirm");
    expect(detail).not.toContain("window.confirm");
  });

  it("ships Hype and Pass instead of the old Lift/Lower wording", () => {
    const feed = read("components/conference/conference-page.tsx");
    const detail = read("components/conference/conference-topic-page.tsx");
    expect(feed).toContain("Hype {");
    expect(feed).toContain("Pass {");
    expect(detail).toContain("Hype {");
    expect(detail).toContain("Pass {");
    expect(feed).not.toContain("Lift");
    expect(feed).not.toContain("Lower");
  });
});
