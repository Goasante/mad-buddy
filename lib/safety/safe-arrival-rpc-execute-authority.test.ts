import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * SEC-001: EXECUTE authority on the transition_safe_arrival family.
 *
 * `transition_safe_arrival` is SECURITY DEFINER and authorizes on `p_actor_id`,
 * a caller-supplied parameter, rather than auth.uid(). That is correct for a
 * function invoked only with trusted server authority -- and it is why no
 * browser role may execute it. An unauthenticated caller holding the
 * publishable anon key cancelled another user's Safe Arrival session over HTTP,
 * stopping the watcher escalation for someone who never arrived.
 *
 * The mechanism is the part worth pinning. 20260830223000 revoked the function
 * correctly. 20260904200000 then added a fifth argument for D5 idempotency, and
 * in PostgreSQL a signature IS the identity: that produced a second, distinct
 * function object which the earlier revoke never reached, born with the default
 * EXECUTE TO PUBLIC.
 *
 * So this suite deliberately does NOT assert one literal signature. A test that
 * checks `(uuid,uuid,text,integer,uuid)` would pass while a sixth-argument
 * overload sat wide open -- reproducing the exact defect it was written to
 * prevent. It asserts instead that the FIX ITSELF is family-wide: driven by a
 * catalog enumeration of every function named transition_safe_arrival.
 *
 * The effective-privilege half of this contract -- what the database actually
 * grants, per overload, after the migration runs -- lives in
 * lib/security/safe-arrival-rpc-execute-authority.local.test.ts, which reads the
 * catalog. Source text can only prove the fix was written correctly; only a
 * database can prove it took effect.
 */

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const HOTFIX = "20260905120000_safe_arrival_rpc_execute_authority.sql";

/** Strip `--` comments so prose about a grant is never read as a grant. */
const sqlOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");

const hotfix = sqlOf(readFileSync(path.join(MIGRATIONS, HOTFIX), "utf8"));

const allSql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => sqlOf(readFileSync(path.join(MIGRATIONS, f), "utf8")))
  .join("\n");

describe("the fix covers the whole overload family, not one signature", () => {
  it("enumerates transition_safe_arrival from the catalog by name", () => {
    // The load-bearing line. Selecting by proname is what makes the migration
    // correct for overloads that do not exist yet.
    expect(hotfix).toMatch(/from\s+pg_proc\s+p/i);
    expect(hotfix).toMatch(/p\.proname\s*=\s*'transition_safe_arrival'/i);
    expect(hotfix).toMatch(/n\.nspname\s*=\s*'public'/i);
  });

  it("revokes and grants through the enumerated signature, not a hardcoded one", () => {
    // format(...%s...) over oid::regprocedure -- so each overload is addressed
    // by its own identity.
    expect(hotfix).toMatch(/p\.oid::regprocedure/i);
    expect(hotfix).toMatch(/revoke all on function %s from public/i);
    expect(hotfix).toMatch(/revoke all on function %s from anon/i);
    expect(hotfix).toMatch(/revoke all on function %s from authenticated/i);
    expect(hotfix).toMatch(/grant execute on function %s to service_role/i);
  });

  it("does not rely on a literal argument list for the revoke", () => {
    /* If a future edit replaces the loop with two hardcoded signatures, this
       fails -- that regression is precisely how SEC-001 happened. */
    const revokeLines = hotfix
      .split("\n")
      .filter((l) => /revoke/i.test(l) && /transition_safe_arrival\s*\(/i.test(l));
    expect(
      revokeLines,
      "revokes must be driven by the catalog enumeration, not written per signature"
    ).toEqual([]);
  });

  it("fails loudly if the function is missing rather than reporting success", () => {
    // A migration that silently normalizes zero functions is worse than one
    // that errors: it leaves a green deploy over an open hole.
    expect(hotfix).toMatch(/if\s+v_count\s*=\s*0\s+then/i);
    expect(hotfix).toMatch(/raise exception/i);
  });
});

describe("the migration proves its own result", () => {
  it("asserts effective privilege with has_function_privilege", () => {
    // Catalog ACL text can be misread; has_function_privilege answers the
    // question the exploit actually asked, including indirect grants.
    expect(hotfix).toMatch(/has_function_privilege\(\s*'public'/i);
    expect(hotfix).toMatch(/has_function_privilege\(\s*'anon'/i);
    expect(hotfix).toMatch(/has_function_privilege\(\s*'authenticated'/i);
    expect(hotfix).toMatch(/has_function_privilege\(\s*'service_role'/i);
  });

  it("raises if any browser role retains EXECUTE", () => {
    expect(hotfix).toMatch(/raise exception 'SEC-001 verification failed/i);
  });

  it("raises if service_role lost EXECUTE", () => {
    /* REVOKE ALL ... FROM PUBLIC strips the share service_role holds through
       PUBLIC. Locking out the server has taken this app down before. */
    expect(hotfix).toMatch(/service_role LOST execute/i);
  });
});

describe("the hotfix stays a hotfix", () => {
  it("changes no function body", () => {
    expect(hotfix).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(hotfix).not.toMatch(/drop\s+function/i);
  });

  it("touches no table privileges", () => {
    // SEC-002, SEC-003 and the grant cleanup are separate, reviewed waves.
    expect(hotfix).not.toMatch(/\bon\s+(all\s+tables|table)\b/i);
    expect(hotfix).not.toMatch(/alter\s+default\s+privileges/i);
  });

  it("touches no policy", () => {
    expect(hotfix).not.toMatch(/create\s+policy|drop\s+policy|alter\s+policy/i);
  });

  it("grants execute to no browser role anywhere in the migration", () => {
    expect(hotfix).not.toMatch(/grant\s+execute[^;]*to[^;]*\b(anon|authenticated)\b/i);
  });
});

describe("the historical record is left intact", () => {
  it("keeps the original 4-argument revoke in 20260830223000", () => {
    const s1 = sqlOf(
      readFileSync(path.join(MIGRATIONS, "20260830223000_safe_arrival_s1_authority.sql"), "utf8")
    );
    expect(s1).toMatch(
      /revoke all on function public\.transition_safe_arrival\(uuid,uuid,text,integer\)\s*\n?\s*from public,\s*anon,\s*authenticated/i
    );
  });

  it("leaves the D5 idempotency migration unedited", () => {
    const d5 = sqlOf(
      readFileSync(path.join(MIGRATIONS, "20260904200000_safe_arrival_extend_idempotency.sql"), "utf8")
    );
    // Its service_role grant remains the historical truth; the missing revoke
    // is repaired forward, not by rewriting a migration already applied to
    // production.
    expect(d5).toMatch(
      /grant execute on function public\.transition_safe_arrival\(uuid, uuid, text, integer, uuid\) to service_role/i
    );
  });

  it("never re-opens the function to a browser role in any later migration", () => {
    const grants = [
      ...allSql.matchAll(
        /grant\s+execute\s+on\s+function\s+public\.transition_safe_arrival[^;]*?to\s+([^;]+);/gi
      ),
    ];
    expect(grants.length).toBeGreaterThan(0);
    for (const [, grantees] of grants) {
      expect(grantees, "transition_safe_arrival must stay server-only").not.toMatch(
        /\b(anon|authenticated|public)\b/i
      );
    }
  });
});
