import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveNotificationDestination } from "@/lib/notifications/destination";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const mobile = read("lib/messaging/mobile.ts");
const messagesPage = read("components/messages/messages-page.tsx");
const groupsPage = read("components/groups/groups-page.tsx");
const groupDetail = read("components/groups/group-detail-page.tsx");
const appShell = read("components/app-shell/app-shell.tsx");
const memberPresentation = read("lib/groups/member-presentation.ts");
const groupActions = read("app/(app)/group-actions.ts");

const CIRCLE = "8b9e9e41-97c3-4e57-a3c2-d9333db3e134";

/**
 * Groups are Circles in the product; `group` stays in the code.
 *
 * The split is deliberate and documented: renaming tables, routes, RPCs and
 * conversation_type would be a destructive migration for a vocabulary change.
 * These tests pin the boundary in both directions -- copy must say Circle,
 * internals must keep working.
 */

describe("what a person reads says Circle", () => {
  it("names the section Circles in navigation and page headers", () => {
    expect(appShell).toContain('label: "Circles"');
    expect(groupsPage).toContain('<PageHeader title="Circles" />');
    expect(groupsPage).toContain('{ id: "mine", label: "My Circles" }');
  });

  it("names creation and membership in Circle language", () => {
    expect(groupsPage).toContain("Create Circle");
    expect(groupsPage).toContain('label="Circle name"');
    expect(memberPresentation).toContain('leave_group: "Leave Circle"');
    expect(memberPresentation).toContain('remove_member: "Remove from Circle"');
  });

  it("names the Circle conversation filter Circles", () => {
    expect(messagesPage).toContain('{ id: "groups", label: "Circles", icon: UsersRound }');
  });

  it("speaks Circle in server-returned messages", () => {
    // These strings surface directly in the UI as feedback.
    for (const copy of ["Circle created.", "Circle not found.", "This Circle is full."]) {
      expect(groupActions, copy).toContain(copy);
    }
  });

  it("leaves no user-facing 'group' copy on the Circle surfaces", () => {
    // Scoped to quoted UI strings on these two files, not a repo-wide ban:
    // internal `group` identifiers are correct and must survive.
    for (const [name, source] of Object.entries({ groupsPage, groupDetail })) {
      const uiCopy = [...source.matchAll(/(?:title|label|placeholder|description)="([^"]*)"/g)].map((m) => m[1]);
      const offenders = uiCopy.filter((text) => /\bgroups?\b/i.test(text));
      expect(offenders, `${name}: ${offenders.join(" | ")}`).toEqual([]);
    }
  });
});

describe("the code keeps its stable group names", () => {
  it("keeps the route, so old links and notifications still resolve", () => {
    expect(appShell).toContain('href: "/groups"');
    expect(resolveNotificationDestination(`group:${CIRCLE}`)).toEqual({
      type: "internal",
      href: `/groups/${CIRCLE}`
    });
  });

  it("keeps conversation_type === 'group' as the stored identity", () => {
    expect(mobile).toContain('conversation?.conversation_type === "group"');
  });

  it("keeps internal action and table identifiers", () => {
    // Renaming these would be a migration, not a vocabulary change.
    expect(memberPresentation).toContain("leave_group:");
    expect(groupActions).toContain('from("group_settings")');
  });
});

describe("a Circle conversation stays a Circle", () => {
  it("classifies from stored type, never from member count", () => {
    const projection = mobile.slice(mobile.indexOf("const views: ConversationView[] = []"));
    expect(projection).toContain("kind: conversation.conversation_type");
    // A two-member Circle is still a Circle. Nothing may count members.
    expect(projection).not.toContain("members.length");
    expect(projection).not.toContain("memberCount ===");
  });

  it("opens a Circle at its own page, not the direct-message pane", () => {
    const open = messagesPage.slice(
      messagesPage.indexOf("function openConversation"),
      messagesPage.indexOf("function sendQuickAction")
    );
    expect(open).toContain('conversation?.kind === "group"');
    expect(open).toContain("/groups/${conversationId}");
  });

  it("keeps a direct conversation direct", () => {
    const open = messagesPage.slice(
      messagesPage.indexOf("function openConversation"),
      messagesPage.indexOf("function sendQuickAction")
    );
    expect(open).toContain("setSelectedId(conversationId)");
  });

  it("shows the Circle's own name, not a member's", () => {
    /* Bounded by the end of the titling block rather than a fixed 800
     * characters: the Plan Chat branch grew between the two, and the old
     * window started failing while the rule it guards -- a named Circle keeps
     * its own name -- never changed. */
    const titling = mobile.slice(
      mobile.indexOf('let title = "Conversation"'),
      mobile.indexOf("const membership = membershipById.get(conversation.id)")
    );
    expect(titling).toContain("groupNameByConversation.get(conversation.id)");
  });

  it("routes Circle notifications to the Circle, not the DM inbox", () => {
    expect(mobile).toContain('const isGroup = conversation?.conversation_type === "group"');
    const circle = resolveNotificationDestination(`group:${CIRCLE}`);
    const direct = resolveNotificationDestination(`message:${CIRCLE}`);
    expect(circle).not.toEqual(direct);
    expect(circle?.href).toBe(`/groups/${CIRCLE}`);
  });
});
