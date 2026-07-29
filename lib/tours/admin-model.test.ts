import { describe, expect, it } from "vitest";
import {
  buildFunnel,
  buildStepDropOff,
  canTransition,
  displayStatus,
  hasBlockingIssues,
  isSafeInternalPath,
  reorderSteps,
  validateVersionForPublish,
  type StepDraft
} from "@/lib/tours/admin-model";

const NOW = Date.parse("2026-07-29T12:00:00.000Z");

function draft(overrides: Partial<StepDraft> & { stepKey: string; position: number }): StepDraft {
  return {
    title: "Title",
    body: "Body copy",
    targetId: null,
    route: null,
    mediaPath: null,
    ctaLabel: null,
    ctaHref: null,
    requiresFeatureFlag: null,
    entitlementKeys: [],
    ...overrides
  };
}

const known = {
  knownTargetIds: ["home-nearby", "nav-friends"],
  knownFeatureFlags: ["socialize", "open_moments"],
  knownEntitlementKeys: ["max_muddies", "max_active_hangouts"]
};

describe("displayStatus", () => {
  it("derives scheduled and ended rather than storing them", () => {
    expect(displayStatus("published", "2026-08-05T00:00:00.000Z", null, NOW)).toBe("scheduled");
    expect(displayStatus("published", null, "2026-07-01T00:00:00.000Z", NOW)).toBe("ended");
    expect(displayStatus("published", null, null, NOW)).toBe("published");
  });

  it("reports stored statuses directly", () => {
    expect(displayStatus("draft", null, null, NOW)).toBe("draft");
    expect(displayStatus("paused", null, null, NOW)).toBe("paused");
    expect(displayStatus("retired", "2026-08-05T00:00:00.000Z", null, NOW)).toBe("retired");
  });
});

describe("status transitions", () => {
  it("allows publish, pause, resume and retire", () => {
    expect(canTransition("draft", "published")).toBe(true);
    expect(canTransition("published", "paused")).toBe(true);
    expect(canTransition("paused", "published")).toBe(true);
    expect(canTransition("published", "retired")).toBe(true);
  });

  it("treats retired as terminal", () => {
    // A retired version's cohort split was computed against a publication
    // moment that has passed; cloning to a new version is the way forward.
    expect(canTransition("retired", "published")).toBe(false);
    expect(canTransition("retired", "paused")).toBe(false);
    expect(canTransition("retired", "draft")).toBe(false);
  });

  it("never allows going back to draft once live", () => {
    expect(canTransition("published", "draft")).toBe(false);
    expect(canTransition("paused", "draft")).toBe(false);
  });
});

describe("isSafeInternalPath", () => {
  it("accepts internal app paths", () => {
    for (const path of ["/plans", "/settings/appearance/wallpaper", "/hangout-mode", "/"]) {
      expect(isSafeInternalPath(path)).toBe(true);
    }
  });

  it("rejects anything that could leave the app", () => {
    // An admin-authored tour must never become an open redirect.
    for (const path of [
      "https://evil.example",
      "//evil.example",
      "http://evil.example",
      "javascript:alert(1)",
      "/../../etc/passwd",
      "plans",
      "/plans?next=https://evil.example"
    ]) {
      expect(isSafeInternalPath(path)).toBe(false);
    }
  });
});

