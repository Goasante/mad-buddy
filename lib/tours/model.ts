import type { SubscriptionPlan } from "@/lib/supabase/database.types";

/**
 * Pure guided-tour rules: audience eligibility, per-version resolution, and
 * step filtering. No database, no React, no clock of its own — every decision
 * is a function of values passed in, so the rules that decide whether a user is
 * interrupted are unit-testable in isolation.
 */

export type TourStatus = "draft" | "published" | "retired";
export type TourProgressStatus = "started" | "completed" | "skipped" | "dismissed";
export type TourCohort = "all" | "new" | "existing";

export type TourAudience = {
  plans: SubscriptionPlan[];
  cohort: TourCohort;
};

export type TourStep = {
  id: string;
  stepKey: string;
  position: number;
  title: string;
  body: string;
  targetId: string | null;
  route: string | null;
  mediaPath: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  requiresFeatureFlag: string | null;
  entitlementKeys: string[];
};

export type TourVersion = {
  id: string;
  tourId: string;
  slug: string;
  title: string;
  description: string;
  kind: "main" | "feature";
  version: number;
  status: TourStatus;
  audience: TourAudience;
  startsAt: string | null;
  endsAt: string | null;
  publishedAt: string | null;
  steps: TourStep[];
};

export type TourProgress = {
  tourVersionId: string;
  status: TourProgressStatus;
  currentStepKey: string | null;
};

export type TourSubject = {
  plan: SubscriptionPlan;
  /** Account creation time, used only to separate new from existing users. */
  signupAt: string;
  /** Managed feature flags that are currently ON for this subject. */
  enabledFeatureFlags: string[];
};

const DEFAULT_AUDIENCE: TourAudience = {
  plans: ["free", "buddy_plus", "buddy_pro"],
  cohort: "all"
};

/**
 * Normalises the stored `audience` jsonb. Anything malformed falls back to the
 * permissive default rather than throwing: a bad audience row must not be able
 * to crash the authenticated shell that renders the tour.
 */
export function parseTourAudience(value: unknown): TourAudience {
  if (!value || typeof value !== "object") return DEFAULT_AUDIENCE;
  const raw = value as { plans?: unknown; cohort?: unknown };

  const plans = Array.isArray(raw.plans)
    ? raw.plans.filter((plan): plan is SubscriptionPlan =>
        plan === "free" || plan === "buddy_plus" || plan === "buddy_pro"
      )
    : [];

  const cohort: TourCohort =
    raw.cohort === "new" || raw.cohort === "existing" || raw.cohort === "all" ? raw.cohort : "all";

  return {
    plans: plans.length > 0 ? plans : DEFAULT_AUDIENCE.plans,
    cohort
  };
}

/**
 * Whether a version is live right now. A schedule window is optional; when
 * present it is evaluated against the caller-supplied server time, never a
 * client clock.
 */
export function isTourVersionLive(version: TourVersion, nowMs: number): boolean {
  if (version.status !== "published") return false;
  if (version.startsAt && Date.parse(version.startsAt) > nowMs) return false;
  if (version.endsAt && Date.parse(version.endsAt) <= nowMs) return false;
  return true;
}

/**
 * Cohort split. "new" means the account was created at or after this version
 * was published; "existing" means it predates publication. Deriving it from
 * signup vs publish time means no extra per-user state has to be maintained,
 * and it stays correct for a version published later.
 */
export function matchesCohort(version: TourVersion, subject: TourSubject): boolean {
  if (version.audience.cohort === "all") return true;
  if (!version.publishedAt) return false;

  const signedUpMs = Date.parse(subject.signupAt);
  const publishedMs = Date.parse(version.publishedAt);
  if (Number.isNaN(signedUpMs) || Number.isNaN(publishedMs)) return true;

  return version.audience.cohort === "new" ? signedUpMs >= publishedMs : signedUpMs < publishedMs;
}

/**
 * A step is renderable when its feature flag (if any) is on for this subject.
 * A step naming a disabled feature is dropped entirely — the tour never teaches
 * functionality the user cannot reach.
 */
export function isStepAvailable(step: TourStep, subject: TourSubject): boolean {
  if (!step.requiresFeatureFlag) return true;
  return subject.enabledFeatureFlags.includes(step.requiresFeatureFlag);
}

/** Renderable steps in order, renumbered so "step 3 of 9" reflects reality. */
export function resolveSteps(version: TourVersion, subject: TourSubject): TourStep[] {
  return version.steps
    .filter((step) => isStepAvailable(step, subject))
    .slice()
    .sort((a, b) => a.position - b.position);
}

/**
 * Whether this user should be offered this version.
 *
 * Any existing progress row disqualifies it, whatever its status — completed,
 * skipped and dismissed all mean "already resolved for this version". That is
 * what stops a tour reappearing, and it is why re-showing a tour is done by
 * publishing a NEW version rather than deleting history.
 */
export function isEligibleForTour(
  version: TourVersion,
  subject: TourSubject,
  progress: TourProgress | null,
  nowMs: number
): boolean {
  if (progress) return false;
  if (!isTourVersionLive(version, nowMs)) return false;
  if (!version.audience.plans.includes(subject.plan)) return false;
  if (!matchesCohort(version, subject)) return false;
  // An all-steps-hidden tour (every step behind a disabled flag) is not worth
  // interrupting anyone for.
  return resolveSteps(version, subject).length > 0;
}

/**
 * Picks the single tour to offer when more than one is eligible. Feature
 * mini-tours win over the long main walkthrough, then most recently published,
 * so a launch announcement is not buried behind a general tour.
 */
export function selectTourToOffer(
  eligible: TourVersion[]
): TourVersion | null {
  if (eligible.length === 0) return null;
  return eligible.slice().sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "feature" ? -1 : 1;
    const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return bTime - aTime;
  })[0];
}

/**
 * Where a resumed tour should continue. An unknown or removed step key falls
 * back to the beginning rather than stranding the user on a step that a later
 * content edit deleted.
 */
export function resumeIndex(steps: TourStep[], progress: TourProgress | null): number {
  if (!progress?.currentStepKey) return 0;
  const index = steps.findIndex((step) => step.stepKey === progress.currentStepKey);
  return index >= 0 ? index : 0;
}

/** Tours the user may replay on demand, regardless of prior completion. */
export function replayableTours(versions: TourVersion[], subject: TourSubject, nowMs: number): TourVersion[] {
  return versions
    .filter((version) => isTourVersionLive(version, nowMs))
    .filter((version) => resolveSteps(version, subject).length > 0);
}
