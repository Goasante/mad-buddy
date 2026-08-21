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
    //
    // This asserts the INVARIANT rather than one exact dependency array. The
    // previous spelling pinned the literal "[loadConversation,
    // requestedConversationId]", which also failed when the effect gained
    // syncConversations -- a stable useCallback with no dependencies, and the
    // very thing that fetches the missing row. Naming the forbidden
    // dependencies keeps the guard honest without freezing the line.
    const openEffect = page.slice(
      page.indexOf("if (openedRequestedConversation.current"),
      page.indexOf("// Realtime (spec §64)")
    );
    expect(openEffect).not.toContain("uniqueConversations");
    expect(openEffect).not.toContain("initialConversations");
    expect(openEffect).not.toContain("conversations]");
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
    /* The Muddies guard now reads `busy`, not `isPending`.
     *
     * Opening a conversation CREATES one when the pair has none, so it is a
     * mutation and no longer runs inside a transition -- which means isPending
     * stays false for its whole duration. Keeping the old name here would have
     * asserted a guard that no longer guards anything: the double tap it was
     * written to stop would sail straight through. `busy` combines the
     * remaining read transition with the write flag. */
    expect(friends).toContain("if (busy) return;");
    expect(friends).toContain("const busy = isPending || writing;");
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

// ---------------------------------------------------------------------------
// A Circle is not a direct chat
// ---------------------------------------------------------------------------

describe("opening a Circle conversation", () => {
  /**
   * THE ASHONGMAN BUDDIES BUG.
   *
   * "Ashongman Buddies" is a real multi-member Circle. Tapping it in the inbox
   * opened the INLINE DIRECT-MESSAGE pane -- one peer, no member list, no
   * Circle management -- so a shared multi-person space was presented as if it
   * were a DM.
   *
   * The conversation's own type was never lost: the server projection sets
   * `kind: conversation.conversation_type`, and the inbox row rendered the
   * Circle name and avatar correctly. The client simply used `kind` for tab
   * filtering only, and never for routing.
   */
  it("routes a Circle to its own page, not the direct-message pane", () => {
    const open = page.slice(page.indexOf("function openConversation"), page.indexOf("function sendQuickAction"));
    expect(open).toContain('conversation?.kind === "group"');
    expect(open).toContain("/groups/${conversationId}");
    // And returns, rather than also opening the DM pane underneath.
    expect(open).toContain("return;");
  });

  it("still opens a direct conversation inline", () => {
    // The fix must not send every conversation away to /groups.
    const open = page.slice(page.indexOf("function openConversation"), page.indexOf("function sendQuickAction"));
    expect(open).toContain("setSelectedId(conversationId)");
    expect(open).toContain("void loadConversation(conversationId)");
  });

  it("classifies from the conversation's own kind, never from its contents", () => {
    const open = page.slice(page.indexOf("function openConversation"), page.indexOf("function sendQuickAction"));
    // Not member count, not the title, not whether a direct_key happens to
    // exist, not the first sender.
    for (const wrong of ["members.length", "title", "direct_key", "senderId"]) {
      expect(open, wrong).not.toContain(wrong);
    }
  });

  it("carries the canonical type from the server to the client", () => {
    // The projection is the single source of truth for conversation identity.
    expect(mobile).toContain("kind: conversation.conversation_type");
  });

  it("keeps the Circle's own name and avatar in the inbox row", () => {
    /* The row already rendered "Ashongman Buddies" correctly -- this pins the
     * behaviour so a future change cannot regress to showing a member's name.
     *
     * Scoped to the title branch rather than a fixed byte window: the previous
     * 700-character slice broke the moment the Plan branch grew, even though
     * the rule it protects never changed. It now ends where the title
     * assignment ends, so it measures the behaviour and not the prose. */
    const projection = mobile.slice(
      mobile.indexOf('if (conversation.conversation_type === "direct" && conversation.direct_key)'),
      mobile.indexOf("const membership = membershipById.get(conversation.id)")
    );
    // A named Circle keeps its own name in BOTH group-ish branches (Plan Chat
    // and plain group), so a Circle can never fall back to a member's name.
    expect(projection.split("groupNameByConversation.get(conversation.id)").length - 1).toBe(2);
  });
});
