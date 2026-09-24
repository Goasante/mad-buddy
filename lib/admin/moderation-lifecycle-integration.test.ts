import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { escalationForPoints, strikePointsForAction } from "@/lib/admin/moderation-strikes";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("reviewed report enforcement lifecycle", () => {
  it("never creates a penalty from the raw user report action", () => {
    const reportAction = read("app/(app)/actions.ts");
    const source = reportAction.slice(reportAction.indexOf("export async function reportUserAction"));
    expect(source).toContain('.from("reports").insert');
    expect(source).not.toContain("moderation_strikes");
    expect(source).not.toContain("applyUserRestriction");
  });

  it("records confirmed strikes only after an admin moderation decision", () => {
    const adminAction = read("app/(admin)/admin/reports/actions.ts");
    expect(adminAction).toContain("recordModerationStrike");
    expect(adminAction).toContain('actionType !== "no_action"');
    expect(adminAction).toContain('actionType !== "escalate"');
  });

  it("uses a transparent escalating recommendation ladder", () => {
    expect(escalationForPoints(2).level).toBe("none");
    expect(escalationForPoints(3).level).toBe("warning");
    expect(escalationForPoints(5).level).toBe("day_suspension");
    expect(escalationForPoints(8).level).toBe("week_suspension");
    expect(escalationForPoints(12).level).toBe("month_suspension");
    expect(escalationForPoints(16).level).toBe("permanent_review");
    expect(strikePointsForAction("no_action")).toBe(0);
  });

  it("shows penalties to admin and safe restriction details to the affected user", () => {
    expect(read("components/admin/moderation/report-review-panel.tsx")).toContain("active confirmed penalty point");
    expect(read("app/(app)/settings/account-status/page.tsx")).toContain("user_restrictions");
    expect(read("components/settings/account-status-page.tsx")).toContain("Submit appeal");
  });

  it("lets admin uphold or reverse an appeal and notifies the user", () => {
    const action = read("app/(admin)/admin/appeals/actions.ts");
    expect(action).toContain('decision: z.enum(["upheld", "reversed"])');
    expect(action).toContain("lifted_at");
    expect(action).toContain("deliverNotification");
  });
});
