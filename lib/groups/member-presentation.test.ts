import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MEMBER_ACTION_LABELS,
  memberActions,
  needsConfirmation,
  orderGroupMembers,
  ownershipCandidates,
  roleLabel
} from "@/lib/groups/member-presentation";
import type { GroupMemberView } from "@/lib/groups/types";
import type { ConversationRole, SubscriptionPlan } from "@/lib/supabase/database.types";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Group Settings & role management UI (Stage 3C).
 *
 * The rules worth testing are "never offer an action the server will reject"
 * and "premium never buys position in the list" — both invisible in a render
 * test, both a real problem if they drift.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const page = stripComments(read("components/groups/group-detail-page.tsx"));

const OWNER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";

const member = (
  userId: string,
  role: ConversationRole,
  displayName: string,
  plan: SubscriptionPlan | null = null
): GroupMemberView => ({
  userId,
  displayName,
  username: displayName.toLowerCase(),
  avatarUrl: null,
  role,
  plan,
  status: "joined"
});

const roster = [
  member(MEMBER, "member", "Zara"),
  member(OWNER, "owner", "Ama"),
  member(ADMIN, "admin", "Kofi")
];

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe("member ordering", () => {
  it("puts Owner first, then Admins, then Members", () => {
    expect(orderGroupMembers(roster).map((row) => row.role)).toEqual(["owner", "admin", "member"]);
  });

  it("PREMIUM NEVER AFFECTS ORDERING", () => {
    // Ranking paid members higher would turn a roster into a leaderboard and
    // quietly sell position in someone else's group.
    const paidLast = [
      member(MEMBER, "member", "Abena", "buddy_pro"),
      member("44444444-4444-4444-8444-444444444444", "member", "Bao", null)
    ];
    expect(orderGroupMembers(paidLast).map((row) => row.displayName)).toEqual(["Abena", "Bao"]);

    const paidFirst = [
      member(MEMBER, "member", "Bao", "buddy_pro"),
      member("44444444-4444-4444-8444-444444444444", "member", "Abena", null)
    ];
    // Same names, tiers swapped — same order. Name decides, never plan.
    expect(orderGroupMembers(paidFirst).map((row) => row.displayName)).toEqual(["Abena", "Bao"]);
  });

  it("is deterministic within a role", () => {
    const shuffled = [
      member("a", "member", "Yaw"),
      member("b", "member", "Adwoa"),
      member("c", "member", "Kwame")
    ];
    expect(orderGroupMembers(shuffled).map((row) => row.displayName)).toEqual(["Adwoa", "Kwame", "Yaw"]);
  });

  it("does not mutate the input", () => {
    const input = [...roster];
    orderGroupMembers(input);
    expect(input.map((row) => row.role)).toEqual(["member", "owner", "admin"]);
  });
});

