import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => stripComments(readFileSync(join(process.cwd(), path), "utf8"));

const groups = read("components/groups/groups-page.tsx");
const manager = read("components/groups/groups-manager-modal.tsx");
const details = read("components/groups/group-details-modal.tsx");
const messages = read("components/messages/messages-page-v4.tsx");
const shell = read("components/messages/messages-shortcuts.tsx");
const settings = read("components/messaging/chat-settings-v4.tsx");

describe("Messages owns the complete Group experience", () => {
  it("keeps creation and invitations reachable without restoring a standalone page", () => {
    expect(messages).toContain("<GroupsManagerModal");
    expect(shell).toContain("Create, manage or open a private Group");
    expect(manager).toContain("<GroupsPageContent");
    expect(groups).toContain("Create Group");
    expect(groups).toContain("Invitations");
    expect(groups).toContain("/messages?conversation=");
  });

  it("keeps member roles and shared media reachable from Group Settings", () => {
    expect(settings).toContain('title="Group details"');
    expect(messages).toContain("<GroupDetailsModal");
    expect(details).toContain("<GroupDetailPageV2");
  });

  it("does not reintroduce public or Linkr Group discovery", () => {
    expect(groups).not.toContain('label: "Discover"');
    expect(groups).not.toContain("Anyone can find it on Linkr");
    expect(groups).not.toContain('id: "public"');
    expect(groups).not.toContain("joinDiscoverableGroupAction");
  });
});
