import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments, stripFormatting } from "@/lib/content/strip-comments";
import { canViewEvent } from "@/lib/events/rules";

/**
 * Sharing an Event.
 *
 * ONE PROPERTY MATTERS MOST: sharing is transport, not permission. Handing
 * somebody a URL must never widen what they may see -- otherwise "anyone with
 * the link" would be the only audience that ever really existed, and every
 * other one would be a suggestion.
 */

const read = (path: string) => stripComments(readFileSync(path, "utf8"));
const flat = (path: string) => stripFormatting(readFileSync(path, "utf8"));

const share = read("components/events/event-share.tsx");
const shareFlat = flat("components/events/event-share.tsx");
const detail = read("components/events/event-detail.tsx");
const actions = read("app/(app)/event-actions.ts");
const page = flat("components/events/events-page.tsx");

// ---------------------------------------------------------------------------
// The property itself
// ---------------------------------------------------------------------------

describe("a share URL never widens access", () => {
  const HOST = "host-1";
  const OUTSIDER = "outsider-1";

  it("still refuses an invite-only Event to somebody who was not invited", () => {
    /* Forwarding the link is exactly the scenario: the recipient holds a valid
     * URL and is still not an invitee. */
    expect(
      canViewEvent({ visibility: "invite", hostId: HOST, isInvited: false, status: "scheduled" }, OUTSIDER)
    ).toBe(false);
    expect(
      canViewEvent({ visibility: "invite", hostId: HOST, isInvited: true, status: "scheduled" }, OUTSIDER)
    ).toBe(true);
  });

  it("still requires membership for a targeted community Event", () => {
    /* BOTH SIDES, deliberately. Asserting only the refusal let a mutation that
     * returned `true` unconditionally slip through -- the test passed while
     * every targeted community Event was open to everybody. A rule is only
     * pinned when its yes and its no are both stated. */
    const targeted = (isMember: boolean) =>
      canViewEvent(
        {
          visibility: "community",
          hostId: HOST,
          hasCommunityTarget: true,
          isCommunityMember: isMember,
          status: "scheduled"
        },
        OUTSIDER
      );
    expect(targeted(false)).toBe(false);
    expect(targeted(true)).toBe(true);

    // An untargeted community Event has no audience authority and fails closed.
    expect(
      canViewEvent(
        { visibility: "community", hostId: HOST, hasCommunityTarget: false, status: "scheduled" },
        OUTSIDER
      )
    ).toBe(false);
  });

  it("opens a link Event for whoever holds the link -- that is the audience", () => {
    expect(canViewEvent({ visibility: "link", hostId: HOST, status: "scheduled" }, OUTSIDER)).toBe(true);
  });

  it("does not turn a Nearby Event into a Public one", () => {
    // Nearby remains its own audience; sharing does not reclassify it.
    expect(canViewEvent({ visibility: "nearby", hostId: HOST, status: "scheduled" }, OUTSIDER)).toBe(true);
    expect(canViewEvent({ visibility: "nearby", hostId: HOST, status: "draft" }, OUTSIDER)).toBe(false);
  });

  it("refuses a draft to everybody but its host", () => {
    expect(canViewEvent({ visibility: "public", hostId: HOST, status: "draft" }, OUTSIDER)).toBe(false);
    expect(canViewEvent({ visibility: "public", hostId: HOST, status: "draft" }, HOST)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The share surface
// ---------------------------------------------------------------------------

describe("every published Event can be shared", () => {
  it("offers Share to any viewer, not only the host", () => {
    /* Safe precisely BECAUSE sharing is transport: an attendee passing on an
     * invite-only Event grants nobody anything. */
    expect(detail).toContain("<EventShare");
    const block = flat("components/events/event-detail.tsx");
    expect(block).toContain('shareable={event.status !== "draft"}');
  });

  it("says a draft is not shareable rather than offering a dead link", () => {
    expect(share).toContain("Not shareable yet");
    expect(share).toContain("Publish this event and its link becomes active.");
  });

  it("reuses the existing Event URL rather than minting a second identity", () => {
    /* Event ids are gen_random_uuid() -- 122 bits, not enumerable -- and
     * canViewEvent already governs direct access. A share-token table would add
     * a lookup and a revocation story for no security gain. */
    expect(share).toContain("export function eventShareUrl");
    expect(share).toContain("/events/${eventId}");
    expect(share).not.toContain("share_token");
  });

  it("offers in-app, copy and platform share", () => {
    expect(share).toContain("Send in Mad Buddy");
    expect(share).toContain("Copy link");
    expect(share).toContain("shareInvite(");
    // The Web Share API is used where it exists, never required.
    expect(share).toContain("navigator.clipboard.writeText");
  });

  it("confirms a copy in words, not only with a tick", () => {
    expect(share).toContain('role="status"');
    expect(share).toContain("Link copied");
  });
});

// ---------------------------------------------------------------------------
// In-app sharing
// ---------------------------------------------------------------------------

describe("sharing into a chat reuses canonical messaging", () => {
  it("hands the message to sendMessage rather than writing its own", () => {
    // Membership, blocks, rate limiting and moderation already live there.
    expect(actions).toContain('const { sendMessage } = await import("@/lib/messaging/mobile");');
    expect(shareFlat).toContain("getConversationsAction()");
  });

  it("refuses to share an Event the sender cannot see", () => {
    /* Otherwise posting an id into a chat would be a way to surface an Event
     * the sender was never allowed to know about. */
    const action = actions.slice(actions.indexOf("export async function shareEventToConversationAction"));
    expect(action.slice(0, 1600)).toContain("const view = await getEventViewForViewer(userId, eventId);");
    expect(action.slice(0, 1600)).toContain('if (!view) return { ok: false, message: "Event not found." };');
  });

  it("refuses to share a draft", () => {
    const action = actions.slice(actions.indexOf("export async function shareEventToConversationAction"));
    expect(action.slice(0, 1600)).toContain('if (view.status === "draft")');
  });

  it("supplies every field sendMessage requires", () => {
    /* THE BUG. clientMessageId is REQUIRED by sendMessageSchema and the share
     * action omitted it, so the whole call failed schema validation and no row
     * was ever written -- while the sheet showed only "Check your message and
     * try again." Nothing distinguished it from a message the server refused
     * on its merits, and no test noticed because the tests read source, not
     * the messages table.
     *
     * Pinned against the SCHEMA rather than a hardcoded list, so a new required
     * field added to sendMessage fails here instead of silently breaking
     * sharing again. */
    const messaging = read("lib/messaging/mobile.ts");
    const schema = messaging.slice(
      messaging.indexOf("export const sendMessageSchema"),
      messaging.indexOf("function serviceRoleEnvMessage")
    );
    /* Fields are read as BLOCKS, not lines. A field's `.optional()` frequently
     * sits several lines below its name (quickActionType spans four), so a
     * line-wise filter reports optional fields as required and the test fails
     * on fields the action is right to omit. */
    const fields = schema.split(/\n  (?=\w+:)/).slice(1);
    const required = fields
      .filter((block) => !block.includes(".optional()"))
      .map((block) => block.split(":")[0].trim());

    expect(required.length).toBeGreaterThan(0);
    expect(required).toContain("clientMessageId");

    const action = actions.slice(actions.indexOf("export async function shareEventToConversationAction"));
    const call = action.slice(action.indexOf("await sendMessage("), action.indexOf("await sendMessage(") + 1200);
    for (const field of required) {
      expect(call).toContain(field);
    }
  });

  it("gives each share its own message id rather than a derived one", () => {
    /* A key derived from (sender, event, conversation) would dedupe FOREVER:
     * the first share would land and every later one would silently no-op,
     * because sendMessage returns the original row for a repeated id. Sharing
     * the same Event into the same chat next week is legitimate. */
    const action = actions.slice(actions.indexOf("export async function shareEventToConversationAction"));
    expect(action.slice(0, 2600)).toContain("clientMessageId: crypto.randomUUID()");
  });

  it("tells the sender that access does not travel with the link", () => {
    expect(share).toContain("Sharing sends the link. Who can open it does not change.");
  });
});

// ---------------------------------------------------------------------------
// The publish moment
// ---------------------------------------------------------------------------

describe("post-publish says what actually happens next", () => {
  it("gives the link audience its own promise", () => {
    expect(page).toContain("Only people with this link can open your event.");
  });

  it("does not tell a Nearby or Invited host their Event is broadly live", () => {
    /* "Your event is live" is true for Public and misleading for the rest, so
     * each audience states its own consequence. */
    expect(page).toContain("People around your event location can discover it.");
    expect(page).toContain("The people you invited can now open it.");
    expect(page).toContain("Members of the community you chose can now find it.");
  });
});