describe("role labels", () => {
  it("labels Owner and Admin", () => {
    expect(roleLabel("owner")).toBe("Owner");
    expect(roleLabel("admin")).toBe("Admin");
  });

  it("never labels an ordinary member", () => {
    // A badge that appears on everyone communicates nothing.
    expect(roleLabel("member")).toBeNull();
  });

  it("does not surface moderator in the UI", () => {
    expect(roleLabel("moderator")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Role-aware action menus
// ---------------------------------------------------------------------------

const actionsFor = (viewerRole: ConversationRole | null, viewerId: string, target: GroupMemberView) =>
  memberActions({ viewerRole, viewerId, member: target, hasProfileRoute: true });

describe("owner's menu", () => {
  it("on a member: make admin, remove, view profile", () => {
    const actions = actionsFor("owner", OWNER, member(MEMBER, "member", "Zara"));
    expect(actions).toContain("promote_to_admin");
    expect(actions).toContain("remove_member");
    expect(actions).toContain("view_profile");
  });

  it("on an admin: remove admin, remove from group", () => {
    const actions = actionsFor("owner", OWNER, member(ADMIN, "admin", "Kofi"));
    expect(actions).toContain("demote_to_member");
    expect(actions).toContain("remove_member");
    expect(actions).not.toContain("promote_to_admin");
  });

  it("on themselves: transfer ownership, and no bare Leave", () => {
    // A Leave button for the owner would be guaranteed to fail.
    const actions = actionsFor("owner", OWNER, member(OWNER, "owner", "Ama"));
    expect(actions).toContain("transfer_ownership");
    expect(actions).not.toContain("leave_group");
    expect(actions).not.toContain("remove_member");
  });
});

describe("admin's menu", () => {
  it("on a member: remove and view profile, but no promotion", () => {
    const actions = actionsFor("admin", ADMIN, member(MEMBER, "member", "Zara"));
    expect(actions).toContain("remove_member");
    expect(actions).toContain("view_profile");
    expect(actions).not.toContain("promote_to_admin");
  });

  it("on another admin: view profile only", () => {
    const other = member("55555555-5555-4555-8555-555555555555", "admin", "Nana");
    expect(actionsFor("admin", ADMIN, other)).toEqual(["view_profile"]);
  });

  it("ON THE OWNER: view profile only", () => {
    // The takeover path. An admin must never see a management action here.
    expect(actionsFor("admin", ADMIN, member(OWNER, "owner", "Ama"))).toEqual(["view_profile"]);
  });

  it("on themselves: leave", () => {
    expect(actionsFor("admin", ADMIN, member(ADMIN, "admin", "Kofi"))).toContain("leave_group");
  });
});

describe("member's menu", () => {
  it("has no management actions on anyone", () => {
    for (const target of roster) {
      const actions = actionsFor("member", MEMBER, target);
      for (const forbidden of ["promote_to_admin", "demote_to_member", "remove_member", "transfer_ownership"]) {
        expect(actions, `a member must not be offered ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("can view a profile and leave", () => {
    expect(actionsFor("member", MEMBER, member(OWNER, "owner", "Ama"))).toContain("view_profile");
    expect(actionsFor("member", MEMBER, member(MEMBER, "member", "Zara"))).toContain("leave_group");
  });

  it("cannot promote themselves", () => {
    expect(actionsFor("member", MEMBER, member(MEMBER, "member", "Zara"))).not.toContain("promote_to_admin");
  });
});

describe("action visibility mirrors the server", () => {
  it("never offers an action on a non-joined member", () => {
    const invited = { ...member(MEMBER, "member", "Zara"), status: "invited" as const };
    const actions = actionsFor("owner", OWNER, invited);
    expect(actions).not.toContain("promote_to_admin");
    expect(actions).not.toContain("remove_member");
  });

  it("offers no management actions to a non-member viewer", () => {
    expect(actionsFor(null, "99999999-9999-4999-8999-999999999999", roster[0]!)).toEqual(["view_profile"]);
  });

  it("omits the profile entry when there is no username to route to", () => {
    const actions = memberActions({
      viewerRole: "owner",
      viewerId: OWNER,
      member: member(MEMBER, "member", "Zara"),
      hasProfileRoute: false
    });
    expect(actions).not.toContain("view_profile");
  });

  it("confirms the costly actions and only those", () => {
    expect(needsConfirmation("remove_member")).toBe(true);
    expect(needsConfirmation("transfer_ownership")).toBe(true);
    expect(needsConfirmation("leave_group")).toBe(true);
    // Promotion and demotion are trivially reversible by the same person.
    expect(needsConfirmation("promote_to_admin")).toBe(false);
    expect(needsConfirmation("view_profile")).toBe(false);
  });

  it("labels every action it can offer", () => {
    for (const action of Object.keys(MEMBER_ACTION_LABELS)) {
      expect(MEMBER_ACTION_LABELS[action as keyof typeof MEMBER_ACTION_LABELS]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Ownership transfer
// ---------------------------------------------------------------------------

describe("ownership candidates", () => {
  it("excludes the current owner", () => {
    expect(ownershipCandidates(roster, OWNER).map((row) => row.userId)).not.toContain(OWNER);
  });

  it("excludes members who are not joined", () => {
    const withPending = [...roster, { ...member("66666666-6666-4666-8666-666666666666", "member", "Pending"), status: "invited" as const }];
    expect(ownershipCandidates(withPending, OWNER).map((row) => row.displayName)).not.toContain("Pending");
  });

  it("is empty in a group of one", () => {
    expect(ownershipCandidates([member(OWNER, "owner", "Ama")], OWNER)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

describe("group settings surface", () => {
  it("wires the canonical Stage 3B actions", () => {
    for (const action of [
      "promoteGroupAdminAction",
      "demoteGroupAdminAction",
      "removeGroupMemberAction",
      "transferGroupOwnershipAction",
      "leaveGroupAction"
    ]) {
      expect(page).toContain(action);
    }
  });

  it("reuses the existing invite action rather than a second people picker", () => {
    expect(page).toContain("inviteGroupMemberAction");
  });

  it("orders rows through the shared helper", () => {
    expect(page).toContain("orderGroupMembers(group.members)");
  });

  it("confirms removal by name and states the real consequence", () => {
    // Not overstated: removal ends access to NEW messages.
    expect(page).toContain("will lose access to new messages");
  });

  it("spells out all three transfer consequences", () => {
    expect(page).toContain("gains full control of this group");
    expect(page).toContain("You become an admin");
    expect(page).toContain("This happens immediately");
  });

  it("gives the owner a transfer route instead of a failing Leave button", () => {
    expect(page).toContain("Transfer ownership to another member before you can leave");
  });

  it("does not optimistically mutate roles", () => {
    // Rolling back a failed promotion would briefly show someone as an admin
    // who never was.
    expect(page).toContain("router.refresh()");
  });

  it("blocks double submission while a change is in flight", () => {
    expect(page).toContain("if (isPending) return;");
  });

  it("reuses the canonical identity components", () => {
    expect(page).toContain("<UserAvatar");
    expect(page).toContain("<PremiumPlanBadge");
    expect(page).toContain("publicMembershipTier(member.plan)");
  });

  it("uses the canonical anchored menu, not a bespoke popover", () => {
    expect(page).toContain("<AppMenu");
  });

  it("routes to the canonical profile surface", () => {
    expect(page).toContain("`/friends/${member.username}`");
  });

  it("states authority in words, not colour alone", () => {
    expect(page).toContain("roleLabel(member.role)");
  });

  it("keeps 44px targets on the row menu", () => {
    expect(page).toContain("h-11 w-11");
  });

  it("labels each row menu with the person it acts on", () => {
    expect(page).toContain("`Actions for ${member.displayName}`");
  });

  it("renders no private profile fields", () => {
    for (const forbidden of ["member.email", "member.phone", "member.latitude"]) {
      expect(page).not.toContain(forbidden);
    }
  });
});
