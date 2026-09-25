import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { resolveNotificationDestination } from "@/lib/notifications/destination";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const source = (path: string) => stripComments(read(path));

const mobileProjection = source("lib/messaging/mobile.ts");
const messagesV4 = source("components/messages/messages-page-v4.tsx");
const messagesV5 = source("components/messages/messages-shortcuts.tsx");
const groupsRoute = source("app/(app)/groups/page.tsx");
const groupDetailRoute = source("app/(app)/groups/[id]/page.tsx");
const appShell = source("components/app-shell/app-shell.tsx");
const quickActions = source("lib/navigation/quick-actions.ts");
const friendsPage = source("components/friends/friends-page.tsx");
const memberPresentation = source("lib/groups/member-presentation.ts");
const groupActions = source("app/(app)/group-actions.ts");
const mobileGroups = source("lib/groups/mobile.ts");
const mobileApp = source("mobile/src/App.tsx");
const mobileMessages = source("mobile/src/screens/MessagesScreen.tsx");
const circleActions = source("app/(app)/circles-actions.ts");
const retirementMigration = read("supabase/migrations/20260923152500_groups_messages_only.sql");

const GROUP = "8b9e9e41-97c3-4e57-a3c2-d9333db3e134";

describe("Groups belong to Messages", () => {
  it("keeps a real Groups filter in the canonical web inbox", () => {
    expect(messagesV4).toContain('{ id: "groups", label: "Groups" }');
    expect(messagesV4).toContain('activeFilter === "groups"');
    expect(messagesV4).toContain('conversation.kind !== "group"');
    expect(messagesV4).toContain('requestedFilter === "groups" ? "groups" : "all"');
  });

  it("keeps a real Groups filter in the mobile inbox", () => {
    expect(mobileMessages).toContain('"all", "unread", "groups", "plans"');
    expect(mobileMessages).toContain('activeTab === "groups"');
    expect(mobileMessages).toContain('c.kind === "group"');
  });

  it("redirects every legacy Groups route into Messages", () => {
    expect(groupsRoute).toContain('redirect("/messages?filter=groups")');
    expect(groupDetailRoute).toContain('/messages?conversation=');
    expect(mobileApp).toContain('<Navigate to="/messages?filter=groups" replace />');
  });

  it("does not advertise a second Groups destination in shell or quick actions", () => {
    expect(appShell).not.toContain('{ href: "/groups", label: "Groups"');
    expect(quickActions).not.toContain('id: "groups"');
    expect(quickActions).toContain('id: "focus"');
    expect(quickActions).toContain('href: "/settings/engagement"');
  });

  it("does not escape New Chat or Group Settings back to the retired page", () => {
    expect(messagesV4).not.toContain('router.push("/groups"');
    expect(messagesV4).not.toContain('router.push(`/groups/');
    expect(messagesV5).not.toContain('router.push("/groups"');
    expect(messagesV5).not.toContain("Open or create a group");
  });

  it("routes Group notifications directly to the conversation in Messages", () => {
    expect(resolveNotificationDestination(`group:${GROUP}`)).toEqual({
      type: "internal",
      href: `/messages?conversation=${GROUP}`
    });
    expect(resolveNotificationDestination("group:not-a-uuid")).toEqual({
      type: "internal",
      href: "/messages?filter=groups"
    });
  });
});

describe("Groups are private conversations, not Linkr communities", () => {
  it("forces every new web Group to private + invite-only", () => {
    const create = groupActions.slice(groupActions.indexOf("export async function createGroupAction"));
    expect(create).toContain('visibility: "private"');
    expect(create).toContain('join_mode: "invite"');
    expect(create.slice(0, 3500)).not.toContain("parsed.data.visibility");
    expect(create.slice(0, 3500)).not.toContain("parsed.data.openToJoin");
  });

  it("forces every new mobile Group to the same private model", () => {
    const create = mobileGroups.slice(mobileGroups.indexOf("export async function createGroup"));
    expect(create).toContain('visibility: "private"');
    expect(create).toContain('join_mode: "invite"');
    expect(mobileGroups.slice(0, mobileGroups.indexOf("const uuidSchema"))).not.toContain("openToJoin");
  });

  it("closes existing public/open Groups in the migration", () => {
    expect(retirementMigration).toContain("visibility = 'private'");
    expect(retirementMigration).toContain("join_mode = 'invite'");
    expect(retirementMigration).toContain("where visibility <> 'private'");
  });

  it("preserves the stored group conversation identity and member actions", () => {
    expect(mobileProjection).toContain('conversation?.conversation_type === "group"');
    expect(memberPresentation).toContain('leave_group: "Leave Group"');
    expect(memberPresentation).toContain('remove_member: "Remove from Group"');
    expect(groupActions).toContain('from("group_settings")');
  });
});

describe("private Muddy organization remains Circles", () => {
  it("keeps Circles separate from shared Group conversations", () => {
    expect(friendsPage).toContain('{ id: "circles", label: "Circles" }');
    expect(friendsPage).toContain("New Circle");
    expect(circleActions).toContain('from("friend_circles")');
    expect(circleActions).toContain('from("circle_members")');
  });
});
