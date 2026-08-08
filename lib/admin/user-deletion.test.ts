import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { ADMIN_PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/admin/governance";

/**
 * Deleting an account is the most destructive thing an admin can do, so the
 * guarantees are pinned rather than left to review.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const actions = stripComments(read("app/(admin)/admin/actions.ts"));
const deleteAction = actions.slice(actions.indexOf("export async function deleteUserAccountAction"));

describe("who may delete", () => {
  it("is its own permission, not folded into suspend", () => {
    // A suspension is a door held shut; a deletion starts a purge clock.
    // Different outcomes deserve different permissions.
    expect(ADMIN_PERMISSIONS).toContain("admin.users.delete");
  });

  it("is granted to trust & safety and to support", () => {
    expect(ROLE_PERMISSIONS.trust_safety_administrator).toContain("admin.users.delete");
    expect(ROLE_PERMISSIONS.customer_support_agent).toContain("admin.users.delete");
  });

  it("is checked before anything happens", () => {
    expect(deleteAction).toContain('requireAdminPermission(admin, context, "admin.users.delete")');
  });

  it("refuses self-deletion", () => {
    // It would revoke the access needed to undo it.
    expect(deleteAction).toContain("You cannot delete your own account.");
  });
});

describe("the reason rule follows the role", () => {
  it("requires one from support", () => {
    expect(deleteAction).toContain('const mustExplain = role === "support"');
    expect(deleteAction).toContain("Add a short reason before deleting this account.");
  });

  it("does not require one from owner or admin", () => {
    // The schema keeps it optional; the role decides.
    expect(actions).toContain("reason: z.string().trim().max(300).optional()");
  });

  it("reads the role from the canonical resolver", () => {
    // "May delete" and "must justify" are different questions, so the second
    // is not inferred from the first.
    expect(deleteAction).toContain("const { role } = await getAdminAccess(admin, context)");
  });
});

describe("every deletion is attributable", () => {
  it("records who, even when no reason was required", () => {
    expect(deleteAction).toContain('action: "user_account_deleted"');
    expect(deleteAction).toContain("actorId: context.userId");
  });

  it("aborts when the audit entry cannot be written", () => {
    // An unlogged deletion is worse than no deletion.
    expect(deleteAction).toContain("so no change was made");
  });

  it("logs before it changes anything", () => {
    const auditAt = deleteAction.indexOf("recordAdminAuditEvent");
    const updateAt = deleteAction.indexOf('.from("profiles")');
    expect(auditAt).toBeGreaterThan(-1);
    expect(auditAt).toBeLessThan(updateAt);
  });
});

describe("the delete is soft, and recoverable", () => {
  it("sets deleted_at rather than dropping rows", () => {
    // A hard delete cascades ~30 tables with no undo; a wrong tap on a real
    // account would destroy messages, plans and friendships.
    expect(deleteAction).toContain("deleted_at: nowIso");
    expect(deleteAction).not.toContain("auth.admin.deleteUser");
  });

  it("revokes sign-in too, so the account is gone from both sides", () => {
    // Without this the person still signs in to an app that has erased them
    // from everyone else's view.
    expect(deleteAction).toContain('ban_duration: "876000h"');
  });

  it("rolls the profile back if sign-in cannot be revoked", () => {
    // Otherwise the account is invisible to others but still usable by its
    // owner, which is the worst of both.
    expect(deleteAction).toContain("deleted_at: null");
    expect(deleteAction).toContain("Nothing was changed.");
  });

  it("relies on deleted_at already being honoured by profile reads", () => {
    expect(read("lib/profile/public.ts")).toContain("profile.deleted_at");
  });
});
