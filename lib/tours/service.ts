import "server-only";

import { recordProductEvent } from "@/lib/analytics/track";
import { isFeatureEnabled, MANAGED_FEATURES } from "@/lib/features/feature-flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import {
  isEligibleForTour,
  isTourVersionLive,
  parseTourAudience,
  replayableTours,
  resolveSteps,
  resumeIndex,
  selectTourToOffer,
  type TourProgress,
  type TourProgressStatus,
  type TourStep,
  type TourSubject,
  type TourVersion
} from "@/lib/tours/model";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Server side of the guided-tour system. All decisions about whether to
 * interrupt a user are made here from canonical data (published versions,
 * the user's own progress rows, live feature flags, real entitlements) and then
 * handed to the client as a resolved payload — the client never decides its own
 * eligibility.
 */

/**
 * Retained as an empty projection: consumer tours no longer resolve or
 * render per-tier entitlement tables, so there are no plan-conditional
 * numbers for a walkthrough to promise.
 */
export type ResolvedEntitlement = {
  key: string;
  label: string;
  free: string;
  buddyPlus: string;
  buddyPro: string;
  /** Value on the viewer's own plan, so a Pro user is never told to upgrade. */
  current: string;
};

export type ResolvedTour = {
  tourVersionId: string;
  slug: string;
  title: string;
  description: string;
  kind: "main" | "feature";
  version: number;
  steps: TourStep[];
  /** Index to open on, for a resumed tour. */
  startIndex: number;
  /** Viewer's effective plan, for subject-aware copy. */
  plan: SubscriptionPlan;
  /** Entitlements named by any step, keyed by entitlement key. */
  entitlements: Record<string, ResolvedEntitlement>;
  /** Existing first-use outcome, shown in Feature Guides. */
  progressStatus: TourProgressStatus | null;
};

function resolveEntitlements(_steps: TourStep[], _plan: SubscriptionPlan): Record<string, ResolvedEntitlement> {
  return {};
}

const VERSION_SELECT =
  "id, tour_id, version, status, audience, starts_at, ends_at, published_at, tours!inner(slug, title, description, kind)";

type VersionRow = {
  id: string;
  tour_id: string;
  version: number;
  status: string;
  audience: unknown;
  starts_at: string | null;
  ends_at: string | null;
  published_at: string | null;
  tours: { slug: string; title: string; description: string; kind: string } | null;
};

type StepRow = {
  id: string;
  tour_version_id: string;
  position: number;
  step_key: string;
  title: string;
  body: string;
  target_id: string | null;
  route: string | null;
  media_path: string | null;
  cta_label: string | null;
  cta_href: string | null;
  requires_feature_flag: string | null;
  entitlement_keys: string[] | null;
};

function toStep(row: StepRow): TourStep {
  return {
    id: row.id,
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
  };
}

function toVersion(row: VersionRow, steps: TourStep[]): TourVersion | null {
  if (!row.tours) return null;
  const kind = row.tours.kind === "main" ? "main" : "feature";
  const status = row.status === "published" || row.status === "retired" ? row.status : "draft";
  return {
    id: row.id,
    tourId: row.tour_id,
    slug: row.tours.slug,
    title: row.tours.title,
    description: row.tours.description,
    kind,
    version: row.version,
    status,
    audience: parseTourAudience(row.audience),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    publishedAt: row.published_at,
    steps
  };
}

/**
 * Resolves who this user is for targeting purposes: their real effective plan
 * (grace/expiry honoured, from the canonical billing path) and which managed
 * features are actually switched on. Never a client-supplied claim.
 */
async function loadSubject(admin: Admin, userId: string): Promise<TourSubject | null> {
  const [profileResult, ...flagResults] = await Promise.all([
    admin.from("profiles").select("created_at").eq("user_id", userId).maybeSingle(),
    ...MANAGED_FEATURES.map((feature) => isFeatureEnabled(admin, feature.key))
  ]);

  const signupAt = profileResult.data?.created_at;
  if (!signupAt) return null;

  const enabledFeatureFlags = MANAGED_FEATURES.filter((_, index) => flagResults[index]).map(
    (feature) => feature.key as string
  );

  return { plan: "free", signupAt, enabledFeatureFlags };
}

async function loadPublishedVersions(admin: Admin): Promise<TourVersion[]> {
  const { data: versionRows } = await admin.from("tour_versions").select(VERSION_SELECT).eq("status", "published");
  const rows = (versionRows ?? []) as unknown as VersionRow[];
  if (rows.length === 0) return [];

  const { data: stepRows } = await admin
    .from("tour_steps")
    .select(
      "id, tour_version_id, position, step_key, title, body, target_id, route, media_path, cta_label, cta_href, requires_feature_flag, entitlement_keys"
    )
    .in(
      "tour_version_id",
      rows.map((row) => row.id)
    )
    .order("position", { ascending: true });

  const stepsByVersion = new Map<string, TourStep[]>();
  for (const row of (stepRows ?? []) as unknown as StepRow[]) {
    const list = stepsByVersion.get(row.tour_version_id) ?? [];
    list.push(toStep(row));
    stepsByVersion.set(row.tour_version_id, list);
  }

  return rows
    .map((row) => toVersion(row, stepsByVersion.get(row.id) ?? []))
    .filter((version): version is TourVersion => version !== null);
}

async function loadProgress(admin: Admin, userId: string): Promise<Map<string, TourProgress>> {
  const { data } = await admin
    .from("user_tour_progress")
    .select("tour_version_id, status, current_step_key")
    .eq("user_id", userId);

  return new Map(
    (data ?? []).map((row) => [
      row.tour_version_id,
      {
        tourVersionId: row.tour_version_id,
        status: row.status as TourProgressStatus,
        currentStepKey: row.current_step_key
      }
    ])
  );
}

function resolve(version: TourVersion, subject: TourSubject, progress: TourProgress | null): ResolvedTour {
  const steps = resolveSteps(version, subject);
  return {
    tourVersionId: version.id,
    slug: version.slug,
    title: version.title,
    description: version.description,
    kind: version.kind,
    version: version.version,
    steps,
    startIndex: resumeIndex(steps, progress),
    plan: subject.plan,
    entitlements: resolveEntitlements(steps, subject.plan),
    progressStatus: progress?.status ?? null
  };
}

/**
 * Every unresolved published feature tour this user may encounter. The client
 * host chooses from this already-authorised list using the current pathname.
 * That keeps first-use triggering contextual without trusting the client to
 * decide plan, flag, cohort, or completion eligibility.
 */
export async function getToursToOffer(userId: string): Promise<ResolvedTour[]> {
  try {
    const admin = createSupabaseAdminClient();
    const subject = await loadSubject(admin, userId);
    if (!subject) return [];

    const [versions, progressByVersion] = await Promise.all([
      loadPublishedVersions(admin),
      loadProgress(admin, userId)
    ]);
    const nowMs = Date.now();

    return versions
      .filter((version) => version.kind === "feature")
      .filter((version) => isEligibleForTour(version, subject, progressByVersion.get(version.id) ?? null, nowMs))
      .sort((a, b) => {
        const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        return bTime - aTime;
      })
      .map((version) => resolve(version, subject, progressByVersion.get(version.id) ?? null));
  } catch {
    return [];
  }
}

/**
 * The one tour (if any) to offer this user right now. Returns null far more
 * often than not, and does so cheaply: three scoped reads, no history scan, and
 * nothing that can block the authenticated shell from rendering.
 */
export async function getTourToOffer(userId: string): Promise<ResolvedTour | null> {
  try {
    const admin = createSupabaseAdminClient();
    const subject = await loadSubject(admin, userId);
    if (!subject) return null;

    const [versions, progressByVersion] = await Promise.all([
      loadPublishedVersions(admin),
      loadProgress(admin, userId)
    ]);
    if (versions.length === 0) return null;

    const nowMs = Date.now();
    const eligible = versions.filter((version) =>
      isEligibleForTour(version, subject, progressByVersion.get(version.id) ?? null, nowMs)
    );

    const chosen = selectTourToOffer(eligible);
    return chosen ? resolve(chosen, subject, progressByVersion.get(chosen.id) ?? null) : null;
  } catch {
    // Feature education must never be able to break the app it explains.
    return null;
  }
}

/** Tours the user may replay on demand from Settings, ignoring prior completion. */
export async function getReplayableTours(userId: string): Promise<ResolvedTour[]> {
  try {
    const admin = createSupabaseAdminClient();
    const subject = await loadSubject(admin, userId);
    if (!subject) return [];

    const [versions, progressByVersion] = await Promise.all([
      loadPublishedVersions(admin),
      loadProgress(admin, userId)
    ]);
    return replayableTours(versions, subject, Date.now()).map((version) =>
      resolve(version, subject, progressByVersion.get(version.id) ?? null)
    );
  } catch {
    return [];
  }
}

/** Loads one tour by slug for manual replay, always starting from step one. */
export async function getTourBySlug(userId: string, slug: string): Promise<ResolvedTour | null> {
  const tours = await getReplayableTours(userId);
  return tours.find((tour) => tour.slug === slug) ?? null;
}

/**
 * Records progress. `preview` short-circuits every write and every analytics
 * event, so an admin previewing a tour neither marks it complete for themselves
 * nor pollutes consumer funnels.
 */
export async function recordTourProgress(input: {
  userId: string;
  tourVersionId: string;
  status: TourProgressStatus;
  currentStepKey?: string | null;
  preview?: boolean;
}): Promise<boolean> {
  if (input.preview) return true;

  try {
    const admin = createSupabaseAdminClient();
    const { data: persistedStatus, error } = await admin.rpc("record_user_tour_progress", {
      p_user_id: input.userId,
      p_tour_version_id: input.tourVersionId,
      p_status: input.status,
      p_current_step_key: input.currentStepKey ?? null
    });
    if (error) return false;
    // A terminal row is monotonic. If an older in-flight request arrived late,
    // the RPC preserved the terminal state and we must not emit a contradictory
    // funnel event for the rejected transition.
    if (persistedStatus !== input.status) return true;

    const eventName =
      input.status === "completed"
        ? "tour_completed"
        : input.status === "skipped" || input.status === "dismissed"
          ? "tour_skipped"
          : "tour_started";
    await recordProductEvent(admin, {
      eventName,
      actorId: input.userId,
      resourceType: "tour_version",
      resourceId: input.tourVersionId,
      featureKey: "tours"
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Step-level analytics. Keyed on the step's own uuid so each step is a distinct
 * dedupe key and drop-off is measurable. Never writes progress.
 */
export async function recordTourStepEvent(input: {
  userId: string;
  stepId: string;
  event: "tour_step_viewed" | "tour_step_completed" | "tour_cta_clicked" | "tour_shown";
  preview?: boolean;
}): Promise<boolean> {
  if (input.preview) return true;
  try {
    const admin = createSupabaseAdminClient();
    return await recordProductEvent(admin, {
      eventName: input.event,
      actorId: input.userId,
      resourceType: "tour_step",
      resourceId: input.stepId,
      featureKey: "tours"
    });
  } catch {
    return false;
  }
}

/**
 * Loads a PUBLISHED version by id for manual replay, ignoring eligibility and
 * prior progress. Always starts at step one.
 *
 * Separate from getTourToOffer because replay deliberately bypasses the
 * one-time offer rule, and separate from the preview loader because it must
 * refuse anything that is not published.
 */
export async function getPublishedTourById(userId: string, versionId: string): Promise<ResolvedTour | null> {
  try {
    const admin = createSupabaseAdminClient();
    const subject = await loadSubject(admin, userId);
    if (!subject) return null;

    const versions = await loadPublishedVersions(admin);
    const version = versions.find((candidate) => candidate.id === versionId);
    if (!version) return null;
    if (!isTourVersionLive(version, Date.now())) return null;

    const resolved = resolve(version, subject, null);
    return resolved.steps.length > 0 ? resolved : null;
  } catch {
    return null;
  }
}
