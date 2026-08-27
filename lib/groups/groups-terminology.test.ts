import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { resolveNotificationDestination } from "@/lib/notifications/destination";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const source = (path: string) => stripComments(read(path));

const mobile = source("lib/messaging/mobile.ts");
const messagesPage = source("components/messages/messages-page.tsx");
const groupsPage = source("components/groups/groups-page.tsx");
const groupDetail = source("components/groups/group-detail-page.tsx");
const appShell = source("components/app-shell/app-shell.tsx");
const friendsPage = source("components/friends/friends-page.tsx");
const memberPresentation = source("lib/groups/member-presentation.ts");
const groupActions = source("app/(app)/group-actions.ts");
const circleActions = source("app/(app)/circles-actions.ts");

const GROUP = "8b9e9e41-97c3-4e57-a3c2-d9333db3e134";

/**
 * Final product boundary:
 * - Circles are private labels a person uses to organise their own Muddies.
 * - Groups are shared multi-person spaces backed by the existing group model.
 *
 * Routes, tables, action identifiers, and conversation types remain stable.
 */
describe("shared spaces read as Groups", () => {
  it("names navigation, page headings, and the Messages filter Groups", () => {
    expect(appShell).toContain('label: "Groups"');
    expect(groupsPage).toContain('<PageHeader title="Groups" />');
    expect(groupsPage).toContain('{ id: "mine", label: "My Groups" }');
    expect(messagesPage).toContain('{ id: "groups", label: "Groups", icon: UsersRound }');
  });

  it("uses Group language for creation and membership", () => {
    expect(groupsPage).toContain("Create Group");
    expect(groupsPage).toContain('label="Group name"');
    expect(memberPresentation).toContain('leave_group: "Leave Group"');
    expect(memberPresentation).toContain('remove_member: "Remove from Group"');
  });

  it("uses Group language in server-returned UI feedback", () => {
    for (const copy of ["Group created.", "Group not found.", "This Group is full."]) {
      expect(groupActions, copy).toContain(copy);
    }
  });

  it("leaves no shared-space Circle copy on the canonical Group pages", () => {
    for (const [name, contents] of Object.entries({ groupsPage, groupDetail, groupActions })) {
      expect(contents, name).not.toMatch(/\bCircles?\b/);
    }
    expect(messagesPage).not.toContain('label: "Circles"');
    expect(messagesPage).not.toContain("View Circle");
  });
});

describe("private Muddy organization remains Circles", () => {
  it("keeps the Muddies Circle tab and creation flow", () => {
    expect(friendsPage).toContain('{ id: "circles", label: "Circles" }');
    expect(friendsPage).toContain("New Circle");
    expect(circleActions).toContain('from("friend_circles")');
    expect(circleActions).toContain('from("circle_members")');
  });
});

describe("stable Group architecture is unchanged", () => {
  it("keeps routes and notification destinations", () => {
    expect(appShell).toContain('href: "/groups"');
    expect(resolveNotificationDestination(`group:${GROUP}`)).toEqual({
      type: "internal",
      href: `/groups/${GROUP}`
    });
  });

  it("keeps conversation_type === 'group' as the stored identity", () => {
    expect(mobile).toContain('conversation?.conversation_type === "group"');
  });

  it("keeps action and table identifiers", () => {
    expect(memberPresentation).toContain("leave_group:");
    expect(groupActions).toContain('from("group_settings")');
  });

  it("classifies Groups from stored type, never member count", () => {
    const projection = mobile.slice(mobile.indexOf("const views: ConversationView[] = []"));
    expect(projection).toContain("kind: conversation.conversation_type");
    expect(projection).not.toContain("members.length");
    expect(projection).not.toContain("memberCount ===");
  });

  it("opens a Group at its own page, not the direct-message pane", () => {
    const open = messagesPage.slice(
      messagesPage.indexOf("function openConversation"),
      messagesPage.indexOf("function sendQuickAction")
    );
    expect(open).toContain('conversation?.kind === "group"');
    expect(open).toContain("/groups/${conversationId}");
    expect(open).toContain("setSelectedId(conversationId)");
  });

  it("keeps the Group's own name and notification route", () => {
    const titling = mobile.slice(
      mobile.indexOf('let title = "Conversation"'),
      mobile.indexOf("const membership = membershipById.get(conversation.id)")
    );
    expect(titling).toContain("groupNameByConversation.get(conversation.id)");

    const group = resolveNotificationDestination(`group:${GROUP}`);
    const direct = resolveNotificationDestination(`message:${GROUP}`);
    expect(group).not.toEqual(direct);
    expect(group?.href).toBe(`/groups/${GROUP}`);
  });
});
