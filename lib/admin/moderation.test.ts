import { describe, expect, it } from "vitest";
import {
  allowedReportTransitions,
  availableModerationActions,
  canTransitionReport,
  categoryLabel,
  CONTENT_REPORT_CATEGORIES,
  isAccountSuspension,
  isHighSignalCategory,
  isTerminalReportStatus,
  MODERATION_ACTION_LADDER,
  moderationActionSeverity,
  moderationActionToRestriction,
  moderationRequiresReason,
  moderationTakesDuration,
  reportStatusLabel,
  reportStatusTone
} from "@/lib/admin/moderation";
import { RESTRICTION_LADDER } from "@/lib/admin/governance";

describe("report status transitions", () => {
  it("allows documented user-report transitions and rejects illegal ones", () => {
    expect(canTransitionReport("user", "open", "reviewing")).toBe(true);
    expect(canTransitionReport("user", "reviewing", "resolved")).toBe(true);
    expect(canTransitionReport("user", "resolved", "reviewing")).toBe(true); // reopen
    expect(canTransitionReport("user", "open", "open")).toBe(false); // no-op
    expect(canTransitionReport("user", "resolved", "open")).toBe(false); // only reopen to reviewing
  });

  it("allows documented content-report transitions and rejects illegal ones", () => {
    expect(canTransitionReport("content", "received", "under_review")).toBe(true);
    expect(canTransitionReport("content", "under_review", "actioned")).toBe(true);
    expect(canTransitionReport("content", "actioned", "under_review")).toBe(true); // reopen
    expect(canTransitionReport("content", "dismissed", "actioned")).toBe(false);
    expect(canTransitionReport("content", "received", "received")).toBe(false);
  });

  it("labels statuses per kind", () => {
    expect(reportStatusLabel("content", "under_review")).toBe("Under review");
    expect(reportStatusLabel("user", "reviewing")).toBe("Reviewing");
  });

  it("tones open/received as danger and terminal-success as success", () => {
    expect(reportStatusTone("user", "open")).toBe("danger");
    expect(reportStatusTone("content", "received")).toBe("danger");
    expect(reportStatusTone("user", "resolved")).toBe("success");
    expect(reportStatusTone("content", "actioned")).toBe("success");
    expect(reportStatusTone("user", "dismissed")).toBe("default");
  });

  it("recognises terminal statuses", () => {
    expect(isTerminalReportStatus("resolved")).toBe(true);
    expect(isTerminalReportStatus("actioned")).toBe(true);
    expect(isTerminalReportStatus("dismissed")).toBe(true);
    expect(isTerminalReportStatus("under_review")).toBe(false);
  });

  it("never yields a transition target outside the canonical set", () => {
    for (const from of ["open", "reviewing", "resolved", "dismissed"]) {
      for (const to of allowedReportTransitions("user", from)) {
        expect(["open", "reviewing", "resolved", "dismissed"]).toContain(to);
      }
    }
  });
});

describe("moderation action ladder", () => {
  it("maps enforcement actions to the correct restriction and content actions to none", () => {
    expect(moderationActionToRestriction("warn_user")).toBe("warn");
    expect(moderationActionToRestriction("rate_limit_user")).toBe("rate_limited");
    expect(moderationActionToRestriction("temporary_suspension")).toBe("suspended_temporary");
    expect(moderationActionToRestriction("permanent_suspension")).toBe("suspended_permanent");
    expect(moderationActionToRestriction("suspend_feature")).toBe("messaging_disabled");
    expect(moderationActionToRestriction("hide_content")).toBeNull();
    expect(moderationActionToRestriction("no_action")).toBeNull();
    expect(moderationActionToRestriction("escalate")).toBeNull();
  });

  it("every mapped restriction is a real ladder restriction", () => {
    for (const action of MODERATION_ACTION_LADDER) {
      const restriction = moderationActionToRestriction(action);
      if (restriction) expect(RESTRICTION_LADDER).toContain(restriction);
    }
  });

  it("orders severity so suspensions outrank content ops and warnings", () => {
    expect(moderationActionSeverity("permanent_suspension")).toBeGreaterThan(moderationActionSeverity("warn_user"));
    expect(moderationActionSeverity("warn_user")).toBeGreaterThan(moderationActionSeverity("hide_content"));
    expect(moderationActionSeverity("temporary_suspension")).toBeGreaterThan(moderationActionSeverity("rate_limit_user"));
  });

  it("offers content-only actions solely on content reports", () => {
    const content = availableModerationActions("content");
    const user = availableModerationActions("user");
    expect(content).toContain("remove_content");
    expect(user).not.toContain("remove_content");
    expect(user).not.toContain("hide_content");
    expect(user).toContain("temporary_suspension");
  });

  it("requires a reason for everything except no_action", () => {
    expect(moderationRequiresReason("no_action")).toBe(false);
    expect(moderationRequiresReason("warn_user")).toBe(true);
    expect(moderationRequiresReason("permanent_suspension")).toBe(true);
  });

  it("takes a duration only for a temporary suspension", () => {
    expect(moderationTakesDuration("temporary_suspension")).toBe(true);
    expect(moderationTakesDuration("permanent_suspension")).toBe(false);
    expect(moderationTakesDuration("warn_user")).toBe(false);
  });

  it("flags account suspensions", () => {
    expect(isAccountSuspension("temporary_suspension")).toBe(true);
    expect(isAccountSuspension("permanent_suspension")).toBe(true);
    expect(isAccountSuspension("warn_user")).toBe(false);
  });
});

describe("content categories", () => {
  it("labels every category", () => {
    for (const category of CONTENT_REPORT_CATEGORIES) {
      expect(categoryLabel(category)).not.toBe(category);
    }
  });

  it("flags location/safety-critical categories as high-signal", () => {
    expect(isHighSignalCategory("dangerous_location_sharing")).toBe(true);
    expect(isHighSignalCategory("threat_or_violence")).toBe(true);
    expect(isHighSignalCategory("private_information")).toBe(true);
    expect(isHighSignalCategory("spam")).toBe(false);
  });
});
