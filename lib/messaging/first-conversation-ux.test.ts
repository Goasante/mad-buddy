import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * A private conversation is two people talking.
 *
 * Not a profile page, not a status showcase, and not a place to learn what
 * somebody pays.
 */

const page = stripComments(readFileSync("components/messages/messages-page.tsx", "utf8"));
const composer = stripComments(readFileSync("components/messaging/message-composer.tsx", "utf8"));
const picker = stripComments(readFileSync("components/messaging/attachment-picker.tsx", "utf8"));

/** The direct-conversation header, not the inbox rows that share components. */
const identity = page.slice(
  page.indexOf("function ConversationIdentity"),
  page.indexOf("if (!conversation.otherUsername)")
);

describe("no subscription hierarchy inside a private chat", () => {
  it("shows no plan badge beside the recipient's name", () => {
    /* A Crown told you what somebody pays, which has nothing to do with
     * talking to them, and quietly sorted friends into paid and free at the
     * top of a private conversation. */
    expect(identity).not.toContain("<PremiumPlanBadge");
  });

  it("keeps the badge available elsewhere in the product", () => {
    // Removed from this header only, not deleted from the app.
    const badge = readFileSync("components/premium/premium-plan-badge.tsx", "utf8");
    expect(badge).toContain("export function PremiumPlanBadge");
  });

  it("introduces no upsell into the empty conversation", () => {
    /* Checks visible COPY, not identifiers. A plain scan for "subscribe"
     * flagged the realtime channel's own `.subscribe()` -- banning it there
     * would force the page to avoid a Supabase API name to satisfy a copy
     * rule, which is the test dictating implementation. */
    for (const pressure of ["Upgrade", "Go Pro", "Buddy Plus", "Unlock ", "Subscribe"]) {
      expect(page).not.toContain(pressure);
    }
  });
});

describe("the trust mark stays, because it means something", () => {
  it("keeps Trusted Member on the recipient", () => {
    // A safety signal about the person, not a purchase.
    expect(identity).toContain("<TrustedMemberMark");
  });

  it("announces itself rather than being decoration", () => {
    const mark = readFileSync("components/trust/trusted-member-mark.tsx", "utf8");
    expect(mark).toContain('aria-label="Trusted Member"');
    expect(mark).toContain('role="img"');
  });
});

describe("the empty state names the relationship", () => {
  const empty = page.slice(page.indexOf("flex h-full flex-col items-center justify-center px-8"));

  it("says what the header does not", () => {
    expect(empty).toContain("are Muddies.");
  });

  it("invites without speaking for the user", () => {
    expect(empty).toContain("Say hi when you're ready.");
  });

  it("prefills nothing and suggests no wording", () => {
    for (const banned of ['draft="Hi', "setDraft(\"Hi", "suggestedMessage", "prefill"]) {
      expect(page).not.toContain(banned);
    }
  });

  it("adds no gamification", () => {
    for (const banned of ["confetti", "XP", "streak", "points earned"]) {
      expect(page).not.toContain(banned);
    }
  });

  it("stays a chat, not a profile card", () => {
    const slice = empty.slice(0, 1600);
    for (const profileish of ["bio", "buddyScore", "achievement", "proximity", "distance"]) {
      expect(slice).not.toContain(profileish);
    }
  });
});

describe("the composer's left control is an attachment picker", () => {
  it("is the media control, not the sender's avatar", () => {
    expect(composer).toContain("<AttachmentPicker");
    expect(picker).toContain('aria-label="Add an attachment"');
  });

  it("looks like what it does", () => {
    // A photo glyph, not something that reads as a profile picture.
    expect(picker).toContain("<ImagePlus");
  });

  it("offers only what the product supports", () => {
    expect(picker).toContain('id: "camera"');
    expect(picker).toContain("validateImageSelection");
  });

  it("keeps a full touch target", () => {
    expect(picker).toContain("h-11 w-11");
  });
});

describe("composer behaviour", () => {
  it("addresses the recipient by name", () => {
    expect(page).toContain("Message ");
  });

  it("shows Send once there is something to send", () => {
    expect(composer).toContain("const canSendText = Boolean(draft.trim() || attachment)");
    expect(composer).toContain('aria-label="Send message"');
  });

  it("offers voice when the composer is empty", () => {
    expect(composer).toContain('aria-label="Record voice message"');
    expect(composer).toContain("canSendText || !voiceSupported");
  });

  it("cannot be double-submitted", () => {
    expect(composer).toContain("disabled={!canSendText || uploadBusy || isPending}");
  });
});

describe("the conversation owns the screen", () => {
  it("goes immersive while a thread is open", () => {
    expect(page).toContain("useImmersiveWhile");
  });

  it("keeps the launcher off an open conversation", async () => {
    const { showsQuickActions } = await import("@/lib/navigation/quick-actions");
    expect(showsQuickActions("/messages/abc")).toBe(false);
  });

  it("respects the safe area at the top of the header", () => {
    expect(page).toContain("env(safe-area-inset-top)");
  });
});

describe("no location ever appears in a conversation", () => {
  it("leaks no distance or proximity", () => {
    for (const leak of [" km", "metres", "coordinates", "proximity_band", "latitude"]) {
      expect(page).not.toContain(leak);
    }
  });
});
