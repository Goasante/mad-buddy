import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

const home = read("components/dashboard/dashboard-page.tsx");
const nearbyRoute = read("app/api/friends/nearby/route.ts");
const nearbyService = read("lib/proximity/nearby-service.ts");
const muddies = read("components/friends/friends-page.tsx");
const muddyLoader = read("app/(app)/friends/page.tsx");
const linkrCollections = read("components/linkr/linkr-collections.tsx");
const linkrSettings = read("components/linkr/linkr-settings.tsx");
const linkrCandidate = read("components/linkr/candidate-card.tsx");
const profileModal = read("components/glow/muddy-profile-modal.tsx");
const publicProfile = read("components/friends/muddy-profile-page.tsx");
const selfProfile = read("components/profile/profile-page.tsx");
const chatPage = read("components/messages/messages-page-v4.tsx");
const chatRow = read("components/messaging/conversation-row-v4.tsx");
const chatSettings = read("components/messaging/chat-settings-v4.tsx");
const groupMessages = read("components/messaging/message-bubble-v4.tsx");

describe("identity badge placement", () => {
  it("shows Verified first and Trusted second on full profiles", () => {
    for (const profile of [publicProfile, selfProfile, profileModal]) {
      const verified = profile.indexOf("<VerifiedAccountMark");
      const trusted = profile.indexOf("<TrustedMemberMark");
      expect(verified).toBeGreaterThan(-1);
      expect(trusted).toBeGreaterThan(verified);
    }
  });

  it("batches public identity state into the Home Glow projection", () => {
    for (const source of [nearbyRoute, nearbyService]) {
      expect(source).toContain('.from("account_verifications")');
      expect(source).toContain('.eq("status", "verified")');
      expect(source).toContain("trusted_member_since");
    }
    expect(home).toContain("friend.is_verified_account");
    expect(home).toContain("friend.trusted_since");
  });

  it("shows only verification beside names on Home and Muddies rows", () => {
    expect(home).toContain("<VerifiedAccountMark isVerifiedAccount={heroFriend.isVerifiedAccount} compact />");
    expect(home).toContain("<VerifiedAccountMark isVerifiedAccount={friend.isVerifiedAccount} compact inControl />");
    expect(muddies).toContain("<VerifiedAccountMark isVerifiedAccount={user.isVerifiedAccount} compact inControl />");
    expect(muddyLoader.match(/isVerifiedAccount: verifiedByUserId\.get\(profileId\)/g)).toHaveLength(2);
    expect(muddies).not.toContain('import { TrustedMemberMark }');
  });

  it("shows verification, but not Trusted Member, across Linkr identities", () => {
    for (const source of [linkrCollections, linkrSettings, linkrCandidate]) {
      expect(source).toContain("<VerifiedAccountMark");
      expect(source).not.toContain('import { TrustedMemberMark }');
    }
  });

  it("shows only verification across the live Chats identity surfaces", () => {
    expect(chatRow).toContain("conversation.otherIsVerifiedAccount");
    expect(chatPage).toContain("selected.otherIsVerifiedAccount");
    expect(chatSettings).toContain("conversation.otherIsVerifiedAccount");
    expect(groupMessages).toContain("message.senderIsVerifiedAccount");
    for (const source of [chatPage, chatRow, chatSettings, groupMessages]) {
      expect(source).not.toContain('import { TrustedMemberMark }');
    }
  });
});
