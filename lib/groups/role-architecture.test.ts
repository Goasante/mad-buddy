import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canAssignAdmins,
  canDeleteGroup,
  canLeaveGroup,
  canRemoveMembers,
  resolveRoleChange,
  type RoleChangeInput
} from "@/lib/messaging/rules";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Group role architecture (Stage 3B).
 *
 * Every dangerous case in a group is about a PAIR — who is acting, on whom —
 * so the pure resolver is tested exhaustively here, and the database
 * guarantees (single owner, atomic transfer, no self-promotion via RLS) are
 * asserted against the migration that provides them.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260807120000_group_role_architecture.sql");
const actions = stripComments(read("app/(app)/group-actions.ts"));
const groupPage = stripComments(read("components/groups/group-detail-page.tsx"));
const projection = stripComments(read("lib/messaging/mobile.ts"));
const types = stripComments(read("lib/groups/types.ts"));

/** A joined actor acting on a joined target, unless overridden. */
const pair = (overrides: Partial<RoleChangeInput> = {}): RoleChangeInput => ({
  actorRole: "owner",
  actorStatus: "joined",
  targetRole: "member",
  targetStatus: "joined",
  selfTargeted: false,
  ...overrides
});

// ---------------------------------------------------------------------------
// Promotion and demotion
// ---------------------------------------------------------------------------

describe("promote member to admin", () => {
  it("the owner may promote a member", () => {
    expect(resolveRoleChange("promote_to_admin", pair()).allowed).toBe(true);
  });

  it("an ADMIN may not promote another admin", () => {
    // This is how authority quietly multiplies beyond the one person
    // accountable for the group.
    expect(resolveRoleChange("promote_to_admin", pair({ actorRole: "admin" }))).toEqual({
      allowed: false,
      reason: "not_authorized"
    });
  });

  it("a MEMBER may not promote anyone", () => {
    expect(resolveRoleChange("promote_to_admin", pair({ actorRole: "member" })).allowed).toBe(false);
  });

  it("a member cannot promote themselves", () => {
    expect(
      resolveRoleChange("promote_to_admin", pair({ actorRole: "member", selfTargeted: true, targetRole: "member" }))
        .allowed
    ).toBe(false);
  });

  it("an admin cannot promote themselves to owner", () => {
    expect(
      resolveRoleChange("transfer_ownership", pair({ actorRole: "admin", selfTargeted: true, targetRole: "admin" }))
    ).toEqual({ allowed: false, reason: "not_authorized" });
  });

  it("is idempotent when the target is already an admin", () => {
    expect(resolveRoleChange("promote_to_admin", pair({ targetRole: "admin" }))).toEqual({
      allowed: true,
      reason: "already_in_role"
    });
  });
});

describe("demote admin to member", () => {
  it("the owner may demote an admin", () => {
    expect(resolveRoleChange("demote_to_member", pair({ targetRole: "admin" })).allowed).toBe(true);
  });

  it("an admin may not demote another admin", () => {
    expect(
      resolveRoleChange("demote_to_member", pair({ actorRole: "admin", targetRole: "admin" })).allowed
    ).toBe(false);
  });

  it("nobody may demote the owner", () => {
    // The takeover path this whole model exists to close.
    expect(resolveRoleChange("demote_to_member", pair({ actorRole: "admin", targetRole: "owner" }))).toEqual({
      allowed: false,
      reason: "cannot_target_owner"
    });
  });
});

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

