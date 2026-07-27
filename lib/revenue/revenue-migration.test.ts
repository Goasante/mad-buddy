import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260726180000_revenue_intelligence.sql"), "utf8");

describe("revenue intelligence migration", () => {
  it("keeps billing facts append-only and inaccessible to consumer sessions", () => {
    expect(sql).toContain("create table if not exists public.billing_events");
    expect(sql).toContain("dedupe_key text not null unique");
    expect(sql).toContain("alter table public.billing_events enable row level security");
    expect(sql).not.toContain("create policy");
  });

  it("aggregates current subscriptions and media bytes in Postgres", () => {
    expect(sql).toContain("get_revenue_subscription_snapshot");
    expect(sql).toContain("get_admin_media_storage_summary");
    expect(sql).toContain("grant execute on function public.get_revenue_subscription_snapshot");
  });

  it("grants revenue reporting only to owner/admin governance roles", () => {
    expect(sql).toContain("'admin.revenue.view'");
    expect(sql).toContain("'super_administrator', 'trust_safety_administrator'");
    expect(sql).not.toContain("'customer_support_agent', 'admin.revenue.view'");
  });
});

