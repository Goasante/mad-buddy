import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  sameSubscriptionOwner,
  subscriptionDeleteScope
} from "@/lib/notifications/subscription-ownership";

describe("push subscription ownership", () => {
  it("always scopes deletion to the authenticated user and endpoint", () => {
    expect(subscriptionDeleteScope("user-a", "https://push.example/a")).toEqual({
      userId: "user-a",
      endpoint: "https://push.example/a"
    });
  });

  it("does not let another user inherit or delete an endpoint", () => {
    const expected = subscriptionDeleteScope("user-b", "https://push.example/shared");
    expect(
      sameSubscriptionOwner(
        { user_id: "user-a", endpoint: "https://push.example/shared" },
        expected
      )
    ).toBe(false);
  });

  it("is idempotent when the exact owned row is already gone", () => {
    const expected = subscriptionDeleteScope("user-a", "https://push.example/a");
    expect(sameSubscriptionOwner({ user_id: "user-a", endpoint: expected.endpoint }, expected)).toBe(true);
  });

  it("enforces ownership in RLS and in every deletion query", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase", "migrations", "20260717320000_push_subscriptions.sql"),
      "utf8"
    );
    const actions = readFileSync(join(process.cwd(), "app", "(app)", "push-actions.ts"), "utf8");
    const logout = readFileSync(join(process.cwd(), "app", "(auth)", "actions.ts"), "utf8");
    expect(migration).toContain("using (auth.uid() = user_id)");
    expect(migration).toContain("with check (auth.uid() = user_id)");
    expect(actions).toMatch(/delete\(\)[\s\S]*?\.eq\("user_id", userId\)[\s\S]*?\.eq\("endpoint"/);
    expect(logout).toMatch(/delete\(\)[\s\S]*?\.eq\("user_id", user\.id\)[\s\S]*?\.eq\("endpoint"/);
  });
});
