import "server-only";

import { BOOLEAN_ENTITLEMENTS, NUMERIC_ENTITLEMENTS } from "@/lib/billing/entitlement-catalog";
import { MANAGED_FEATURES } from "@/lib/features/feature-flags";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildFunnel,
  buildStepDropOff,
  canTransition,
  displayStatus,
  hasBlockingIssues,
  validateVersionForPublish,
  type AdminTourStatus,
  type DisplayStatus,
  type StepDraft,
  type TourFunnel,
  type ValidationIssue
} from "@/lib/tours/admin-model";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Admin side of guided tours. Every mutation here is server-authoritative and
 * audit-gated: the audit row is written FIRST and the action is refused if that
 * write fails, matching the repo rule that an unlogged privileged action is
 * worse than a failed one.
 *
 * Callers must already have checked `admin.tours.manage` via
 * requireAdminPagePermission / requireAdminPermission — this module trusts the
 * actor it is handed.
 */

export const KNOWN_FEATURE_FLAG_KEYS: string[] = MANAGED_FEATURES.map((feature) => feature.key as string);
export const KNOWN_ENTITLEMENT_KEYS: string[] = [
  ...NUMERIC_ENTITLEMENTS.map((entry) => entry.key as string),
  ...BOOLEAN_ENTITLEMENTS.map((entry) => entry.key as string)
];

export type AdminTourListRow = {
  tourId: string;
  versionId: string;
  slug: string;
  title: string;
  kind: "main" | "feature";
  version: number;
  status: AdminTourStatus;
  display: DisplayStatus;
  plans: string[];
  cohort: string;
  startsAt: string | null;
  endsAt: string | null
  stepCount: number;
  updatedAt: string;
  updatedBy: string | null;
  publishReason: string | null;
};

/**
 * Every data-tour-id the app actually renders, scraped from source so publish
 * validation can flag a target that no longer exists. Best-effort by design:
 * a dynamic template literal cannot be resolved statically, so an unmatched
 * target is reported as a warning, never a block.
 */