describe("ownership transfer", () => {
  it("the owner may hand ownership to a joined member", () => {
    expect(resolveRoleChange("transfer_ownership", pair()).allowed).toBe(true);
  });

  it("an admin cannot take ownership", () => {
    expect(resolveRoleChange("transfer_ownership", pair({ actorRole: "admin" })).allowed).toBe(false);
  });

  it("cannot transfer to someone who is not a joined member", () => {
    expect(
      resolveRoleChange("transfer_ownership", pair({ targetStatus: "invited" })).reason
    ).toBe("target_not_member");
  });

  it("cannot transfer to yourself", () => {
    expect(resolveRoleChange("transfer_ownership", pair({ selfTargeted: true, targetRole: "owner" })).allowed).toBe(
      false
    );
  });

  it("is a single atomic database operation", () => {
    // Two rows change together; a partial failure would leave the group
    // ownerless or with two owners.
    expect(migration).toContain("create or replace function public.transfer_group_ownership");
    expect(actions).toContain('supabase.rpc("transfer_group_ownership"');
  });

  it("serialises concurrent transfers on a row lock", () => {
    const rpc = migration.slice(migration.indexOf("transfer_group_ownership"));
    expect(rpc).toContain("for update");
  });

  it("authorises against auth.uid(), never a parameter", () => {
    const rpc = migration.slice(migration.indexOf("create or replace function public.transfer_group_ownership"));
    expect(rpc.slice(0, rpc.indexOf("$$;"))).toContain("auth.uid()");
  });

  it("steps the old owner down before promoting, so one-owner never breaks", () => {
    const rpc = migration.slice(migration.indexOf("create or replace function public.transfer_group_ownership"));
    const body = rpc.slice(0, rpc.indexOf("$$;"));
    expect(body.indexOf("set role = 'admin'")).toBeLessThan(body.indexOf("set role = 'owner'"));
  });
});

