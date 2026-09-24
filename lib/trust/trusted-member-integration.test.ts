import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

/**
 * Guards for the seed script, the identity integrations, and photo reorder.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const seed = read("scripts/seed-trusted-application.mjs");
const messaging = stripComments(read("lib/messaging/mobile.ts"));
const groupPage = stripComments(read("components/groups/group-detail-page.tsx"));
const groupActions = stripComments(read("app/(app)/group-actions.ts"));
/* The photo mutation bodies moved to lib/profile/photo-gallery-service.ts so
   the native app can reach them through /api/profile/photos; the Server Action
   now delegates. These assertions follow the behaviour rather than relaxing. */
const photoActions = stripComments(read("lib/profile/photo-gallery-service.ts"));
const carousel = stripComments(read("components/profile/profile-photo-carousel.tsx"));
const reorderMigration = read("supabase/migrations/20260808240000_profile_photo_reorder.sql");

// ---------------------------------------------------------------------------
// The seed is a backdoor to the QUEUE, never to the badge
// ---------------------------------------------------------------------------

describe("the seed cannot grant Trusted status", () => {
  it("never writes trusted_member_since", () => {
    // The badge is granted by approving through the real admin action, which
    // is the thing under test. A script that set it directly would test
    // nothing.
    expect(seed).not.toContain("trusted_member_since:");
  });

  it("creates the application as pending", () => {
    expect(seed).toContain('status: "pending"');
  });

  it("is idempotent, so re-running resets rather than duplicating", () => {
    expect(seed).toContain('{ onConflict: "user_id" }');
  });

  it("marks the row as test data where a reviewer will see it", () => {
    expect(seed).toContain("[TEST DATA]");
  });

  it("never touches real premium history or journey progress", () => {
    expect(seed).not.toContain('from("subscriptions")');
    expect(seed).not.toContain('from("user_journeys")');
  });

  it("cleans up only its own row, matched on the marker", () => {
    // A genuine application from the same person must survive cleanup.
    expect(seed).toContain('.eq("note", TEST_NOTE)');
  });

  it("refuses to clear a badge granted by a real approval", () => {
    // That is real state from a real action; removing it is a decision for
    // the admin queue, not a cleanup script.
    expect(seed).toContain("this script will not touch it");
  });
});

describe("production eligibility is untouched", () => {
  it("leaves the premium threshold where it was", () => {
    const rules = read("lib/trust/trusted-member.ts");
    expect(rules).toContain("TRUSTED_MEMBER_MIN_PREMIUM_DAYS = 90");
  });
});

// ---------------------------------------------------------------------------
// Messaging and group identity
// ---------------------------------------------------------------------------

describe("messaging identity carries the mark without N+1", () => {
  it("extends the existing batched sender read", () => {
    // One query per page, never one per message.
    expect(messaging).toContain(
      '.select("user_id, full_name, avatar_url, username, trusted_member_since")'
    );
  });

  it("keeps three signals separate on the sender line", () => {
    // Premium is a plan, Trusted Member is standing, Owner/Admin is authority
    // in this group. Merging any two would make one imply the others.
    expect(messaging).toContain("senderTrustedSince");
    expect(messaging).toContain("senderPlan");
    expect(messaging).toContain("senderRole");
  });

  it("keeps Trusted Member off the compact group sender header", () => {
    expect(groupPage).not.toContain("<TrustedMemberMark");
  });

  it("renders the verified-account badge beside the sender identity", () => {
    expect(groupPage).toContain("<VerifiedAccountMark isVerifiedAccount={message.senderIsVerifiedAccount} compact />");
  });

  it("uses only the compact verified mark for trust on that line", () => {
    expect(groupPage).toContain("<VerifiedAccountMark isVerifiedAccount={message.senderIsVerifiedAccount} compact />");
  });
});

describe("direct messages carry the mark at the identity surface", () => {
  const dm = stripComments(read("components/messages/messages-page.tsx"));

  it("reads the partner's standing in the existing batched profile read", () => {
    // The same read that already resolves the DM title and avatar. A second
    // query, or one per conversation row, would be an N+1 down the list.
    expect(messaging).toContain(
      '.select("user_id, full_name, username, avatar_url, trusted_member_since")'
    );
  });

  it("resolves standing only for direct chats", () => {
    // A group has no single "other person"; its senders carry their own mark.
    const projection = messaging.slice(messaging.lastIndexOf("otherTrustedSince:"));
    expect(projection.slice(0, 260)).toContain('conversation.conversation_type === "direct"');
  });

  it("keeps Trusted Member off the thread header", () => {
    expect(dm).not.toContain("<TrustedMemberMark");
  });

  it("shows verification instead of Trusted Member in the conversation list", () => {
    expect(dm).toContain("<VerifiedAccountMark isVerifiedAccount={conversation.otherIsVerifiedAccount} compact />");
  });

  it("renders the verified-account badge in the conversation list and header", () => {
    expect(dm).toContain("<VerifiedAccountMark isVerifiedAccount={conversation.otherIsVerifiedAccount} compact />");
  });

  it("keeps premium and verification as separate marks", () => {
    expect(dm).toContain("<PremiumPlanBadge plan={conversation.otherPlan} compact />");
    expect(dm).toContain("<VerifiedAccountMark");
  });

  it("does not reorder conversations by standing", () => {
    // The list is ordered by recency. Standing never buys a position in it.
    const ordering = messaging.slice(messaging.indexOf("last_message_at"));
    expect(ordering.slice(0, 400)).not.toContain("trusted");
  });
});

