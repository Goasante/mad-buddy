import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260801170000_buddy_score_ledger.sql", "utf8");
const service = readFileSync("lib/engagement/buddy-score-service.ts", "utf8");
const adminAction = readFileSync("app/(admin)/admin/buddy-score/actions.ts", "utf8");

describe("Buddy Score ledger security", () => {
  it("is append-only and rejects duplicate sources", () => {
    expect(migration).toContain("buddy_score_ledger_immutable");
    expect(migration).toContain("unique (user_id, event_type, source_reference)");
    expect(service).toContain('ignoreDuplicates: true');
  });

  it("prevents client writes and protects the total RPC", () => {
    expect(migration).toContain("No insert/update/delete policy");
    expect(migration).toContain("auth.uid() is distinct from target_user_id");
    expect(migration).toContain("service_role");
  });

  it("blocks sensitive metadata", () => {
    for (const forbidden of ["latitude", "longitude", "coordinates", "token", "date_of_birth"]) expect(migration).toContain(`'${forbidden}'`);
  });

  it("requires an audited reason for manual correction", () => {
    expect(adminAction).toContain("recordAdminAuditEvent");
    expect(adminAction).toContain('min(8)');
    expect(adminAction).toContain('admin.buddy_score.manage');
  });

  it("supports reconciliation against the trusted database total", () => {
    expect(service).toContain('buddy_score_total');
    expect(service).toContain('ledgerTotal === rpcTotal');
  });
});
