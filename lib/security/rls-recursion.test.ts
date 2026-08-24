import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NO RLS POLICY MAY READ THE TABLE IT PROTECTS.
 *
 * MB-GOD-058. Postgres applies a table's RLS policy to every read of that
 * table, including a read inside the policy itself, so a cyclic policy raises
 * `infinite recursion detected in policy for relation ...` and returns nothing.
 * It failed CLOSED, which is why it was survivable — but RLS was inert rather
 * than protective, leaving the application's own authorization as the only
 * boundary.
 *
 * FIFTEEN tables in FOUR families were affected, not the seven in one family
 * the audit recorded. A live sweep of every RLS-protected table found:
 *
 *     messaging      conversation_members + 5 tables joining through it
 *     safe arrival   safe_arrival_sessions <-> safe_arrival_contacts
 *     plans          plans <-> plan_participants (+ 3 poll tables)
 *     event circles  event_circles <-> event_circle_members (+ announcements)
 *
 * The last three were found by THIS TEST failing on its first run, then
 * confirmed against the live database. Only the first was in the ledger.
 *
 * The behavioural proof is scripts/hardening/rls-recursion-matrix.mjs, which
 * probes seven personas against nine tables inside Postgres and went from
 * 0/63 correct to 63/63, with access granted 0/16 -> 16/16, and no persona
 * gaining access beyond what the policy specifies.
 *
 * This file guards the SHAPE, because the runtime matrix needs a live database
 * and CI does not have one. Three things are asserted: no policy reads its own
 * table, no two policies read through each other, and the helpers that break
 * the cycles keep the properties that make them safe.
 *
 * IMPORTANT — why this is not just a grep for "recursion": the failure is
 * silent at authoring time. `create policy` accepts a self-referencing policy
 * happily; nothing complains until somebody reads the table. Without a
 * structural check, the next policy written in the obvious style reintroduces
 * it and every test still passes.
 */

const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");

type Policy = {
  file: string;
  table: string;
  name: string;
  body: string;
  /** Only the USING half — the read path, where recursion actually happens. */
  using: string;
};

/**
 * The USING clause only, with WITH CHECK removed.
 *
 * THIS DISTINCTION IS THE WHOLE POINT, and was established by testing the live
 * database rather than assumed. `conversation_members` has an UPDATE policy
 * whose WITH CHECK reads `conversation_members` to pin `role` and `status` to
 * their existing values — the guard that stops a member promoting themselves to
 * owner. That is a self-reference, and it does NOT recurse: verified against
 * Postgres, a legitimate self-update succeeds and a role escalation is blocked.
 *
 * Recursion comes from the READ path. A policy's USING clause is re-applied to
 * any read of its own table, so a USING that selects from that table loops.
 * WITH CHECK is evaluated against the proposed row on write and does not.
 *
 * Flagging WITH CHECK would have condemned a correct security control as a bug
 * — the expensive direction of false positive.
 */
function usingClause(body: string): string {
  const idx = body.search(/\bwith\s+check\b/i);
  return idx === -1 ? body : body.slice(0, idx);
}

/**
 * Every `create policy` in the migration history, with its body.
 *
 * Later migrations may drop and recreate a policy, so the LAST definition of a
 * given (table, name) wins — which is what the database actually has.
 */
function livePolicies(): Policy[] {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const latest = new Map<string, Policy>();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    // Strip line comments so a rollback recipe in a comment block is not read
    // as a live policy — this file's own migration documents its rollback that way.
    const code = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

    const re = /create\s+policy\s+"([^"]+)"\s+on\s+(?:public\.)?(\w+)([\s\S]*?);\s*(?=\n|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const [, name, table, body] = m;
      latest.set(`${table}::${name}`, { file, table, name, body, using: usingClause(body) });
    }
  }
  return [...latest.values()];
}

const policies = livePolicies();

describe("RLS policies", () => {
  it("the migration history actually parses", () => {
    // A regex that silently matched nothing would make every assertion vacuous.
    expect(policies.length).toBeGreaterThan(20);
  });

  it("no policy READ path reads the table it protects", () => {
    /* THE DEFECT. `conversation_members`'s SELECT policy contained
       `select 1 from public.conversation_members m ...`.

       Scoped to USING deliberately — see usingClause() above for why a
       self-reference in WITH CHECK is correct and must not be flagged. */
    const offenders = policies.filter((p) => {
      const refs = [...p.using.matchAll(/\bfrom\s+(?:public\.)?(\w+)/gi)].map((r) => r[1]);
      const joins = [...p.using.matchAll(/\bjoin\s+(?:public\.)?(\w+)/gi)].map((r) => r[1]);
      return [...refs, ...joins].includes(p.table);
    });

    expect(
      offenders.map((o) => `${o.table} / "${o.name}" (${o.file})`),
      "a policy reads its own table — this recurses and denies everything"
    ).toEqual([]);
  });

  it("no two policies form a mutual reference", () => {
    /* THE DEFECT THE ORIGINAL AUDIT MISSED. safe_arrival_sessions was visible
       via safe_arrival_contacts, whose policy was in turn visible via
       safe_arrival_sessions: A -> B -> A. Neither policy read its own table, so
       a self-reference check alone would have called this clean and the repair
       would have left Safe Arrival still broken. */
    const readsOf = new Map<string, Set<string>>();
    for (const p of policies) {
      const refs = [
        ...[...p.using.matchAll(/\bfrom\s+(?:public\.)?(\w+)/gi)].map((r) => r[1]),
        ...[...p.using.matchAll(/\bjoin\s+(?:public\.)?(\w+)/gi)].map((r) => r[1])
      ];
      if (!readsOf.has(p.table)) readsOf.set(p.table, new Set());
      for (const r of refs) readsOf.get(p.table)!.add(r);
    }

    const cycles: string[] = [];
    for (const [table, reads] of readsOf) {
      for (const other of reads) {
        if (other === table) continue;
        if (readsOf.get(other)?.has(table)) {
          const pair = [table, other].sort().join(" <-> ");
          if (!cycles.includes(pair)) cycles.push(pair);
        }
      }
    }
    expect(cycles, "two policies read through each other — this recurses").toEqual([]);
  });
});

