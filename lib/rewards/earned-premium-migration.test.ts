import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const migration = readFileSync("supabase/migrations/20260801180000_earned_premium_rewards.sql", "utf8");
const service = readFileSync("lib/rewards/earned-premium-service.ts", "utf8");
const adminActions = readFileSync("app/(admin)/admin/buddy-score/actions.ts", "utf8");
describe("earned reward persistence", () => {
  it("keeps earned access separate from subscriptions", () => expect(migration).toContain("earned_premium_rewards"));
  it("blocks client mutations while allowing own history reads", () => { expect(migration).toContain("users read own earned rewards"); expect(migration).toContain("No client mutation policy"); });
  it("stores snapshots, expiry, rule versions, reminders, grace and revocation", () => { for (const field of ["source_score_snapshot", "expires_at", "grace_ends_at", "ending_notified_at", "rule_version", "revoked_at", "revoke_reason"]) expect(migration).toContain(field); });
  it("uses idempotent grants, one open reward and server timestamps", () => { expect(service).toContain('onConflict: "grant_key"'); expect(service).toContain("new Date()"); expect(migration).toContain("earned_rewards_one_open_per_user_idx"); });
  it("does not use private messages, location or contacts", () => { expect(service).not.toMatch(/latitude|longitude|message_content|contacts/); });
  it("requires permission, rate limiting and audit before an admin revocation", () => {
    expect(adminActions).toContain('requireAdminPermission(admin, context, "admin.buddy_score.manage")');
    expect(adminActions).toContain('consumeRateLimit({ action: "admin.mutate"');
    expect(adminActions).toContain('action: "earned_premium_reward_revocation_requested"');
    expect(adminActions.indexOf("recordAdminAuditEvent")).toBeLessThan(adminActions.lastIndexOf("revokeEarnedReward(admin"));
  });
});
