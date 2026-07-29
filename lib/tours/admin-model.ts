import type { TourStatus } from "@/lib/tours/model";

/**
 * Pure admin-side tour rules: status transitions, publish validation, step
 * reordering, and target/route safety. No database and no React, so the rules
 * governing a global consumer-facing publish are unit-testable in isolation.
 */

export type AdminTourStatus = TourStatus | "paused";

/** What the admin list shows. 'scheduled' is derived, never stored. */
export type DisplayStatus = "draft" | "scheduled" | "published" | "paused" | "retired" | "ended";

export function displayStatus(
  status: AdminTourStatus,
  startsAt: string | null,
  endsAt: string | null,
  nowMs: number
): DisplayStatus {
  if (status === "draft") return "draft";
  if (status === "paused") return "paused";
  if (status === "retired") return "retired";
  if (endsAt && Date.parse(endsAt) <= nowMs) return "ended";
  if (startsAt && Date.parse(startsAt) > nowMs) return "scheduled";
  return "published";
}

/**
 * Allowed status moves. Retired is terminal: a retired version can never go
 * back to reaching consumers, because its cohort split was computed against a
 * publication moment that has since passed. Cloning to a new version is the
 * supported way forward, which also preserves the original's history.
 */
const TRANSITIONS: Record<AdminTourStatus, AdminTourStatus[]> = {
  draft: ["published", "retired"],
  published: ["paused", "retired"],
  paused: ["published", "retired"],
  retired: []
};

export function canTransition(from: AdminTourStatus, to: AdminTourStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export type StepDraft = {
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

const STEP_KEY = /^[a-z0-9-]{2,64}$/;
const TARGET_ID = /^[a-z0-9-]{2,64}$/;
/**
 * Internal paths only, and deliberately no protocol, host, or protocol-relative
 * form. An admin-authored tour must not be able to become an open redirect to an
 * external site, so anything that is not a single-slash-rooted internal path is
 * rejected outright rather than sanitised.
 */
const INTERNAL_PATH = /^\/[a-zA-Z0-9/_-]{0,120}$/;
const MEDIA_PATH = /^\/tours\/[a-zA-Z0-9/._-]{3,160}$/;

export function isSafeInternalPath(value: string): boolean {
  if (!INTERNAL_PATH.test(value)) return false;
  // Defence in depth against traversal and protocol-relative URLs even though
  // the pattern above already excludes ':' and '.'.
  if (value.startsWith("//")) return false;
  if (value.includes("..")) return false;
  return true;
}

export type ValidationIssue = {
  level: "error" | "warning";
  stepKey: string | null;
  message: string;
};

/**
 * Validates a version for publishing.
 *
 * Errors block publishing. Warnings do not, but are surfaced so an admin
 * publishes knowingly — an unverifiable target is the main case: it may be
 * rendered by a component this static check cannot see, and phase 1's engine
 * degrades a missing target to a plain card rather than breaking, so it is not
 * worth blocking a release over.
 */
export function validateVersionForPublish(input: {
  steps: StepDraft[];
  /** data-tour-id values found in the codebase, for target verification. */
  knownTargetIds: string[];
  /** Managed feature flag keys that exist. */
  knownFeatureFlags: string[];
  /** Canonical entitlement keys. */
  knownEntitlementKeys: string[];
  startsAt?: string | null;
  endsAt?: string | null;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { steps } = input;

  if (steps.length === 0) {
    issues.push({ level: "error", stepKey: null, message: "A tour needs at least one step before it can publish." });
  }

  const seenKeys = new Set<string>();
  const seenPositions = new Set<number>();

  for (const step of steps) {
    if (!STEP_KEY.test(step.stepKey)) {
      issues.push({ level: "error", stepKey: step.stepKey, message: "Step key must be lowercase letters, numbers or hyphens." });
    }
    if (seenKeys.has(step.stepKey)) {
      issues.push({ level: "error", stepKey: step.stepKey, message: "Duplicate step key." });
    }
    seenKeys.add(step.stepKey);

    if (seenPositions.has(step.position)) {
      issues.push({ level: "error", stepKey: step.stepKey, message: "Two steps share the same position." });
    }
    seenPositions.add(step.position);

    if (step.title.trim().length < 2) {
      issues.push({ level: "error", stepKey: step.stepKey, message: "Step needs a title." });
    }
    if (step.body.trim().length < 2) {
      issues.push({ level: "error", stepKey: step.stepKey, message: "Step needs body copy." });
    }
    if (step.body.length > 600) {
      issues.push({ level: "error", stepKey: step.stepKey, message: "Body copy is longer than 600 characters." });
    }

    if (step.targetId) {
      if (!TARGET_ID.test(step.targetId)) {
        issues.push({ level: "error", stepKey: step.stepKey, message: `Invalid target id "${step.targetId}".` });
      } else if (!input.knownTargetIds.includes(step.targetId)) {
        issues.push({
          level: "warning",
          stepKey: step.stepKey,
          message: `Unverified target "${step.targetId}" — no matching data-tour-id was found in the app.`
        });
      }
    }

    for (const [label, path] of [
      ["Route", step.route],
      ["CTA link", step.ctaHref]
    ] as const) {
      if (path && !isSafeInternalPath(path)) {
        issues.push({
          level: "error",
          stepKey: step.stepKey,
          message: `${label} must be an internal path such as /plans.`
        });
      }
    }

    if (step.mediaPath && !MEDIA_PATH.test(step.mediaPath)) {
      issues.push({ level: "error", stepKey: step.stepKey, message: "Media must be a path under /tours/." });
    }

    if (step.ctaHref && !step.ctaLabel) {
      issues.push({ level: "error", stepKey: step.stepKey, message: "A CTA link needs a button label." });
    }

    if (step.requiresFeatureFlag && !input.knownFeatureFlags.includes(step.requiresFeatureFlag)) {
      issues.push({
        level: "error",
        stepKey: step.stepKey,
        message: `Unknown feature flag "${step.requiresFeatureFlag}".`
      });
    }

    for (const key of step.entitlementKeys) {
      if (!input.knownEntitlementKeys.includes(key)) {
        // Blocking, not a warning: a tour that names a non-existent entitlement
        // would render a plan claim with no real value behind it.
        issues.push({ level: "error", stepKey: step.stepKey, message: `Unknown entitlement "${key}".` });
      }
    }
  }

  if (input.startsAt && input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
    issues.push({ level: "error", stepKey: null, message: "End date must be after the start date." });
  }

  return issues;
}

export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.level === "error");
}

/**
 * Moves a step and renumbers everything to a dense 1..n sequence, so the stored
 * order is always deterministic and never leaves gaps or ties that the unique
 * (tour_version_id, position) constraint would reject.
 */
export function reorderSteps(steps: StepDraft[], stepKey: string, direction: "up" | "down"): StepDraft[] {
  const ordered = steps.slice().sort((a, b) => a.position - b.position);
  const index = ordered.findIndex((step) => step.stepKey === stepKey);
  if (index < 0) return ordered.map((step, i) => ({ ...step, position: i + 1 }));

  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= ordered.length) {
    return ordered.map((step, i) => ({ ...step, position: i + 1 }));
  }

  const next = ordered.slice();
  [next[index], next[swapWith]] = [next[swapWith], next[index]];
  return next.map((step, i) => ({ ...step, position: i + 1 }));
}

