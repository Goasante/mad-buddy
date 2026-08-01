import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260801160000_birthday_experience.sql"),
  "utf8"
).toLowerCase();

describe("birthday experience migration", () => {
  it("deduplicates each owner, recipient, and birthday day", () => {
    expect(sql).toContain("unique (birthday_user_id, recipient_id, birthday_day)");
    expect(sql).toContain("status in ('pending', 'processing', 'delivered', 'suppressed')");
  });

  it("keeps the delivery ledger service-only behind RLS", () => {
    expect(sql).toContain("alter table public.birthday_notification_deliveries enable row level security");
    expect(sql).not.toMatch(/create policy[\s\S]*birthday_notification_deliveries/);
  });

  it("returns only matching user ids and never exposes a birth year", () => {
    expect(sql).toContain("returns table(user_id uuid)");
    expect(sql).toContain("revoke all on function public.birthday_users_for_day");
    expect(sql).toContain("grant execute on function public.birthday_users_for_day");
  });
});
