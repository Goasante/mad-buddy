import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GRANT_DURATIONS, durationAllowedForSupport, SUPPORT_MAX_GRANT_DAYS } from "@/lib/access/admin";
import { permissionsForRole } from "@/lib/admin/governance";

/**
 * THE ADMIN PRIVILEGE BOUNDARY FOR ACCESS.
 *
 * Giving away a paid product is a privileged action, and the failure modes are
 * quiet: a support agent who can grant a year, an admin who can open access to
 * every user, a grant nobody can attribute afterwards.
 *
 * The rule is that reversible, time-boxed help is a support function, while
 * open-ended or global access is an ownership decision.
 */

const ROOT = join(__dirname, "..", "..");
const actions = readFileSync(join(ROOT, "app/(admin)/admin/access-actions.ts"), "utf8");
const adminLib = readFileSync(join(ROOT, "lib/access/admin.ts"), "utf8");

/** Assert on code, never on the comments explaining it. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function actionBody(name: string): string {
  const start = actions.indexOf(`export async function ${name}(`);
  expect(start, `${name} no longer exists`).toBeGreaterThan(-1);
  const rest = actions.slice(start);
  const next = rest.indexOf("\nexport async function ", 1);
  return code(next === -1 ? rest : rest.slice(0, next));
}

const ALL_ACTIONS = [
  "grantAccessAction",
  "revokeAccessAction",
  "openGlobalAccessAction",
  "closeGlobalAccessAction"
];

describe("every access action is authorized", () => {
  for (const name of ALL_ACTIONS) {
    it(`${name} requires admin.entitlements.manage`, () => {
      expect(actionBody(name)).toContain('requireAdminPermission(admin, context, "admin.entitlements.manage")');
    });

    it(`${name} rate limits the actor`, () => {
      expect(actionBody(name)).toContain("consumeRateLimit");
    });

    it(`${name} demands a reason`, () => {
      /* An audit trail of unexplained grants is not an audit trail. The schema
         enforces a minimum length, so a blank reason cannot pass. */
      expect(actionBody(name)).toMatch(/parsed\.data\.reason|reason: parsed/);
    });
  }
});

describe("global access is owner-only", () => {
  for (const name of ["openGlobalAccessAction", "closeGlobalAccessAction"]) {
    it(`${name} additionally requires admin.access.global.manage`, () => {
      /* Opening access to EVERY user is the highest-blast-radius action here.
         The first draft borrowed `admin.roles.manage` and called it owner-only;
         this test caught that `trust_safety_administrator` holds that
         permission, which would have let a T&S admin hand the whole user base
         a paid product. A dedicated permission replaced it. */
      expect(actionBody(name)).toContain('requireAdminPermission(admin, context, "admin.access.global.manage")');
    });
  }

  it("admin.access.global.manage really is owner-only in the shipped role matrix", () => {
    /* The assertion above is only meaningful if this permission is actually
       restricted. If a future role gained it, global access would silently
       widen without this file changing -- so the matrix is checked directly. */
    const rolesWithIt = (
      [
        "trust_safety_administrator",
        "customer_support_agent",
        "billing_support_agent",
        "verification_reviewer",
        "security_engineer",
        "privacy_administrator",
        "read_only_auditor"
      ] as const
    ).filter((role) => permissionsForRole(role).includes("admin.access.global.manage"));

    expect(rolesWithIt, "a non-owner role can now open global access").toEqual([]);
    expect(permissionsForRole("super_administrator")).toContain("admin.access.global.manage");
  });
});