describe("the helpers that break the cycles", () => {
  const repair = readFileSync(
    join(MIGRATIONS, "20260824100000_rls_recursion_repair.sql"),
    "utf8"
  );

  const HELPERS = [
    "is_conversation_member",
    "is_safe_arrival_traveller",
    "is_plan_creator",
    "is_event_circle_owner"
  ];

  for (const fn of HELPERS) {
    describe(fn, () => {
      const decl = repair.slice(
        repair.indexOf(`create or replace function public.${fn}(`),
        repair.indexOf("$$;", repair.indexOf(`create or replace function public.${fn}(`)) + 3
      );

      it("is security definer, or it recurses like the policy did", () => {
        expect(decl).toMatch(/security definer/);
      });

      it("pins its search_path", () => {
        // An unpinned search_path on a definer function is an object-resolution
        // hazard: a caller-controlled schema could shadow the tables it reads.
        expect(decl).toMatch(/set search_path = public, pg_temp/);
      });

      it("is stable, so the planner can hoist it out of the row loop", () => {
        expect(decl).toMatch(/\bstable\b/);
      });

      it("takes no user argument — it can only answer about the caller", () => {
        /* This is what stops the helper becoming a membership oracle. It reads
           auth.uid() itself, so there is no parameter through which one account
           could ask about another. */
        expect(decl).toMatch(/auth\.uid\(\)/);
        expect(decl, `${fn} accepts a user id — it could probe other accounts`)
          .not.toMatch(/p_user_id|p_actor|target_user_id/);
      });

      it("grants execute back to service_role", () => {
        /* Revoking without re-granting strips service_role and breaks the
           server. This codebase has been bitten by exactly that. */
        expect(repair).toMatch(
          new RegExp(`grant execute on function public\\.${fn}\\(uuid\\) to[^;]*service_role`)
        );
      });

      it("grants execute to anon, so a signed-out read returns empty not 500", () => {
        /* anon holds SELECT on these tables, so it reaches these policies.
           Revoking from anon (the reflex, copied from is_friend) turned an
           empty result into `permission denied for function ...` — still
           closed, but the wrong shape of closed, and it names the function to
           an anonymous caller. Granting gives nothing away: auth.uid() is NULL
           for anon, so the helper can only return false. */
        expect(repair).toMatch(
          new RegExp(`grant execute on function public\\.${fn}\\(uuid\\) to[^;]*\\banon\\b`)
        );
      });
    });
  }

  it("does not solve recursion by widening access", () => {
    /* The forbidden repairs: disabling RLS, opening a table to everyone, or
       leaning harder on service_role. Each trades a broken layer for no layer.

       COMMENTS ARE STRIPPED FIRST. The migration documents what it deliberately
       did NOT do -- including the phrase `using (true)` -- and an earlier
       version of this assertion matched that explanation and failed on a
       migration that was correct. Guards in this codebase have hit the
       self-reporting trap repeatedly; the fix is always to scan CODE, not prose. */
    const code = repair.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    expect(code).not.toMatch(/disable\s+row\s+level\s+security/i);
    expect(code).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(code).not.toMatch(/grant[^;]*\bto\s+public\b/i);
  });

  it("keeps membership meaning joined, in the helper body itself", () => {
    /* A helper that dropped the status check would silently let `invited`,
       `left`, `removed` and `banned` members read conversation content — the
       worst possible regression here, because the policy still LOOKS right and
       every recursion assertion still passes.

       Asserted against the FUNCTION BODY, not the file. An earlier version
       matched anywhere in the migration, and the rollback recipe in the trailing
       comment block contains the same string — so deleting the check from the
       live helper left the assertion passing. Mutation testing caught it: two
       of three mutations failed the suite, this one survived. */
    const start = repair.indexOf("create or replace function public.is_conversation_member(");
    expect(start).toBeGreaterThan(-1);
    const body = repair.slice(start, repair.indexOf("$$;", start));

    expect(body, "is_conversation_member no longer requires status = 'joined'")
      .toMatch(/status = 'joined'/);
    expect(body, "membership must be scoped to the caller")
      .toMatch(/m\.user_id = auth\.uid\(\)/);
  });

  it("covers every cycle the live sweep found", () => {
    /* The audit recorded ONE family. The sweep found four. If a future edit
       drops one of these helpers, the family it protects silently goes back to
       denying everything — and the ledger would still say MB-GOD-058 is
       closed. */
    for (const fn of HELPERS) {
      expect(repair, `${fn} is missing — a whole family recurses again`)
        .toContain(`create or replace function public.${fn}(`);
    }
    // The three cut points, one per mutual cycle.
    expect(repair).toContain('on public.plan_participants');
    expect(repair).toContain('on public.event_circle_members');
    expect(repair).toContain('on public.safe_arrival_contacts');
  });
});
