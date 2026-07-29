import { describe, expect, it } from "vitest";
import {
  isEligibleForTour,
  isStepAvailable,
  isTourVersionLive,
  matchesCohort,
  parseTourAudience,
  replayableTours,
  resolveSteps,
  resumeIndex,
  selectTourToOffer,
  type TourProgress,
  type TourStep,
  type TourSubject,
  type TourVersion
} from "@/lib/tours/model";

const NOW = Date.parse("2026-07-29T12:00:00.000Z");
const PUBLISHED = "2026-07-20T00:00:00.000Z";

function step(overrides: Partial<TourStep> & { stepKey: string; position: number }): TourStep {
  return {
    id: `id-${overrides.stepKey}`,
    title: "Title",
    body: "Body",
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

function version(overrides: Partial<TourVersion> = {}): TourVersion {
  return {
    id: "version-1",
    tourId: "tour-1",
    slug: "main-app-tour",
    title: "Welcome",
    description: "",
    kind: "main",
    version: 1,
    status: "published",
    audience: { plans: ["free", "buddy_plus", "buddy_pro"], cohort: "all" },
    startsAt: null,
    endsAt: null,
    publishedAt: PUBLISHED,
    steps: [step({ stepKey: "welcome", position: 1 }), step({ stepKey: "ready", position: 2 })],
    ...overrides
  };
}

function subject(overrides: Partial<TourSubject> = {}): TourSubject {
  return {
    plan: "free",
    signupAt: "2026-07-01T00:00:00.000Z",
    enabledFeatureFlags: [],
    ...overrides
  };
}

describe("parseTourAudience", () => {
  it("falls back to a permissive default for malformed audience data", () => {
    // A bad jsonb row must never crash the shell that renders the tour.
    for (const bad of [null, undefined, 42, "all", {}, { plans: "free" }, { plans: [] }]) {
      expect(parseTourAudience(bad)).toEqual({
        plans: ["free", "buddy_plus", "buddy_pro"],
        cohort: "all"
      });
    }
  });

  it("keeps only real plans and known cohorts", () => {
    expect(parseTourAudience({ plans: ["buddy_pro", "enterprise"], cohort: "new" })).toEqual({
      plans: ["buddy_pro"],
      cohort: "new"
    });
    expect(parseTourAudience({ plans: ["free"], cohort: "nonsense" }).cohort).toBe("all");
  });
});

describe("isTourVersionLive", () => {
  it("requires published status", () => {
    expect(isTourVersionLive(version({ status: "draft" }), NOW)).toBe(false);
    expect(isTourVersionLive(version({ status: "retired" }), NOW)).toBe(false);
    expect(isTourVersionLive(version(), NOW)).toBe(true);
  });

  it("honours an optional schedule window against server time", () => {
    expect(isTourVersionLive(version({ startsAt: "2026-08-01T00:00:00.000Z" }), NOW)).toBe(false);
    expect(isTourVersionLive(version({ endsAt: "2026-07-01T00:00:00.000Z" }), NOW)).toBe(false);
    expect(
      isTourVersionLive(version({ startsAt: PUBLISHED, endsAt: "2026-08-01T00:00:00.000Z" }), NOW)
    ).toBe(true);
  });
});

describe("cohort targeting", () => {
  it("treats accounts created before publication as existing users", () => {
    const v = version({ audience: { plans: ["free"], cohort: "existing" } });
    expect(matchesCohort(v, subject({ signupAt: "2026-07-01T00:00:00.000Z" }))).toBe(true);
    expect(matchesCohort(v, subject({ signupAt: "2026-07-25T00:00:00.000Z" }))).toBe(false);
  });

  it("treats accounts created at or after publication as new users", () => {
    const v = version({ audience: { plans: ["free"], cohort: "new" } });
    expect(matchesCohort(v, subject({ signupAt: "2026-07-25T00:00:00.000Z" }))).toBe(true);
    expect(matchesCohort(v, subject({ signupAt: PUBLISHED }))).toBe(true);
    expect(matchesCohort(v, subject({ signupAt: "2026-07-01T00:00:00.000Z" }))).toBe(false);
  });

  it("matches everyone when the cohort is all", () => {
    expect(matchesCohort(version(), subject({ signupAt: "2020-01-01T00:00:00.000Z" }))).toBe(true);
  });
});

describe("feature-flag gating", () => {
  const socializeStep = step({ stepKey: "socialize", position: 2, requiresFeatureFlag: "socialize" });

  it("drops a step whose feature is disabled and keeps ungated steps", () => {
    expect(isStepAvailable(socializeStep, subject())).toBe(false);
    expect(isStepAvailable(socializeStep, subject({ enabledFeatureFlags: ["socialize"] }))).toBe(true);
    expect(isStepAvailable(step({ stepKey: "welcome", position: 1 }), subject())).toBe(true);
  });

  it("resolves steps in order with disabled ones removed", () => {
    const v = version({
      steps: [
        step({ stepKey: "ready", position: 3 }),
        socializeStep,
        step({ stepKey: "welcome", position: 1 })
      ]
    });
    expect(resolveSteps(v, subject()).map((s) => s.stepKey)).toEqual(["welcome", "ready"]);
    expect(resolveSteps(v, subject({ enabledFeatureFlags: ["socialize"] })).map((s) => s.stepKey)).toEqual([
      "welcome",
      "socialize",
      "ready"
    ]);
  });
});

describe("isEligibleForTour", () => {
  const done = (status: TourProgress["status"]): TourProgress => ({
    tourVersionId: "version-1",
    status,
    currentStepKey: null
  });

  it("offers a live tour to a user with no history for that version", () => {
    expect(isEligibleForTour(version(), subject(), null, NOW)).toBe(true);
  });

  it("never re-offers a version the user already resolved", () => {
    // Completed, skipped and dismissed all mean "resolved" — this is the
    // guarantee that a tour does not reappear for the same version.
    for (const status of ["completed", "skipped", "dismissed", "started"] as const) {
      expect(isEligibleForTour(version(), subject(), done(status), NOW)).toBe(false);
    }
  });

  it("re-opens the tour when a new version is published", () => {
    const v2 = version({ id: "version-2", version: 2, publishedAt: "2026-07-28T00:00:00.000Z" });
    // v1 history exists, but eligibility is per-version, so v2 is offered.
    expect(isEligibleForTour(v2, subject(), null, NOW)).toBe(true);
  });

  it("respects plan targeting", () => {
    const proOnly = version({ audience: { plans: ["buddy_pro"], cohort: "all" } });
    expect(isEligibleForTour(proOnly, subject({ plan: "free" }), null, NOW)).toBe(false);
    expect(isEligibleForTour(proOnly, subject({ plan: "buddy_pro" }), null, NOW)).toBe(true);
  });

  it("does not interrupt anyone when every step is behind a disabled feature", () => {
    const allGated = version({
      steps: [step({ stepKey: "socialize", position: 1, requiresFeatureFlag: "socialize" })]
    });
    expect(isEligibleForTour(allGated, subject(), null, NOW)).toBe(false);
    expect(isEligibleForTour(allGated, subject({ enabledFeatureFlags: ["socialize"] }), null, NOW)).toBe(true);
  });

  it("does not offer draft or scheduled-future versions", () => {
    expect(isEligibleForTour(version({ status: "draft" }), subject(), null, NOW)).toBe(false);
    expect(isEligibleForTour(version({ startsAt: "2026-08-05T00:00:00.000Z" }), subject(), null, NOW)).toBe(false);
  });
});

describe("selectTourToOffer", () => {
  it("prefers a feature mini-tour over the long main walkthrough", () => {
    const main = version({ id: "m", kind: "main", publishedAt: "2026-07-28T00:00:00.000Z" });
    const feature = version({ id: "f", kind: "feature", publishedAt: PUBLISHED });
    expect(selectTourToOffer([main, feature])?.id).toBe("f");
  });

  it("prefers the most recently published within the same kind", () => {
    const older = version({ id: "old", kind: "feature", publishedAt: "2026-07-01T00:00:00.000Z" });
    const newer = version({ id: "new", kind: "feature", publishedAt: "2026-07-28T00:00:00.000Z" });
    expect(selectTourToOffer([older, newer])?.id).toBe("new");
  });

  it("returns null when nothing is eligible", () => {
    expect(selectTourToOffer([])).toBeNull();
  });
});

describe("resumeIndex", () => {
  const steps = [
    step({ stepKey: "welcome", position: 1 }),
    step({ stepKey: "muddies", position: 2 }),
    step({ stepKey: "ready", position: 3 })
  ];

  it("resumes at the recorded step", () => {
    expect(resumeIndex(steps, { tourVersionId: "v", status: "started", currentStepKey: "muddies" })).toBe(1);
  });

  it("restarts when the recorded step no longer exists or is absent", () => {
    // A step deleted by a later content edit must not strand the user.
    expect(resumeIndex(steps, { tourVersionId: "v", status: "started", currentStepKey: "deleted" })).toBe(0);
    expect(resumeIndex(steps, { tourVersionId: "v", status: "started", currentStepKey: null })).toBe(0);
    expect(resumeIndex(steps, null)).toBe(0);
  });
});

describe("replayableTours", () => {
  it("offers live tours for manual replay even once already completed", () => {
    const live = version();
    const draft = version({ id: "d", status: "draft" });
    expect(replayableTours([live, draft], subject(), NOW).map((v) => v.id)).toEqual(["version-1"]);
  });

  it("hides a tour with no renderable steps for this subject", () => {
    const gated = version({
      steps: [step({ stepKey: "socialize", position: 1, requiresFeatureFlag: "socialize" })]
    });
    expect(replayableTours([gated], subject(), NOW)).toEqual([]);
    expect(replayableTours([gated], subject({ enabledFeatureFlags: ["socialize"] }), NOW)).toHaveLength(1);
  });
});
