import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { systemMessageText } from "@/lib/messaging/rules";
import { resolveNotificationDestination } from "@/lib/notifications/destination";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Group system events, notifications and deep links (Stage 3E).
 *
 * The rules that matter: an event states WHAT happened without naming who
 * authorised it, a retry posts nothing new, and a group notification opens the
 * group rather than the direct-message inbox.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const actions = stripComments(read("app/(app)/group-actions.ts"));
const service = stripComments(read("lib/messaging/service.ts"));
const projection = stripComments(read("lib/messaging/mobile.ts"));
const page = stripComments(read("components/groups/group-detail-page.tsx"));
const migration = read("supabase/migrations/20260807140000_group_system_events.sql");

const GROUP = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

describe("system event wording", () => {
  it("states role changes factually", () => {
    expect(systemMessageText("member_promoted", "Ama")).toBe("Ama became an admin.");
    expect(systemMessageText("member_demoted", "Ama")).toBe("Ama is no longer an admin.");
    expect(systemMessageText("ownership_transferred", "Kofi")).toBe("Ownership transferred to Kofi.");
    expect(systemMessageText("participant_removed", "Kojo")).toBe("Kojo was removed.");
    expect(systemMessageText("participant_left", "Nana")).toBe("Nana left the group.");
  });

  it("NEVER names who authorised the change", () => {
    // "Ama removed Kojo" invites a conversation about Ama's judgement; the
    // audit record in domain_events already answers "by whom".
    for (const event of ["member_promoted", "member_demoted", "participant_removed"] as const) {
      const text = systemMessageText(event, "Kojo");
      expect(text.toLowerCase()).not.toContain(" by ");
    }
  });

  it("exposes no moderation reason or internal terminology", () => {
    for (const event of ["participant_removed", "member_demoted"] as const) {
      const text = systemMessageText(event, "Kojo").toLowerCase();
      for (const forbidden of ["block", "moderat", "report", "banned", "role", "user_id"]) {
        expect(text, `${event} must not mention ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("degrades safely when the person is unknown", () => {
    expect(systemMessageText("participant_removed")).toBe("A participant was removed.");
    expect(systemMessageText("ownership_transferred")).toBe("Ownership was transferred.");
  });

  it("covers group identity changes", () => {
    expect(systemMessageText("group_renamed", "Weekend Crew")).toBe("Group renamed to Weekend Crew.");
    expect(systemMessageText("group_avatar_changed")).toBe("The group photo was updated.");
  });
});

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

describe("event emission", () => {
  it("posts only after the role change is confirmed", () => {
    // No optimistic system messages: a failed change must never leave a
    // message claiming it happened.
    const apply = actions.slice(actions.indexOf("async function applyRoleChange"));
    expect(apply.indexOf("if (error || !updated?.length)")).toBeLessThan(
      apply.indexOf("publishGroupRoleEvent")
    );
  });

  it("emits for every confirmed lifecycle action", () => {
    for (const event of [
      "member_promoted",
      "member_demoted",
      "participant_removed",
      "ownership_transferred",
      "participant_left"
    ]) {
      expect(actions).toContain(event);
    }
  });

  it("deduplicates retries with a stable key", () => {
    // Derived from the fact itself, with no timestamp: two identical facts
    // seconds apart are the same fact.
    expect(actions).toContain("`${event}:${targetId}`");
    expect(service).toContain("dedupeKey");
    expect(service).toContain("isDuplicateSystemEvent");
  });

  it("has a database index that makes dedupe real", () => {
    // A system message has no sender, so the (sender_id, client_message_id)
    // index cannot cover it — nulls never conflict.
    expect(migration).toContain("messages_system_event_dedupe_idx");
    expect(migration).toContain("where message_type = 'system'");
  });

  it("reuses the canonical system-message publisher", () => {
    expect(actions).toContain("publishSystemMessage");
    // Not a second event stream: domain_events remains the audit record.
    expect(actions).toContain('.from("domain_events")');
  });

  it("names the person with a display name only", () => {
    const helper = actions.slice(actions.indexOf("async function publishGroupRoleEvent"));
    expect(helper.slice(0, 900)).toContain("full_name");
    expect(helper.slice(0, 900)).not.toContain("username");
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("system event rendering", () => {
  it("renders centred and muted, never as a bubble", () => {
    const block = page.slice(page.indexOf('message.messageType === "system"'));
    expect(block.slice(0, 900)).toContain("text-center");
    expect(block.slice(0, 900)).toContain("text-muted-foreground");
    expect(block.slice(0, 900)).not.toContain("bg-primary");
  });

  it("does not spam screen readers on history load", () => {
    // A thread of history would otherwise announce every past role change.
    const block = page.slice(page.indexOf('message.messageType === "system"'));
    expect(block.slice(0, 900)).toContain('aria-hidden="true"');
  });

  it("carries no avatar or sender identity", () => {
    const block = page.slice(page.indexOf('message.messageType === "system"'));
    expect(block.slice(0, 900)).not.toContain("UserAvatar");
  });
});

// ---------------------------------------------------------------------------
// Notifications and deep links
// ---------------------------------------------------------------------------

describe("group notifications", () => {
  it("routes a group message to the group, not the DM inbox", () => {
    // The bug this fixes: group messages were sent as `message:<id>`, which
    // resolves to /messages — the direct-message inbox.
    expect(projection).toContain("isGroup ? `group_message:${conversationId}`");
    expect(projection).toContain("persistInApp: false");
  });

  it("resolves a group notification to the exact conversation", () => {
    expect(resolveNotificationDestination(`group_message:${GROUP}`)).toEqual({
      type: "internal",
      href: `/groups/${GROUP}`
    });
  });

  it("falls back to the Groups list for a malformed id", () => {
    // Never a dead per-item URL.
    expect(resolveNotificationDestination("group:not-a-uuid")).toEqual({
      type: "internal",
      href: "/groups"
    });
  });

  it("puts the group name in the TITLE, never the body", () => {
    // Context, not content: a recipient whose preview preference hides message
    // text still sees who and where, and never what.
    expect(projection).toContain("`${preview.title} · ${groupSettings.name}`");
  });

  it("still honours the recipient's preview privacy", () => {
    expect(projection).toContain("buildNotificationPreview");
    expect(projection).toContain("if (!preview) return;");
  });

  it("still suppresses notifications for muted members", () => {
    expect(projection).toContain("muted_until");
  });

  it("resolves the conversation type in the same batched pass", () => {
    // One extra query per send, not one per recipient.
    const notify = projection.slice(projection.indexOf("async function notifyOtherMembers"));
    expect(notify.slice(0, 1200)).toContain("Promise.all");
  });
});

// ---------------------------------------------------------------------------
// Shared Media
// ---------------------------------------------------------------------------

describe("shared media", () => {
  it("is named Shared Media", () => {
    expect(page).toContain("Shared Media");
  });

  it("still shows no Files or Links section", () => {
    expect(page).not.toContain("Shared Files");
    expect(page).not.toContain("Shared Links");
  });
});
