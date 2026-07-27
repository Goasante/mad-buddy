import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260727160000_controlled_premium_trials.sql"),
  "utf8"
).toLowerCase();

describe("controlled premium trial migration", () => {
  it("keeps trial configuration, history, events, and notification delivery separate from subscriptions", () => {
    for (const table of [
      "premium_trial_config",
      "premium_trials",
      "premium_trial_events",
      "premium_trial_notifications"
    ]) {
      expect(sql).toContain(`create table if not exists public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on table public.${table} from anon, authenticated`);
    }
    expect(sql).not.toMatch(/update\s+public\.subscriptions\s+set\s+status\s*=\s*'trialing'/);
  });

  it("uses the database clock, serialises simultaneous starts, and preserves permanent evidence", () => {
    expect(sql).toContain("clock_timestamp()");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("premium_trials_one_active_per_user_idx");
    expect(sql).toContain("premium trial history cannot be deleted");
    expect(sql).toContain("select 1 from public.premium_trials where user_id = p_user_id");
  });

  it("deduplicates lifecycle, conversion, and notification events", () => {
    expect(sql).toContain("event_key text not null unique");
    expect(sql).toContain("unique (trial_id, notification_type)");
    expect(sql).toContain("claim_premium_trial_notifications");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("'trial:converted:' || v_trial.id::text");
    expect(sql).toContain("on conflict (event_key) do nothing");
  });

  it("restricts mutations to the service role and stores no Paystack identifiers", () => {
    expect(sql).toContain("grant execute on function public.start_premium_trial");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("paystack_customer");
    expect(sql).not.toContain("transaction_reference");
  });

  it("processes ending-soon and expiration from the server clock", () => {
    expect(sql).toContain("process_premium_trial_lifecycle");
    expect(sql).toContain("trial_ends_at <= v_now + interval '24 hours'");
    expect(sql).toContain("trial_ends_at <= v_now");
    expect(sql).toContain("set status = 'expired'");
  });
});