describe("owner invariants", () => {
  it("the database allows at most one joined owner per group", () => {
    expect(migration).toContain("conversation_members_single_owner_idx");
    expect(migration).toContain("where role = 'owner' and status = 'joined'");
  });

  it("the owner cannot leave without transferring", () => {
    expect(canLeaveGroup("owner", "joined")).toEqual({ allowed: false, reason: "owner_must_transfer" });
  });

  it("an admin and a member can leave freely", () => {
    expect(canLeaveGroup("admin", "joined").allowed).toBe(true);
    expect(canLeaveGroup("member", "joined").allowed).toBe(true);
  });

  it("someone who is not joined cannot leave", () => {
    expect(canLeaveGroup("member", "left").allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

describe("remove member", () => {
  it("an admin may remove an ordinary member", () => {
    expect(resolveRoleChange("remove_member", pair({ actorRole: "admin" })).allowed).toBe(true);
  });

  it("an admin may NOT remove another admin", () => {
    expect(
      resolveRoleChange("remove_member", pair({ actorRole: "admin", targetRole: "admin" })).allowed
    ).toBe(false);
  });

  it("the owner may remove an admin", () => {
    expect(resolveRoleChange("remove_member", pair({ targetRole: "admin" })).allowed).toBe(true);
  });

  it("nobody may remove the owner", () => {
    expect(resolveRoleChange("remove_member", pair({ actorRole: "admin", targetRole: "owner" })).allowed).toBe(false);
  });

  it("a member may not remove anyone", () => {
    expect(resolveRoleChange("remove_member", pair({ actorRole: "member" })).allowed).toBe(false);
  });

  it("removal marks the membership removed, so access ends immediately", () => {
    expect(actions).toContain('status: "removed" as const');
  });
});

// ---------------------------------------------------------------------------
// Authorization plumbing
// ---------------------------------------------------------------------------

describe("authorization", () => {
  it("a non-member actor is refused regardless of the requested change", () => {
    for (const change of ["promote_to_admin", "demote_to_member", "transfer_ownership", "remove_member"] as const) {
      expect(resolveRoleChange(change, pair({ actorStatus: null, actorRole: null })).reason).toBe("actor_not_member");
    }
  });

  it("an actor who left is no longer authorised", () => {
    expect(resolveRoleChange("promote_to_admin", pair({ actorStatus: "left" })).reason).toBe("actor_not_member");
  });

  it("every role action re-checks on the server, not in the UI", () => {
    // Disabled buttons are not authorization.
    expect(actions).toContain("resolveRoleChange(");
    expect(actions).toContain("getAuthedUserId()");
  });

  it("guards the write against a concurrent role change", () => {
    // The decision and the write must agree, or the write loses.
    expect(actions).toContain('.eq("status", "joined")');
  });

  it("returns one neutral message for every denial", () => {
    // Distinct reasons would map out the group's authority structure.
    expect(actions).toContain("ROLE_CHANGE_DENIED");
  });

  it("reuses the canonical role predicates", () => {
    expect(canAssignAdmins("owner")).toBe(true);
    expect(canAssignAdmins("admin")).toBe(false);
    expect(canDeleteGroup("owner")).toBe(true);
    expect(canDeleteGroup("admin")).toBe(false);
    expect(canRemoveMembers("admin")).toBe(true);
    expect(canRemoveMembers("member")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The RLS hole this stage closes
// ---------------------------------------------------------------------------

describe("self-promotion is impossible", () => {
  it("the membership update policy pins role and status", () => {
    // The previous policy allowed a member to UPDATE their own row with no
    // column restriction, so `role = 'owner'` was a legal client write.
    const policy = migration.slice(migration.indexOf('create policy "conversation members update own row"'));
    const body = policy.slice(0, policy.indexOf(";"));
    expect(body).toContain("role = (");
    expect(body).toContain("status = (");
  });
});

// ---------------------------------------------------------------------------
// Migration safety
// ---------------------------------------------------------------------------

describe("existing group migration", () => {
  it("promotes only the recorded creator", () => {
    expect(migration).toContain("conversation.created_by = member.user_id");
  });

  it("only fills a genuinely missing owner", () => {
    expect(migration).toContain("not exists (");
    expect(migration).toContain("existing.role = 'owner'");
  });

  it("does not fabricate historical admin roles", () => {
    const backfill = migration.slice(migration.indexOf("update public.conversation_members as member"));
    expect(backfill).not.toContain("'admin'");
  });

  it("reports ownerless groups instead of assigning ownership arbitrarily", () => {
    expect(migration).toContain("ownerless_groups_require_review");
    expect(migration).toContain("raise warning");
  });

  it("creates no parallel membership table", () => {
    expect(migration.toLowerCase()).not.toContain("create table");
  });
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

describe("audit events", () => {
  it("records the four factual role changes", () => {
    for (const event of ["admin.promoted", "admin.demoted", "ownership.transferred", "member.removed"]) {
      expect(actions).toContain(event);
    }
  });

  it("reuses domain_events rather than a second audit system", () => {
    expect(actions).toContain('.from("domain_events")');
  });

  it("keeps the payload to ids only", () => {
    const payload = actions.slice(actions.indexOf("payload: { targetUserId"));
    expect(payload.slice(0, 80)).toContain("targetUserId");
    expect(payload.slice(0, 80)).not.toContain("name");
  });

  it("never lets a failed audit write undo the role change", () => {
    const record = actions.slice(actions.indexOf("async function recordRoleEvent"));
    expect(record.slice(0, 1200)).toContain("logBackendEvent");
    expect(record.slice(0, 1200)).not.toContain("throw");
  });
});

// ---------------------------------------------------------------------------
// Message identity and member projection
// ---------------------------------------------------------------------------

describe("message identity integration", () => {
  it("carries the sender's group role", () => {
    expect(projection).toContain("senderRole");
  });

  it("resolves roles in one batched query per page", () => {
    // Never per message.
    expect(projection).toContain('.in("user_id", senderIds)');
  });

  it("shows Owner and Admin only, never Member", () => {
    const indicator = groupPage.slice(groupPage.indexOf('message.senderRole === "owner"'));
    expect(indicator.slice(0, 300)).toContain("Owner");
    expect(indicator.slice(0, 300)).toContain("Admin");
    expect(indicator.slice(0, 300)).not.toContain('"Member"');
  });

  it("keeps the indicator subordinate to name and premium identity", () => {
    // Plain muted text, no pill and no colour of its own.
    const indicator = groupPage.slice(groupPage.indexOf('message.senderRole === "owner"'));
    expect(indicator.slice(0, 300)).toContain("font-normal");
    expect(indicator.slice(0, 300)).toContain("text-muted-foreground");
  });
});

describe("member projection for Stage 3C", () => {
  it("exposes role, membership tier and state", () => {
    expect(types).toContain("role: ConversationRole");
    expect(types).toContain("plan: SubscriptionPlan | null");
    expect(types).toContain("status: ConversationMemberStatus");
  });

  it("exposes no private profile fields", () => {
    const view = types.slice(types.indexOf("export type GroupMemberView"), types.indexOf("export type GroupInviteCandidate"));
    for (const forbidden of ["email", "phone", "latitude", "longitude", "date_of_birth"]) {
      expect(view, `GroupMemberView must not expose ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("loads member plans in a batched pass, not per member", () => {
    expect(actions).toContain("loadEffectivePlansForUsers(admin, memberIds)");
  });
});
