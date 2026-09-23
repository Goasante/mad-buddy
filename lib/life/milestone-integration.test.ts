import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => stripComments(readFileSync(join(process.cwd(), path), "utf8"));

const actions = read("app/(app)/engagement-actions.ts");
const settingsUi = read("components/settings/engagement-page.tsx");
const badges = read("components/badges/badges-page.tsx");
const service = read("lib/life/milestone-service.ts");
const handlers = read("lib/jobs/handlers.ts");
const rules = read("lib/jobs/rules.ts");
const notifications = read("lib/notifications/server.ts");

describe("friendship milestones are a real end-to-end feature", () => {
  it("uses milestone names in the product while retaining old database columns only for compatibility", () => {
    expect(actions).toContain("milestonesEnabled");
    expect(actions).toContain("milestoneRemindersEnabled");
    expect(actions).toContain("streaks_enabled");
    expect(actions).toContain("streak_notifications_enabled");
    expect(actions).toContain("milestonesAvailable");
    expect(settingsUi).toContain("settings.milestonesAvailable");
    expect(settingsUi).toContain('label="Friendship milestones"');
    expect(settingsUi).toContain('label="Milestone reminders"');
    expect(settingsUi).not.toContain("streaksEnabled");
    expect(settingsUi).not.toContain("streakNotificationsEnabled");
  });

  it("reconciles factual source events and honors blocks and reminder preferences", () => {
    expect(service).toContain('eventType: "friendship.milestone_reached"');
    expect(service).toContain('"plan.attended_together"');
    expect(service).toContain('"reconnect.completed"');
    expect(service).toContain('from("blocked_users")');
    expect(service).toContain("streak_notifications_enabled");
    expect(service).toContain("milestone-reminder:");
    expect(service).toContain("deliverNotification");
    expect(service).toContain("LIFE_MILESTONES_FLAG");
    expect(service).toContain("isFeatureEnabled");
  });

  it("runs the reconciliation on the real job queue", () => {
    expect(rules).toContain('"life.reconcile_milestones"');
    expect(handlers).toContain('"life.reconcile_milestones"');
    expect(handlers).toContain("reconcileFriendshipMilestones");
  });

  it("shows Milestones instead of the abandoned Streaks surface", () => {
    expect(badges).toContain('{ id: "milestones", label: "Milestones" }');
    expect(badges).toContain("overview.milestones");
    expect(badges).not.toContain('label: "Streaks"');
    expect(badges).not.toContain("pauseStreakAction");
  });

  it("registers milestone reminders as a real notification type", () => {
    expect(notifications).toContain('| "friendship_milestone"');
  });
});