/** Funnel + drop-off, derived from the analytics aggregate rows. */
export type TourFunnel = {
  eligible: number;
  shown: number;
  started: number;
  completed: number;
  skipped: number;
  ctaClicks: number;
  completionRate: number;
};

export function buildFunnel(
  eligible: number,
  rows: Array<{ scope: string; eventType: string; userCount: number }>
): TourFunnel {
  const tally = (eventType: string) =>
    rows
      .filter((row) => row.scope === "tour" && row.eventType === eventType)
      .reduce((sum, row) => sum + row.userCount, 0);

  const shown = tally("tour_shown");
  const started = tally("tour_started");
  const completed = tally("tour_completed");

  return {
    eligible,
    shown,
    started,
    completed,
    skipped: tally("tour_skipped"),
    ctaClicks: tally("tour_cta_clicked"),
    // Of those who actually began, not of everyone eligible — otherwise the
    // number mostly measures how many people were shown an invitation.
    completionRate: started > 0 ? Math.round((completed / started) * 100) : 0
  };
}

/**
 * Per-step retention relative to the first step, which is what makes a
 * drop-off column readable at a glance.
 */
export function buildStepDropOff(
  steps: Array<{ id: string; stepKey: string; position: number; title: string }>,
  rows: Array<{ scope: string; stepId: string | null; eventType: string; userCount: number }>
): Array<{ stepKey: string; title: string; position: number; viewers: number; retention: number }> {
  const ordered = steps.slice().sort((a, b) => a.position - b.position);
  const viewersFor = (stepId: string) =>
    rows
      .filter((row) => row.scope === "step" && row.stepId === stepId && row.eventType === "tour_step_viewed")
      .reduce((sum, row) => sum + row.userCount, 0);

  const first = ordered.length > 0 ? viewersFor(ordered[0].id) : 0;
  return ordered.map((step) => {
    const viewers = viewersFor(step.id);
    return {
      stepKey: step.stepKey,
      title: step.title,
      position: step.position,
      viewers,
      retention: first > 0 ? Math.round((viewers / first) * 100) : 0
    };
  });
}