export async function collectKnownTargetIds(): Promise<string[]> {
  try {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const roots = ["components", "app"];
    const found = new Set<string>();

    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          await walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const text = await readFile(path, "utf8");
        for (const match of text.matchAll(/data-tour-id=["']([a-z0-9-]+)["']/g)) {
          found.add(match[1]);
        }
        // Canonical component usage, e.g. tourTarget(TOUR_TARGET_IDS.HOME_NEARBY).
        for (const match of text.matchAll(/TOUR_TARGET_IDS\.([A-Z0-9_]+)/g)) {
          const id = TOUR_TARGET_IDS[match[1] as keyof typeof TOUR_TARGET_IDS];
          if (id) found.add(id);
        }
        // Route-derived ids, e.g. data-tour-id={`nav-${item.href.slice(1)}`}
        for (const match of text.matchAll(/data-tour-id=\{`([a-z-]+)-\$\{/g)) {
          found.add(`${match[1]}-*`);
        }
      }
    };

    for (const root of roots) {
      await walk(root).catch(() => undefined);
    }
    return [...found];
  } catch {
    return [];
  }
}

/**
 * Expands the wildcard entries from collectKnownTargetIds (e.g. "nav-*") so a
 * concrete id like "nav-friends" verifies against a template-generated target.
 */
export function targetIsKnown(targetId: string, knownTargetIds: string[]): boolean {
  if (knownTargetIds.includes(targetId)) return true;
  return knownTargetIds.some((known) => known.endsWith("-*") && targetId.startsWith(known.slice(0, -1)));
}

export async function listAdminTours(admin: Admin): Promise<AdminTourListRow[]> {
  const { data } = await admin
    .from("tour_versions")
    .select(
      "id, tour_id, version, status, audience, starts_at, ends_at, updated_at, updated_by, publish_reason, tours!inner(slug, title, kind), tour_steps(count)"
    )
    .order("updated_at", { ascending: false });

  const nowMs = Date.now();
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const tour = row.tours as { slug: string; title: string; kind: string } | null;
    const audience = (row.audience ?? {}) as { plans?: unknown; cohort?: unknown };
    const status = row.status as AdminTourStatus;
    const startsAt = (row.starts_at as string | null) ?? null;
    const endsAt = (row.ends_at as string | null) ?? null;
    const steps = row.tour_steps as Array<{ count: number }> | null;

    return {
      tourId: row.tour_id as string,
      versionId: row.id as string,
      slug: tour?.slug ?? "unknown",
      title: tour?.title ?? "Unknown tour",
      kind: tour?.kind === "main" ? "main" : "feature",
      version: row.version as number,
      status,
      display: displayStatus(status, startsAt, endsAt, nowMs),
      plans: Array.isArray(audience.plans) ? (audience.plans as string[]) : [],
      cohort: typeof audience.cohort === "string" ? audience.cohort : "all",
      startsAt,
      endsAt,
      stepCount: steps?.[0]?.count ?? 0,
      updatedAt: row.updated_at as string,
      updatedBy: (row.updated_by as string | null) ?? null,
      publishReason: (row.publish_reason as string | null) ?? null
    };
  });
}

/**
 * Display status for one version. Lives here rather than in the page because
 * reading the clock inside a component body trips the react-hooks/purity rule —
 * and a service is the right home for it regardless.
 */
export function resolveDisplayStatus(
  status: AdminTourStatus,
  startsAt: string | null,
  endsAt: string | null
): DisplayStatus {
  return displayStatus(status, startsAt, endsAt, Date.now());
}

export async function loadVersionSteps(admin: Admin, versionId: string): Promise<StepDraft[]> {
  const { data } = await admin
    .from("tour_steps")
    .select(
      "step_key, position, title, body, target_id, route, media_path, cta_label, cta_href, requires_feature_flag, entitlement_keys"
    )
    .eq("tour_version_id", versionId)
    .order("position", { ascending: true });

  return (data ?? []).map((row) => ({
    stepKey: row.step_key,
    position: row.position,
    title: row.title,
    body: row.body,
    targetId: row.target_id,
    route: row.route,
    mediaPath: row.media_path,
    ctaLabel: row.cta_label,
    ctaHref: row.cta_href,
    requiresFeatureFlag: row.requires_feature_flag,
    entitlementKeys: row.entitlement_keys ?? []
  }));
}

export async function validateVersion(admin: Admin, versionId: string): Promise<ValidationIssue[]> {
  const [steps, knownTargetIds, versionRow] = await Promise.all([
    loadVersionSteps(admin, versionId),
    collectKnownTargetIds(),
    admin.from("tour_versions").select("starts_at, ends_at").eq("id", versionId).maybeSingle()
  ]);

  const issues = validateVersionForPublish({
    steps,
    // Pre-expand wildcards so template-generated ids verify correctly.
    knownTargetIds: steps
      .map((step) => step.targetId)
      .filter((id): id is string => Boolean(id) && targetIsKnown(id as string, knownTargetIds)),
    knownFeatureFlags: KNOWN_FEATURE_FLAG_KEYS,
    knownEntitlementKeys: KNOWN_ENTITLEMENT_KEYS,
    startsAt: versionRow.data?.starts_at ?? null,
    endsAt: versionRow.data?.ends_at ?? null
  });
  return issues;
}

/**
 * Changes a version's lifecycle status. Refuses illegal transitions, refuses to
 * publish a version with blocking validation issues, and refuses entirely if the
 * audit write fails.
 */
export async function setVersionStatus(input: {
  admin: Admin;
  actorId: string;
  actorRole: string;
  versionId: string;
  to: AdminTourStatus;
  reason?: string;
}): Promise<{ ok: boolean; message: string; issues?: ValidationIssue[] }> {
  const { admin, versionId, to } = input;

  const { data: current } = await admin
    .from("tour_versions")
    .select("status, published_at, tour_id, version")
    .eq("id", versionId)
    .maybeSingle();
  if (!current) return { ok: false, message: "That tour version no longer exists." };

  const from = current.status as AdminTourStatus;
  if (!canTransition(from, to)) {
    return { ok: false, message: `A ${from} version cannot become ${to}.` };
  }

  if (to === "published") {
    const issues = await validateVersion(admin, versionId);
    if (hasBlockingIssues(issues)) {
      return { ok: false, message: "Fix the errors below before publishing.", issues };
    }
  }

  const action =
    to === "published" ? (from === "paused" ? "tour.resumed" : "tour.published") : to === "paused" ? "tour.paused" : "tour.retired";

  // Audit first: refuse the action if it cannot be logged.
  const logged = await recordAdminAuditEvent(admin, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    action,
    targetType: "tour_version",
    targetId: versionId,
    previousState: { status: from },
    newState: { status: to },
    reason: input.reason
  });
  if (!logged) return { ok: false, message: "The action was not recorded, so it was not applied." };

  const { error } = await admin
    .from("tour_versions")
    .update({
      status: to,
      // Pausing keeps published_at: the new-vs-existing cohort split is derived
      // from it, so clearing it would silently reclassify every user.
      published_at: to === "published" && !current.published_at ? new Date().toISOString() : current.published_at,
      publish_reason: input.reason ?? null,
      updated_by: input.actorId,
      updated_at: new Date().toISOString()
    })
    .eq("id", versionId);

  if (error) return { ok: false, message: "The status could not be updated." };
  return { ok: true, message: `Version ${current.version} is now ${to}.` };
}

/**
 * Creates the next version of an existing tour by cloning a source version's
 * steps. This is the supported way to re-show a tour: existing progress rows
 * point at the OLD version id, so everyone becomes eligible again while v1
 * history and its analytics stay intact. Nothing is ever deleted.
 */
export async function cloneVersion(input: {
  admin: Admin;
  actorId: string;
  actorRole: string;
  sourceVersionId: string;
}): Promise<{ ok: boolean; message: string; versionId?: string }> {
  const { admin, sourceVersionId } = input;

  const { data: source } = await admin
    .from("tour_versions")
    .select("tour_id, audience, starts_at, ends_at")
    .eq("id", sourceVersionId)
    .maybeSingle();
  if (!source) return { ok: false, message: "That tour version no longer exists." };

  const { data: siblings } = await admin
    .from("tour_versions")
    .select("version")
    .eq("tour_id", source.tour_id)
    .order("version", { ascending: false })
    .limit(1);
  const nextVersion = (siblings?.[0]?.version ?? 0) + 1;

  const logged = await recordAdminAuditEvent(admin, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: "tour.version_created",
    targetType: "tour",
    targetId: source.tour_id,
    newState: { version: nextVersion, clonedFrom: sourceVersionId }
  });
  if (!logged) return { ok: false, message: "The action was not recorded, so it was not applied." };

  const { data: created, error } = await admin
    .from("tour_versions")
    .insert({
      tour_id: source.tour_id,
      version: nextVersion,
      // Always a draft: a clone must be reviewed and explicitly published.
      status: "draft",
      audience: source.audience,
      starts_at: source.starts_at,
      ends_at: source.ends_at,
      updated_by: input.actorId
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, message: "The new version could not be created." };

  const steps = await loadVersionSteps(admin, sourceVersionId);
  if (steps.length > 0) {
    const { error: stepError } = await admin.from("tour_steps").insert(
      steps.map((step) => ({
        tour_version_id: created.id,
        position: step.position,
        step_key: step.stepKey,
        title: step.title,
        body: step.body,
        target_id: step.targetId,
        route: step.route,
        media_path: step.mediaPath,
        cta_label: step.ctaLabel,
        cta_href: step.ctaHref,
        requires_feature_flag: step.requiresFeatureFlag,
        entitlement_keys: step.entitlementKeys
      }))
    );
    if (stepError) return { ok: false, message: "The version was created but its steps were not copied." };
  }

  return { ok: true, message: `Version ${nextVersion} created as a draft.`, versionId: created.id };
}

/** Replaces a DRAFT version's audience. Published versions are left immutable. */
export async function setVersionAudience(input: {
  admin: Admin;
  actorId: string;
  actorRole: string;
  versionId: string;
  plans: string[];
  cohort: "all" | "new" | "existing";
}): Promise<{ ok: boolean; message: string }> {
  const { admin, versionId } = input;

  const { data: current } = await admin
    .from("tour_versions")
    .select("status, audience")
    .eq("id", versionId)
    .maybeSingle();
  if (!current) return { ok: false, message: "That tour version no longer exists." };
  if (current.status !== "draft") {
    // Changing who a live version targets would retroactively alter what
    // already-recorded completions mean. Clone to a new version instead.
    return { ok: false, message: "Only a draft version's audience can change. Create a new version instead." };
  }
  if (input.plans.length === 0) return { ok: false, message: "Choose at least one plan." };

  const logged = await recordAdminAuditEvent(admin, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: "tour.audience_changed",
    targetType: "tour_version",
    targetId: versionId,
    previousState: { audience: current.audience as never },
    newState: { audience: { plans: input.plans, cohort: input.cohort } }
  });
  if (!logged) return { ok: false, message: "The action was not recorded, so it was not applied." };

  const { error } = await admin
    .from("tour_versions")
    .update({
      audience: { plans: input.plans, cohort: input.cohort },
      updated_by: input.actorId,
      updated_at: new Date().toISOString()
    })
    .eq("id", versionId);
  if (error) return { ok: false, message: "The audience could not be updated." };
  return { ok: true, message: "Audience updated." };
}

export type TourAnalytics = {
  funnel: TourFunnel;
  byPlan: Array<{ plan: string; started: number; completed: number }>;
  dropOff: Array<{ stepKey: string; title: string; position: number; viewers: number; retention: number }>;
};

/**
 * One aggregate RPC plus one count RPC — no raw event scan in Node, and nothing
 * that grows with history length on the admin page.
 */
export async function loadTourAnalytics(admin: Admin, versionId: string): Promise<TourAnalytics> {
  const [analyticsResult, eligibleResult, stepsResult] = await Promise.all([
    admin.rpc("admin_tour_analytics", { p_tour_version_id: versionId }),
    admin.rpc("admin_tour_eligible_count", { p_tour_version_id: versionId }),
    admin
      .from("tour_steps")
      .select("id, step_key, position, title")
      .eq("tour_version_id", versionId)
      .order("position", { ascending: true })
  ]);

  const rows = (analyticsResult.data ?? []).map((row) => ({
    scope: row.scope,
    stepId: row.step_id,
    eventType: row.event_type,
    plan: row.subscription_plan,
    userCount: Number(row.user_count)
  }));

  const byPlanMap = new Map<string, { started: number; completed: number }>();
  for (const row of rows) {
    if (row.scope !== "tour" || !row.plan) continue;
    const entry = byPlanMap.get(row.plan) ?? { started: 0, completed: 0 };
    if (row.eventType === "tour_started") entry.started += row.userCount;
    if (row.eventType === "tour_completed") entry.completed += row.userCount;
    byPlanMap.set(row.plan, entry);
  }

  return {
    funnel: buildFunnel(Number(eligibleResult.data ?? 0), rows),
    byPlan: [...byPlanMap.entries()].map(([plan, value]) => ({ plan, ...value })),
    dropOff: buildStepDropOff(
      (stepsResult.data ?? []).map((step) => ({
        id: step.id,
        stepKey: step.step_key,
        position: step.position,
        title: step.title
      })),
      rows
    )
  };
}
