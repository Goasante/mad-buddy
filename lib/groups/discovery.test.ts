import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const source = (path: string) => stripComments(read(path));

const feed = source("components/socialize/discovery-feed.tsx");
const rails = source("components/socialize/discovery-rails.tsx");
const socialize = source("components/socialize/socialize-page.tsx");
const actions = source("app/(app)/group-actions.ts");
const mobileGroups = source("lib/groups/mobile.ts");
const mobileMessages = source("mobile/src/screens/MessagesScreen.tsx");
const mobileManager = source("mobile/src/screens/GroupsScreen.tsx");
const invites = source("components/invites/invites-page.tsx");
const joinRoute = source("app/api/groups/[id]/join/route.ts");
const hangouts = source("app/(app)/hangout-actions.ts");
const retirement = read("supabase/migrations/20260923152500_groups_messages_only.sql");

describe("public Group discovery is fully retired", () => {
  it("removes Groups from Linkr/Socialize presentation and actions", () => {
    expect(feed).not.toContain("GroupsRail");
    expect(feed).not.toContain("onJoinGroup");
    expect(rails).not.toContain("Join a Group");
    expect(rails).not.toContain("No groups to discover");
    expect(socialize).not.toContain("joinDiscoverableGroupAction");
    expect(socialize).not.toContain("initialGroups");
  });

  it("does not spend server queries rebuilding an impossible discovery list", () => {
    const load = actions.slice(
      actions.indexOf("export async function loadGroupsPageDataAction"),
      actions.indexOf("export async function createGroupAction")
    );
    expect(load).not.toContain('eq("visibility", "public")');
    expect(load).not.toContain('eq("join_mode", "link")');
    expect(load).toContain("discoverableGroups: []");

    const mobileLoad = mobileGroups.slice(
      mobileGroups.indexOf("export async function listGroupsPageData"),
      mobileGroups.indexOf("export async function createGroup")
    );
    expect(mobileLoad).not.toContain('eq("visibility", "public")');
    expect(mobileLoad).not.toContain('eq("join_mode", "link")');
    expect(mobileLoad).toContain("discoverableGroups: []");
  });

  it("retires open joining at both compatibility boundaries", () => {
    expect(actions).not.toContain("joinDiscoverableGroupAction");
    expect(mobileGroups).not.toContain("joinDiscoverableGroup");
    expect(joinRoute).toContain("status: 410");
    expect(joinRoute).toContain("private and invitation-only");
  });

  it("keeps the database authoritative", () => {
    expect(retirement).toContain("visibility = 'private'");
    expect(retirement).toContain("join_mode = 'invite'");
    expect(retirement).toContain("group_settings_private_only");
    expect(retirement).toContain("group_settings_invite_only");
  });
});

describe("Messages owns Group management everywhere", () => {
  it("routes accepted web invitations directly into the conversation", () => {
    expect(invites).toContain("router.push(`/messages?conversation=${result.groupId}`)");
    expect(invites).not.toContain("router.push(`/groups/");
  });

  it("keeps creation and invitation resolution inside mobile Messages", () => {
    expect(mobileMessages).toContain("<GroupsManagerContent");
    expect(mobileMessages).toContain("Create, manage or open a private Group");
    expect(mobileManager).toContain("Groups are private and invitation-only");
    expect(mobileManager).toContain("/invitation");
    expect(mobileManager).not.toContain("Discover");
    expect(mobileManager).not.toContain("discoverable");
  });
});

describe("legacy Group-targeted UpFors remain accessible to real members", () => {
  it("uses active Group membership instead of retired public visibility", () => {
    const selectedGroups = hangouts.slice(
      hangouts.indexOf('case "selected_groups"'),
      hangouts.indexOf("default:", hangouts.indexOf('case "selected_groups"'))
    );
    expect(selectedGroups).toContain('.eq("conversation_type", "group")');
    expect(selectedGroups).toContain('.eq("status", "joined")');
    expect(selectedGroups).toContain('.in("conversation_id", activeGroupIds)');
    expect(selectedGroups).not.toContain('eq("visibility", "public")');
  });
});
