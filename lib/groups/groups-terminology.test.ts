import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { resolveNotificationDestination } from "@/lib/notifications/destination";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const source = (path: string) => stripComments(read(path));

const projection = source("lib/messaging/mobile.ts");
const messages = source("components/messages/messages-page-v4.tsx");
const legacyGroupsRoute = source("app/(app)/groups/page.tsx");
const legacyGroupDetailRoute = source("app/(app)/groups/[id]/page.tsx");
const appShell = source("components/app-shell/app-shell.tsx");
const friendsPage = source("components/friends/friends-page.tsx");
const memberPresentation = source("lib/groups/member-presentation.ts");
const groupActions = source("app/(app)/group-actions.ts");

const GROUP = "8b9e9e41-97c3-4e57-a3c2-d9333db3e134";

describe("Groups belong to Messages", () => {
  it("keeps Groups as a Messages filter instead of a standalone navigation destination", () => {
    expect(messages).toContain('{ id: "groups", label: "Groups" }');
    expect(messages).toContain('activeFilter === "groups"');
    expect(messages).toContain('conversation.kind !== "group"');
    expect(appShell).not.toContain('href: "/groups", label: "Groups"');
  });

  it("turns the legacy hub into the Messages Groups filter", () => {
    expect(legacyGroupsRoute).toContain('redirect("/messages?tab=groups")');
  });

  it("turns ordinary legacy Group deep links into exact Messages conversations", () => {
    expect(legacyGroupDetailRoute).toContain('query.details !== "1"');
    expect(legacyGroupDetailRoute).toContain('/messages?conversation=');
    // The explicit details flag is a management sub-screen opened from the chat,
    // not a second chat implementation.
    expect(legacyGroupDetailRoute).toContain("<GroupDetailPageV2");
  });

  it("creates Groups from Messages", () => {
    expect(messages).toContain("createGroupAction({");
    expect(messages).toContain('title="New Group"');
    expect(messages).toContain("Groups are private and invitation-only");
  });

  it("keeps Group notifications on that same conversation route", () => {
    expect(resolveNotificationDestination(`group:${GROUP}`)).toEqual({
      type: "internal",
      href: `/messages?conversation=${GROUP}`
    });
  });
});

describe("Groups stay shared spaces while Circles stay personal labels", () => {
  it("keeps conversation_type === group as the stored identity", () => {
    const views = projection.slice(projection.indexOf("const views: ConversationView[] = []"));
    expect(views).toContain("kind: conversation.conversation_type");
    expect(views).not.toContain("memberCount ===");
  });

  it("keeps Group language for membership authority", () => {
    expect(memberPresentation).toContain('leave_group: "Leave Group"');
    expect(memberPresentation).toContain('remove_member: "Remove from Group"');
    expect(groupActions).toContain('from("group_settings")');
  });

  it("keeps personal Muddy organization named Circles", () => {
    expect(friendsPage).toContain('{ id: "circles", label: "Circles" }');
    expect(friendsPage).toContain("New Circle");
  });
});

describe("Groups are private by product authority", () => {
  it("forces new Groups private and invite-only on the server", () => {
    const create = groupActions.slice(
      groupActions.indexOf("export async function createGroupAction"),
      groupActions.indexOf("export async function joinDiscoverableGroupAction")
    );
    expect(create).toContain('visibility: "private"');
    expect(create).toContain('join_mode: "invite"');
    expect(create).not.toContain("parsed.data.visibility");
    expect(create).not.toContain("openToJoin");
  });

  it("refuses stale attempts to make a Group public", () => {
    const visibility = groupActions.slice(groupActions.indexOf("export async function setGroupVisibilityAction"));
    expect(visibility).toContain('parsed.data.visibility !== "private"');
    expect(visibility).toContain("Public Groups are no longer available.");
  });
});