describe("validateVersionForPublish", () => {
  it("passes a clean single-step tour", () => {
    const issues = validateVersionForPublish({
      steps: [draft({ stepKey: "welcome", position: 1, targetId: "home-nearby" })],
      ...known
    });
    expect(issues).toEqual([]);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("blocks publishing an empty tour", () => {
    const issues = validateVersionForPublish({ steps: [], ...known });
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("blocks duplicate step keys and duplicate positions", () => {
    const dupKey = validateVersionForPublish({
      steps: [draft({ stepKey: "st-a", position: 1 }), draft({ stepKey: "st-a", position: 2 })],
      ...known
    });
    expect(dupKey.some((i) => i.message === "Duplicate step key.")).toBe(true);

    const dupPos = validateVersionForPublish({
      steps: [draft({ stepKey: "st-a", position: 1 }), draft({ stepKey: "st-b", position: 1 })],
      ...known
    });
    expect(dupPos.some((i) => i.message.includes("same position"))).toBe(true);
  });

  it("warns but does not block on an unverifiable target", () => {
    // The engine degrades a missing target to a plain card, so this is not
    // worth blocking a release over — but the admin should know.
    const issues = validateVersionForPublish({
      steps: [draft({ stepKey: "st-a", position: 1, targetId: "not-in-code" })],
      ...known
    });
    expect(hasBlockingIssues(issues)).toBe(false);
    expect(issues.some((i) => i.level === "warning" && i.message.includes("Unverified target"))).toBe(true);
  });

  it("blocks external routes and CTA links", () => {
    for (const field of ["route", "ctaHref"] as const) {
      const issues = validateVersionForPublish({
        steps: [draft({ stepKey: "st-a", position: 1, [field]: "https://evil.example", ctaLabel: "Go" })],
        ...known
      });
      expect(hasBlockingIssues(issues)).toBe(true);
    }
  });

  it("blocks unknown feature flags and unknown entitlements", () => {
    const flag = validateVersionForPublish({
      steps: [draft({ stepKey: "st-a", position: 1, requiresFeatureFlag: "nope" })],
      ...known
    });
    expect(hasBlockingIssues(flag)).toBe(true);

    // Blocking, not warning: a bogus entitlement key renders a plan claim with
    // nothing real behind it.
    const ent = validateVersionForPublish({
      steps: [draft({ stepKey: "st-a", position: 1, entitlementKeys: ["custom_wallpapers"] })],
      ...known
    });
    expect(hasBlockingIssues(ent)).toBe(true);
  });

  it("blocks a CTA link with no label, and a bad media path", () => {
    const noLabel = validateVersionForPublish({
      steps: [draft({ stepKey: "st-a", position: 1, ctaHref: "/upgrade" })],
      ...known
    });
    expect(hasBlockingIssues(noLabel)).toBe(true);

    const badMedia = validateVersionForPublish({
      steps: [draft({ stepKey: "st-a", position: 1, mediaPath: "/uploads/x.png" })],
      ...known
    });
    expect(hasBlockingIssues(badMedia)).toBe(true);
  });

  it("blocks an end date that precedes the start date", () => {
    const issues = validateVersionForPublish({
      steps: [draft({ stepKey: "st-a", position: 1 })],
      startsAt: "2026-08-10T00:00:00.000Z",
      endsAt: "2026-08-01T00:00:00.000Z",
      ...known
    });
    expect(hasBlockingIssues(issues)).toBe(true);
  });
});

describe("reorderSteps", () => {
  const steps = [
    draft({ stepKey: "st-a", position: 1 }),
    draft({ stepKey: "st-b", position: 2 }),
    draft({ stepKey: "st-c", position: 3 })
  ];

  it("moves a step and renumbers densely from 1", () => {
    expect(reorderSteps(steps, "st-c", "up").map((s) => [s.stepKey, s.position])).toEqual([
      ["st-a", 1],
      ["st-c", 2],
      ["st-b", 3]
    ]);
  });

  it("is a no-op at the ends but still normalises positions", () => {
    // Gaps or ties would violate unique (tour_version_id, position).
    const gappy = [draft({ stepKey: "st-a", position: 5 }), draft({ stepKey: "st-b", position: 9 })];
    expect(reorderSteps(gappy, "st-a", "up").map((s) => s.position)).toEqual([1, 2]);
    expect(reorderSteps(steps, "st-c", "down").map((s) => s.stepKey)).toEqual(["st-a", "st-b", "st-c"]);
  });

  it("normalises even when the step key is unknown", () => {
    expect(reorderSteps(steps, "missing", "up").map((s) => s.position)).toEqual([1, 2, 3]);
  });
});

describe("funnel and drop-off", () => {
  it("computes completion against those who started, not everyone eligible", () => {
    const funnel = buildFunnel(500, [
      { scope: "tour", eventType: "tour_shown", userCount: 200 },
      { scope: "tour", eventType: "tour_started", userCount: 100 },
      { scope: "tour", eventType: "tour_completed", userCount: 40 },
      { scope: "tour", eventType: "tour_skipped", userCount: 60 },
      { scope: "tour", eventType: "tour_cta_clicked", userCount: 7 },
      // Step rows must not leak into tour totals.
      { scope: "step", eventType: "tour_step_viewed", userCount: 999 }
    ]);
    expect(funnel).toEqual({
      eligible: 500,
      shown: 200,
      started: 100,
      completed: 40,
      skipped: 60,
      ctaClicks: 7,
      completionRate: 40
    });
  });

  it("sums plan-split rows for the same event", () => {
    const funnel = buildFunnel(10, [
      { scope: "tour", eventType: "tour_started", userCount: 6 },
      { scope: "tour", eventType: "tour_started", userCount: 4 }
    ]);
    expect(funnel.started).toBe(10);
  });

  it("avoids divide-by-zero with no data", () => {
    expect(buildFunnel(0, []).completionRate).toBe(0);
  });

  it("reports per-step retention relative to the first step", () => {
    const steps = [
      { id: "s1", stepKey: "st-a", position: 1, title: "A" },
      { id: "s2", stepKey: "st-b", position: 2, title: "B" },
      { id: "s3", stepKey: "st-c", position: 3, title: "C" }
    ];
    const rows = [
      { scope: "step", stepId: "s1", eventType: "tour_step_viewed", userCount: 100 },
      { scope: "step", stepId: "s2", eventType: "tour_step_viewed", userCount: 91 },
      { scope: "step", stepId: "s3", eventType: "tour_step_viewed", userCount: 76 },
      // Non-view events must not inflate retention.
      { scope: "step", stepId: "s3", eventType: "tour_cta_clicked", userCount: 50 }
    ];
    expect(buildStepDropOff(steps, rows).map((s) => s.retention)).toEqual([100, 91, 76]);
  });
});
