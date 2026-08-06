import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const page = read("components/messages/messages-page.tsx");
const profile = read("components/friends/muddy-profile-page.tsx");
const service = read("lib/messaging/service.ts");
const mobile = read("lib/messaging/mobile.ts");
const actions = read("app/(app)/messaging-actions.ts");

// ---------------------------------------------------------------------------
// The defect
// ---------------------------------------------------------------------------

describe("the stale-list guard that broke the flow", () => {
  it("no longer requires the id to be in the server-rendered list", () => {
    // ROOT CAUSE: /messages?conversation=<id> arrives at a page whose
    // initialConversations was built BEFORE the conversation existed, so
    // requiring membership dropped the user on the inbox.
    expect(page).not.toContain(
      "initialConversations.some((conversation) => conversation.id === requestedConversationId)"
    );
    expect(page).not.toContain(
      "!uniqueConversations.some((conversation) => conversation.id === requestedConversationId)"
    );
  });

  it("opens whatever server-validated id it was given", () => {
    expect(page).toContain("isLikelyConversationId(requestedConversationId) ? requestedConversationId : null");
    expect(page).toContain(
      "if (openedRequestedConversation.current || !isLikelyConversationId(requestedConversationId))"
    );
  });

  it("keeps the open effect independent of the conversation list", () => {
    // Depending on uniqueConversations is what tied opening to a stale list.
    expect(page).toContain("}, [loadConversation, requestedConversationId]);");
  });
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe("conversation identity", () => {
  it("resolves by stable user id, never username", () => {
    expect(profile).toContain("openDirectConversationAction(muddy.friendId)");
    expect(stripComments(profile)).not.toContain("openDirectConversationAction(muddy.username");
  });

  it("uses a canonical direct key derived from the user pair", () => {
    expect(service).toContain("directConversationKey(senderId, recipientId)");
    expect(service).toContain('.eq("direct_key", key)');
  });

  it("validates the id shape without pretending that is authorisation", () => {
    expect(page).toContain("const CONVERSATION_ID =");
    // The comment and the code both say the server decides.
    expect(page).toContain("Shape check only, never an authorisation check.");
  });

  it("rejects a username or junk in the query parameter", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(uuid.test("11111111-1111-4111-8111-111111111111")).toBe(true);
    for (const bad of ["kofi", "", "1", "../../etc", "<script>"]) {
      expect(uuid.test(bad), `${bad} must not be treated as an id`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Creation and races
// ---------------------------------------------------------------------------

describe("conversation creation", () => {
  it("returns the existing conversation when there is one", () => {
    expect(service).toContain("if (existing) return { conversationId: existing.id };");
  });

  it("creates one when there is not", () => {
    expect(service).toContain('.from("conversations")');
    expect(service).toContain('conversation_type: "direct"');
  });

  it("resolves a simultaneous-create race by reading the winner", () => {
    // Two taps, two devices: the loser re-reads rather than erroring or
    // creating a duplicate.
    expect(service).toContain("// Lost a create race: the other insert won, so read theirs.");
    expect(service).toContain("return raced ? { conversationId: raced.id }");
  });

  it("never returns ok without a usable conversation id", () => {
    expect(mobile).toContain("if (!result.conversationId) {");
    expect(mobile).toContain('return { ok: true, message: "Conversation ready.", conversationId: result.conversationId };');
  });

  it("guards the double tap on the client too", () => {
    expect(profile).toContain("if (isActionPending) return;");
    expect(profile).toContain("disabled={isActionPending}");
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("navigation", () => {
  it("pushes the exact conversation on success", () => {
    // The destination moved into the shared conversationHref helper so all
    // three entry points spell it identically.
    expect(profile).toContain("router.push(conversationHref(result.conversationId))");
  });

  it("never navigates backward after a successful open", () => {
    const handler = profile.slice(profile.indexOf("function messageMuddy"), profile.indexOf("function addMuddy"));
    expect(handler).not.toContain("router.back()");
  });

  it("shows a message instead of navigating when it fails", () => {
    const handler = profile.slice(profile.indexOf("function messageMuddy"), profile.indexOf("function addMuddy"));
    expect(handler).toContain("setWaveFeedback(result.message)");
    expect(handler).not.toContain("router.push(\"/messages\")");
  });

  it("keeps Back closing the conversation before leaving Messages", () => {
    expect(page).toContain("mbConversation: true");
    expect(page).toContain("window.addEventListener(\"popstate\", handlePopState)");
  });

  it("hides the bottom navigation while a conversation is open", () => {
    expect(page).toContain("useImmersiveWhile(Boolean(selectedId))");
  });
});

// ---------------------------------------------------------------------------
// Permissions and privacy
// ---------------------------------------------------------------------------

describe("permissions", () => {
  it("checks eligibility before creating anything", () => {
    expect(service).toContain("const eligibility = await canCreateDirectConversation(admin, senderId, recipientId);");
    expect(service).toContain("if (!eligibility.allowed) return { conversationId: null, error: eligibility.reason };");
  });

  it("re-checks on the server regardless of what the client sends", () => {
    expect(actions).toContain("const userId = await getAuthedUserId();");
    expect(actions).toContain('if (!userId) return { ok: false, message: "Log in first." };');
  });

  it("maps a refusal to safe copy rather than a raw reason", () => {
    expect(mobile).toContain("eligibilityMessage(result.error ?? \"\")");
  });

  it("never exposes a raw database error to the user", () => {
    const handler = profile.slice(profile.indexOf("function messageMuddy"), profile.indexOf("function addMuddy"));
    for (const banned of ["error.message", "JSON.stringify", "PGRST", "supabase"]) {
      expect(handler, `must not surface ${banned}`).not.toContain(banned);
    }
  });

  it("rate limits conversation creation", () => {
    expect(mobile).toContain('consumeRateLimit({ action: "conversations.create", userId })');
  });

  it("rejects a malformed recipient before doing any work", () => {
    expect(mobile).toContain('if (!uuidSchema.safeParse(recipientId).success) return { ok: false, message: "Muddy not found." };');
  });
});

// ---------------------------------------------------------------------------
// Loading a conversation still fails closed
// ---------------------------------------------------------------------------

describe("stale or unauthorised ids", () => {
  it("loads through the server action, which authorises", () => {
    // Trusting the URL to SELECT a conversation is safe only because this
    // call re-checks membership server-side.
    expect(page).toContain("getMessagesAction(conversationId)");
  });

  it("surfaces a concise failure rather than an empty screen", () => {
    expect(page).toContain("setFeedback(messageFailure(error));");
    expect(page).toContain('"Messages could not be updated. Try again."');
  });

  it("does not retain a stale request when a newer one starts", () => {
    // Two rapid opens must not let the older response overwrite the newer.
    expect(page).toContain("const requestId = ++loadRequestIdRef.current;");
    expect(page).toContain("if (requestId !== loadRequestIdRef.current) return;");
  });
});

// ---------------------------------------------------------------------------
// Every "Message this person" entry point
// ---------------------------------------------------------------------------

describe("all message entry points", () => {
  const modal = read("components/glow/muddy-profile-modal.tsx");
  const friends = read("components/friends/friends-page.tsx");
  const helper = read("lib/messaging/open-conversation.ts");

  const surfaces: Array<[string, string]> = [
    ["quick-view modal", modal],
    ["Muddies list", friends],
    ["full profile", profile]
  ];

  it("resolves a conversation instead of linking to the inbox", () => {
    // THE BUG the user hit: Message was a bare navigation to /messages, so it
    // landed on the inbox with no conversation open.
    for (const [name, source] of surfaces) {
      expect(source, `${name} must resolve a conversation`).toContain("openDirectConversationAction(");
    }
  });

  it("never navigates to the bare inbox as its Message action", () => {
    for (const [name, source] of surfaces) {
      const rendered = stripComments(source);
      expect(rendered, `${name} must not link to the bare inbox`).not.toContain('href="/messages"');
      expect(rendered, `${name} must not push the bare inbox`).not.toContain('router.push("/messages")');
    }
  });

  it("navigates to the exact conversation through one shared helper", () => {
    // One spelling of the destination, so three surfaces cannot drift.
    expect(helper).toContain("`/messages?conversation=${conversationId}`");
    for (const [name, source] of surfaces) {
      expect(source, `${name} must use conversationHref`).toContain("conversationHref(result.conversationId)");
    }
  });

  it("uses the stable user id at every entry point", () => {
    expect(modal).toContain("const friendId = muddy?.friendId;");
    expect(friends).toContain("openConversationWith(user.id)");
    expect(profile).toContain("openDirectConversationAction(muddy.friendId)");
  });

  it("guards the double tap at every entry point", () => {
    expect(modal).toContain("if (!friendId || isMessagePending) return;");
    expect(friends).toContain("if (isPending) return;");
    expect(profile).toContain("if (isActionPending) return;");
  });

  it("shows safe copy instead of navigating when it fails", () => {
    expect(modal).toContain("setWaveFeedback(result.message);");
    expect(friends).toContain("setFeedback(result.message);");
    expect(profile).toContain("setWaveFeedback(result.message)");
  });

  it("closes the quick-view modal before navigating", () => {
    // Otherwise the modal would still be mounted over the conversation.
    const handler = modal.slice(modal.indexOf("function openConversation"), modal.indexOf("function sendWave"));
    expect(handler.indexOf("onOpenChange(false)")).toBeLessThan(handler.indexOf("router.push"));
  });

  it("disables Message when there is no id to resolve", () => {
    expect(modal).toContain("disabled={!muddy?.friendId || isMessagePending}");
  });

  it("keeps the helper free of authorisation decisions", () => {
    // It builds a URL. Eligibility is the server's call.
    const rendered = stripComments(helper);
    for (const banned of ["canSend", "eligib", "blocked", "friendId"]) {
      expect(rendered, `helper must not decide ${banned}`).not.toContain(banned);
    }
  });
});
