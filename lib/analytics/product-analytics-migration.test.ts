import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260726150000_product_analytics.sql"),
  "utf8"
).toLowerCase();

describe("product analytics migration", () => {
  it("reuses append-only domain events with deterministic deduplication", () => {
    expect(sql).toContain("alter table public.domain_events");
    expect(sql).toContain("domain_events_dedupe_idx");
    expect(sql).toContain("on conflict (dedupe_key)");
    expect(sql).toContain("analytics_daily_user_facts_unique");
    expect(sql).toContain("analytics_account_created after insert on public.profiles");
    expect(sql).toContain("analytics_subscription_created after insert on public.subscriptions");
  });

  it("keeps analytics service-role only and never adds private content fields", () => {
    expect(sql).toContain("alter table public.analytics_daily_user_facts enable row level security");
    expect(sql).not.toContain("create policy");
    for (const forbidden of ["latitude", "longitude", "exact_distance", "message_content", "destination_label", "custom_message"]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it("captures the required feature activity from authoritative domain tables", () => {
    for (const event of [
      "message_sent", "wave_sent", "ping_sent", "hangout_created", "hangout_joined",
      "plan_created", "event_created", "group_created", "socialize_enabled", "socialize_connection", "moment_created",
      "safe_arrival_started", "safe_arrival_completed", "achievement_unlocked", "invite_created"
    ]) {
      expect(sql).toContain(`'${event}'`);
    }
  });

  it("attributes Socialize only after an accepted Socialize request", () => {
    expect(sql).toContain("new.context_type = 'socialize'");
    expect(sql).toContain("friend_requests_context_type_check");
    expect(sql).toContain("'friend', 'socialize', 'other'");
  });

  it("stops new Socialize facts while preserving historical rows", () => {
    expect(sql).toContain("v_feature = 'socialize'");
    expect(sql).toContain("status = 'on'");
    expect(sql).not.toContain("delete from public.analytics_daily_user_facts");
  });

  it("grants report access to administrators but not support roles", () => {
    expect(sql).toContain("'admin.analytics.view'");
    expect(sql).toContain("'super_administrator', 'trust_safety_administrator'");
    expect(sql).not.toContain("'customer_support_agent', 'admin.analytics.view'");
  });
});
