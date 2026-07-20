import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the privacy contract of the support workflow migration: the two
 * staff-only tables must have RLS enabled with NO user-facing policy, so
 * authenticated end users are denied by default and only the service-role admin
 * client (behind a server-side admin.support.manage check) can reach them.
 */
const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260720100000_support_issue_workflow.sql"),
  "utf8"
);

describe("support workflow migration privacy", () => {
  for (const table of ["support_internal_notes", "support_ticket_events"]) {
    describe(table, () => {
      it("creates the staff-only table", () => {
        expect(sql).toContain(`create table if not exists public.${table}`);
      });

      it("enables row level security", () => {
        expect(sql).toContain(`alter table public.${table} enable row level security`);
      });

      it("defines NO policy (RLS-enabled with no policy denies every non-service role)", () => {
        const policyPattern = new RegExp(`create policy[^;]*on public\\.${table}`, "i");
        expect(policyPattern.test(sql)).toBe(false);
      });

      it("revokes direct grants from anon and authenticated", () => {
        expect(sql).toContain(`revoke all on table public.${table} from anon, authenticated`);
      });
    });
  }

  it("does not weaken the existing user-facing support policies", () => {
    // This migration must be additive: it should never drop/alter the canonical
    // support_tickets or support_ticket_messages policies.
    expect(sql).not.toMatch(/drop policy[^;]*support_tickets/i);
    expect(sql).not.toMatch(/alter table public\.support_tickets(?!_events)/i);
  });
});
