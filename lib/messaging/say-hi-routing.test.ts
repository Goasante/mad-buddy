import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { conversationHref } from "@/lib/messaging/open-conversation";

/**
 * Say hi has to land somewhere that exists.
 *
 * It navigated to `/messages/{id}` -- a path segment with no route behind it,
 * because the inbox is a single page that reads `?conversation=`. Every first
 * social action in the product ended on the 404, and the tests passed because
 * they asserted the string that was written rather than a route that resolves.
 */

const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));

describe("the route the app actually has", () => {
  it("has no [id] segment under /messages", () => {
    /* THE ROOT CAUSE, asserted directly. If somebody later adds this segment
     * the query-param contract below stops being the only truth, and this
     * test should be revisited deliberately rather than silently. */
    expect(existsSync("app/(app)/messages/[id]/page.tsx")).toBe(false);
    expect(existsSync("app/(app)/messages/page.tsx")).toBe(true);
  });

  it("opens a conversation through a query parameter", () => {
    expect(conversationHref("abc")).toBe("/messages?conversation=abc");
  });

  it("is read by the Messages page as ?conversation=", () => {
    const page = readFileSync("components/messages/messages-page.tsx", "utf8");
    expect(page).toContain('searchParams.get("conversation")');
  });
});

describe("Home uses the canonical helper", () => {
  it("navigates through conversationHref", () => {
    expect(home).toContain("router.push(conversationHref(result.conversationId))");
    expect(home).toContain('from "@/lib/messaging/open-conversation"');
  });

  it("builds no message URL by hand", () => {
    /* One spelling of the destination. Home was the only surface constructing
     * its own, which is how it got a different answer from the rest of the
     * product. */
    expect(home).not.toMatch(/["'`]\/messages\/\$\{/);
    expect(home).not.toContain("`/messages/");
  });

  it("agrees with the surfaces that already worked", () => {
    // Three existing "message this person" affordances use the same contract.
    for (const path of [
      "components/friends/friends-page.tsx",
      "components/friends/muddy-profile-page.tsx",
      "components/glow/muddy-profile-modal.tsx"
    ]) {
      expect(readFileSync(path, "utf8")).toContain("conversationHref(result.conversationId)");
    }
  });

  it("creates no activation-specific messaging route", () => {
    expect(existsSync("app/(app)/activation")).toBe(false);
    expect(home).not.toContain("/say-hi");
  });
});

describe("navigation happens only on a real conversation", () => {
  const action = home.slice(
    home.indexOf("function runRelationshipAction"),
    home.indexOf("RSVP from the Home plan stack")
  );

  it("requires both success and an id before routing", () => {
    expect(action).toContain("if (!result.ok || !result.conversationId)");
  });

  it("stays on Home and reports a failure", () => {
    // Never navigate to an undefined route to hide an error.
    expect(action).toContain("showPromptFeedback(result.message, true)");
    const guard = action.indexOf("if (!result.ok");
    const push = action.indexOf("router.push(conversationHref");
    expect(guard).toBeLessThan(push);
  });

  it("resolves the conversation through the canonical action", () => {
    expect(action).toContain("openDirectConversationAction(muddyId)");
  });

  it("creates no conversation of its own", () => {
    for (const banned of ["getOrCreateDirectConversation", 'from("conversations")', "direct_key"]) {
      expect(action).not.toContain(banned);
    }
  });
});

describe("opening still is not social value", () => {
  it("records no milestone on the way to the conversation", () => {
    /* 3D.1A's boundary, re-asserted here because a routing change is exactly
     * the kind of edit that would casually move it. */
    expect(home).not.toContain("first_message_sent");
    expect(home).not.toContain("recordMilestone");
  });

  it("keeps the milestone at the send boundary", () => {
    const messaging = stripComments(readFileSync("lib/messaging/mobile.ts", "utf8"));
    const open = messaging.slice(
      messaging.indexOf("export async function openDirectConversation"),
      messaging.indexOf("export async function sendMessage")
    );
    expect(open).not.toMatch(/recordMilestone|Milestone\s*\(|first_message_sent/);
  });
});

describe("authorization is untouched", () => {
  it("keeps eligibility on the server, not in the URL", () => {
    /* A correct URL must not be a way in: the page re-authorises whatever id
     * it is handed, so guessing one fails closed. */
    const page = readFileSync("components/messages/messages-page.tsx", "utf8");
    expect(page).toContain("loadConversation");
    const service = readFileSync("lib/messaging/service.ts", "utf8");
    expect(service).toContain("canCreateDirectConversation");
  });

  it("leaves direct-key idempotency alone", () => {
    // Tapping Say hi twice must resolve the same row, not create a second.
    const service = readFileSync("lib/messaging/service.ts", "utf8");
    expect(service).toContain("directConversationKey(senderId, recipientId)");
    expect(service).toContain('.eq("direct_key", key)');
  });
});