describe("long and indefinite grants are owner-only", () => {
  it("support-length durations stop at 30 days", () => {
    expect(SUPPORT_MAX_GRANT_DAYS).toBe(30);
    expect(durationAllowedForSupport("7d")).toBe(true);
    expect(durationAllowedForSupport("14d")).toBe(true);
    expect(durationAllowedForSupport("30d")).toBe(true);
  });

  it("3 months, 1 year and indefinite are NOT support-length", () => {
    expect(durationAllowedForSupport("3m")).toBe(false);
    expect(durationAllowedForSupport("1y")).toBe(false);
    expect(durationAllowedForSupport("indefinite")).toBe(false);
  });

  it("indefinite means no expiry, not a very long one", () => {
    /* A sentinel far-future date would eventually arrive and silently revoke
       staff access. Null is the honest representation. */
    expect(GRANT_DURATIONS.indefinite.days).toBeNull();
  });

  it("grantAccessAction escalates to owner for long or custom grants", () => {
    const body = actionBody("grantAccessAction");
    expect(body).toContain("durationAllowedForSupport");
    expect(body).toContain('requireAdminPermission(admin, context, "admin.access.global.manage")');
    /* A CUSTOM EXPIRY IS ALSO AN ESCALATION. Without this, a support agent
       could pass customExpiry ten years out and bypass the duration ladder
       entirely -- the check would pass because the *duration* was "7d". */
    expect(body, "a custom expiry can bypass the duration ladder")
      .toContain("Boolean(parsed.data.customExpiry)");
  });
});

describe("the audit trail cannot be skipped", () => {
  for (const name of ALL_ACTIONS) {
    it(`${name} writes the audit event BEFORE mutating`, () => {
      const body = actionBody(name);
      const audit = body.indexOf("recordAdminAuditEvent");
      const guard = body.indexOf("if (!logged)");
      expect(audit, `${name} does not record an audit event`).toBeGreaterThan(-1);
      expect(guard, `${name} does not abort when the audit write fails`).toBeGreaterThan(audit);

      /* And the mutation must come after the guard. Ordering is the property:
         an audit written after a successful mutation cannot prevent an
         unattributable change. */
      const mutation = Math.max(
        body.indexOf("grantAccess(admin"),
        body.indexOf("revokeAdminGrants(admin"),
        body.indexOf("openGlobalWindow(admin"),
        body.indexOf("revokeGlobalWindow(admin")
      );
      expect(mutation, `${name} performs no recognised mutation`).toBeGreaterThan(-1);
      expect(mutation, `${name} mutates before the audit guard`).toBeGreaterThan(guard);
    });
  }
});

describe("admins never fake payment records", () => {
  it("no access action writes to the subscriptions table", () => {
    /* Faking a subscription would corrupt revenue reporting, confuse provider
       reconciliation and lie about how somebody got access. An admin grant is
       the honest record, and the resolver treats both as valid. */
    for (const [name, source] of [["access-actions", actions], ["lib/access/admin", adminLib]] as const) {
      expect(code(source), `${name} writes a fake subscription`).not.toContain('from("subscriptions")');
    }
  });

  it("revoking admin grants is scoped to admin_grant only", () => {
    /* Revoking "access" wholesale would cancel a paid subscription from a
       support screen -- a different decision, with a refund attached. The
       resolver's union means the person correctly keeps their other sources. */
    const revoke = adminLib.slice(adminLib.indexOf("export async function revokeAdminGrants("));
    expect(revoke).toContain('.eq("source", "admin_grant")');
  });

  it("grants are inserted, never overwritten", () => {
    /* An extension is a NEW row. Editing the old one would destroy the record
       of what was originally granted and by whom. */
    const grant = adminLib.slice(
      adminLib.indexOf("export async function grantAccess("),
      adminLib.indexOf("export async function revokeAdminGrants(")
    );
    expect(grant).toContain('.from("access_grants")');
    expect(grant).toContain(".insert(");
    expect(grant, "grantAccess updates an existing row instead of inserting").not.toContain(".update(");
  });

  it("revocation preserves history rather than deleting", () => {
    expect(code(adminLib), "a revocation deletes the grant row").not.toContain(".delete()");
  });
});

describe("global promotions never touch user rows", () => {
  it("opening a window writes exactly one row", () => {
    /* Mass-updating users would make ending a promotion destructive: it would
       have to guess what each person's access was beforehand. Because the
       window never touches user rows, revoking it restores everybody
       automatically. */
    const open = adminLib.slice(
      adminLib.indexOf("export async function openGlobalWindow("),
      adminLib.indexOf("export async function revokeGlobalWindow(")
    );
    expect(open).toContain('.from("access_global_windows")');
    expect(open, "the global path touches per-user grants").not.toContain('from("access_grants")');
  });
});