describe("group member lists keep standing out of the compact identity row", () => {
  it("extends the existing batched member read", () => {
    expect(groupActions).toContain(
      '.select("user_id, full_name, username, avatar_url, trusted_member_since")'
    );
  });

  it("renders verification and not Trusted Member beside the member name", () => {
    expect(groupPage).toContain("<VerifiedAccountMark isVerifiedAccount={member.isVerifiedAccount} compact />");
    expect(groupPage).not.toContain("<TrustedMemberMark");
  });

  it("leaves ordering as Owner, Admins, Members, then name", () => {
    // Standing never buys a position in the list.
    const ordering = stripComments(read("lib/groups/member-presentation.ts"));
    expect(ordering).not.toContain("trusted");
  });
});

// ---------------------------------------------------------------------------
// Photo reorder
// ---------------------------------------------------------------------------

describe("reorder moves a slot, never the photo identity", () => {
  const reorder = photoActions.slice(
    photoActions.indexOf("export async function reorderProfilePhoto")
  );
  /* The swap itself moved into SQL. It used to be three un-transacted writes
     in TypeScript, with the error on the middle one ignored; it is now one
     transactional RPC, so the assertions about parking, idempotence and
     ownership follow it into the migration. */
  const reorderRpc = read("supabase/migrations/20260914120000_reorder_profile_photo_rpc.sql");

  it("never touches visibility", () => {
    // Visibility belongs to the PHOTO, not the slot: moving a private picture
    // into first position must never make it public.
    expect(reorder).not.toContain("visibility");
  });

  it("never re-uploads or changes the media asset", () => {
    expect(reorder).not.toContain("media_asset_id");
    expect(reorder).not.toContain("processImageUpload");
  });

  it("scopes every write to the caller's own rows", () => {
    // The caller scopes its ownership lookup; the RPC scopes all three writes
    // inside the transaction, so a valid photo id from anywhere is still not
    // movable by anyone.
    expect(reorder).toContain('.eq("user_id", userId)');
    expect((reorderRpc.match(/and user_id = v_owner_id/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("verifies ownership before moving anything", () => {
    expect(reorder).toContain('.eq("id", parsed.data.photoId)');
  });

  it("is idempotent when the photo is already there", () => {
    expect(reorderRpc).toContain("if v_current_position = p_new_position then");
    expect(reorderRpc).toContain("return query select true, 'Updated.'::text;");
  });

  it("rejects a position outside the gallery cap", () => {
    expect(photoActions).toContain("newPosition: z.number().int().min(0).max(2)");
  });

  it("parks at -1 so the swap cannot collide on the slot constraint", () => {
    // Two direct updates would violate unique (user_id, position) whichever
    // order they ran in.
    expect(reorderRpc).toContain("set position = -1");
    expect(reorderMigration).toContain("check (position between -1 and 2)");
  });

  it("keeps the cap rather than dropping the check", () => {
    // The range check is what caps the gallery at three.
    expect(reorderMigration).toContain("add constraint profile_photos_position_check");
  });
});

describe("the reorder controls are reachable", () => {
  it("offers buttons rather than drag alone", () => {
    // Drag is unreachable by keyboard and awkward on a three-item strip.
    expect(carousel).toContain("Move photo ${active + 1} earlier");
    expect(carousel).toContain("Move photo ${active + 1} later");
  });

  it("adds no drag-and-drop dependency", () => {
    const packageJson = read("package.json");
    for (const dep of ["react-beautiful-dnd", "dnd-kit", "react-dnd", "sortablejs"]) {
      expect(packageJson).not.toContain(dep);
    }
  });

  it("disables at the ends rather than hiding, so the row does not reflow", () => {
    expect(carousel).toContain("current.position === 0");
    expect(carousel).toContain("current.position >= count - 1");
  });

  it("follows the moved photo rather than staying on the slot", () => {
    expect(carousel).toContain("setIndex(target)");
  });
});
