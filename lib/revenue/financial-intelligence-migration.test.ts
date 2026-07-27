import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260727120000_financial_intelligence.sql"), "utf8").toLowerCase();

describe("financial intelligence migration", () => {
  it("stores verified fees without weakening the billing ledger deduplication", () => {
    expect(sql).toContain("add column if not exists provider_fee_minor");
    expect(sql).toContain("fee_status in ('verified', 'unavailable')");
    expect(sql).toContain("billing_events_missing_fee_idx");
  });

  it("makes snapshots idempotent per date and currency", () => {
    expect(sql).toContain("create table if not exists public.financial_snapshots");
    expect(sql).toContain("unique (snapshot_date, currency)");
  });

  it("stores reactivation and enforces reconciled movement integrity", () => {
    expect(sql).toContain("reactivation_mrr_minor bigint");
    expect(sql).toContain("reconciliation_required");
    expect(sql).toContain("financial_snapshots_reconciliation_consistency");
    expect(sql).toContain(
      "opening_mrr_minor + new_mrr_minor + expansion_mrr_minor + reactivation_mrr_minor"
    );
    expect(sql).toContain("- contraction_mrr_minor - churned_mrr_minor = ending_mrr_minor");
  });

  it("keeps financial mutations service-role only", () => {
    for (const table of ["financial_snapshots", "provider_cost_records", "business_alert_rules"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on table public.${table} from anon, authenticated`);
    }
    expect(sql).not.toMatch(/create policy[\s\S]*provider_cost_records/);
  });

  it("grants financial management only to the super administrator role", () => {
    expect(sql).toContain("'admin.revenue.manage'");
    expect(sql).toContain("where name = 'super_administrator'");
  });
});
