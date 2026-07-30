import "server-only";

import { recordAdminAuditEvent } from "@/lib/admin/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { reorderSteps } from "@/lib/tours/admin-model";
import { loadVersionSteps } from "@/lib/tours/admin-service";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * No-SQL tour authoring.
 *
 * Two rules hold everywhere in this module:
 *  1. Only DRAFT versions are mutable. Published content backs recorded
 *     completions and analytics, so editing it in place would change what those
 *     numbers already mean. Callers get told to create the next version instead.
 *  2. The audit row is written BEFORE the mutation and the mutation is refused
 *     if logging fails, matching the repo rule that an unlogged privileged
 *     action is worse than a failed one.
 *
 * Permission (`admin.tours.manage`) is enforced by the calling server action.
 */

export type StepInput = {
  stepKey: string;
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

async function requireDraftVersion(
  admin: Admin,
  versionId: string
): Promise<{ ok: true; tourId: string } | { ok: false; message: string }> {
  const { data } = await admin.from("tour_versions").select("status, tour_id").eq("id", versionId).maybeSingle();
  if (!data) return { ok: false, message: "That tour version no longer exists." };
  if (data.status !== "draft") {
    return { ok: false, message: "Published versions are read only. Create the next version to make changes." };
  }
  return { ok: true, tourId: data.tour_id };
}

function stepRow(versionId: string, step: StepInput, position: number) {
  return {
    tour_version_id: versionId,
    position,
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
  };
}

/**
 * Writes a dense 1..n order in two passes. Positions are parked out of range
 * first because unique (tour_version_id, position) would reject the
 * intermediate state where two steps briefly share a position.
 */
async function persistOrder(admin: Admin, versionId: string, orderedKeys: string[]): Promise<boolean> {
  for (const [index, key] of orderedKeys.entries()) {
    const { error } = await admin
      .from("tour_steps")
      .update({ position: 1000 + index })
      .eq("tour_version_id", versionId)
      .eq("step_key", key);
    if (error) return false;
  }
  for (const [index, key] of orderedKeys.entries()) {
    const { error } = await admin
      .from("tour_steps")
      .update({ position: index + 1 })
      .eq("tour_version_id", versionId)
      .eq("step_key", key);
    if (error) return false;
  }
  return true;
}

export async function createTour(input: {
  admin: Admin;
  actorId: string;
  actorRole: string;
  slug: string;
  title: string;
  description: string;
  kind: "main" | "feature";
  plans: string[];
  cohort: "all" | "new" | "existing";
  startsAt: string | null;
  endsAt: string | null;
}): Promise<{ ok: boolean; message: string; versionId?: string }> {
  const { admin } = input;

  const { data: existing } = await admin.from("tours").select("id").eq("slug", input.slug).maybeSingle();
  if (existing) return { ok: false, message: "That slug is already in use." };

  const logged = await recordAdminAuditEvent(admin, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: "tour.created",
    targetType: "tour",
    newState: { slug: input.slug, kind: input.kind }
  });
  if (!logged) return { ok: false, message: "The action was not recorded, so it was not applied." };

  const { data: tour, error } = await admin
    .from("tours")
    .insert({ slug: input.slug, title: input.title, description: input.description, kind: input.kind })
    .select("id")
    .single();
  if (error || !tour) return { ok: false, message: "The tour could not be created." };

  // v1 always begins as an empty draft; publishing is a separate validated,
  // audited action.
  const { data: version, error: versionError } = await admin
    .from("tour_versions")
    .insert({
      tour_id: tour.id,
      version: 1,
      status: "draft",
      audience: { plans: input.plans, cohort: input.cohort },
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      updated_by: input.actorId
    })
    .select("id")
    .single();
  if (versionError || !version) return { ok: false, message: "The tour was created but its first version was not." };

  return { ok: true, message: `${input.title} created as a draft.`, versionId: version.id };
}

export async function createStep(input: {
  admin: Admin;
  actorId: string;
  actorRole: string;
  versionId: string;
  step: StepInput;
}): Promise<{ ok: boolean; message: string }> {
  const { admin, versionId } = input;
  const guard = await requireDraftVersion(admin, versionId);
  if (!guard.ok) return { ok: false, message: guard.message };

  const existing = await loadVersionSteps(admin, versionId);
  if (existing.some((step) => step.stepKey === input.step.stepKey)) {
    return { ok: false, message: "A step with that key already exists in this version." };
  }

  const logged = await recordAdminAuditEvent(admin, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: "tour.step_created",
    targetType: "tour_version",
    targetId: versionId,
    newState: { stepKey: input.step.stepKey }
  });
  if (!logged) return { ok: false, message: "The action was not recorded, so it was not applied." };

  // Appended last; order changes only through moveStep.
  const { error } = await admin.from("tour_steps").insert(stepRow(versionId, input.step, existing.length + 1));
  if (error) return { ok: false, message: "The step could not be added." };
  return { ok: true, message: "Step added." };
}

export async function updateStep(input: {
  admin: Admin;
  actorId: string;
  actorRole: string;
  versionId: string;
  stepKey: string;
  step: StepInput;
}): Promise<{ ok: boolean; message: string }> {
  const { admin, versionId } = input;
  const guard = await requireDraftVersion(admin, versionId);
  if (!guard.ok) return { ok: false, message: guard.message };

  const existing = await loadVersionSteps(admin, versionId);
  const current = existing.find((step) => step.stepKey === input.stepKey);
  if (!current) return { ok: false, message: "That step no longer exists." };
  if (input.step.stepKey !== input.stepKey && existing.some((step) => step.stepKey === input.step.stepKey)) {
    return { ok: false, message: "Another step already uses that key." };
  }

  const logged = await recordAdminAuditEvent(admin, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: "tour.step_updated",
    targetType: "tour_version",
    targetId: versionId,
    previousState: { stepKey: current.stepKey, title: current.title },
    newState: { stepKey: input.step.stepKey, title: input.step.title }
  });
  if (!logged) return { ok: false, message: "The action was not recorded, so it was not applied." };

  const { error } = await admin
    .from("tour_steps")
    .update(stepRow(versionId, input.step, current.position))
    .eq("tour_version_id", versionId)
    .eq("step_key", input.stepKey);
  if (error) return { ok: false, message: "The step could not be saved." };
  return { ok: true, message: "Step saved." };
}

export async function deleteStep(input: {
  admin: Admin;
  actorId: string;
  actorRole: string;
  versionId: string;
  stepKey: string;
}): Promise<{ ok: boolean; message: string; removed?: StepInput }> {
  const { admin, versionId } = input;
  const guard = await requireDraftVersion(admin, versionId);
  if (!guard.ok) return { ok: false, message: guard.message };

  const existing = await loadVersionSteps(admin, versionId);
  const current = existing.find((step) => step.stepKey === input.stepKey);
  if (!current) return { ok: false, message: "That step no longer exists." };

  const logged = await recordAdminAuditEvent(admin, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: "tour.step_deleted",
    targetType: "tour_version",
    targetId: versionId,
    previousState: { stepKey: current.stepKey, title: current.title }
  });
  if (!logged) return { ok: false, message: "The action was not recorded, so it was not applied." };

  const { error } = await admin
    .from("tour_steps")
    .delete()
    .eq("tour_version_id", versionId)
    .eq("step_key", input.stepKey);
  if (error) return { ok: false, message: "The step could not be deleted." };

  // Close the gap so positions stay dense.
  await persistOrder(
    admin,
    versionId,
    existing.filter((step) => step.stepKey !== input.stepKey).map((step) => step.stepKey)
  );

  // Returned so the caller can offer Undo instead of a confirmation dialog:
  // a draft step deletion is fully reversible.
  return {
    ok: true,
    message: `Removed "${current.title}".`,
    removed: {
      stepKey: current.stepKey,
      title: current.title,
      body: current.body,
      targetId: current.targetId,
      route: current.route,
      mediaPath: current.mediaPath,
      ctaLabel: current.ctaLabel,
      ctaHref: current.ctaHref,
      requiresFeatureFlag: current.requiresFeatureFlag,
      entitlementKeys: current.entitlementKeys
    }
  };
}

export async function duplicateStep(input: {
  admin: Admin;
  actorId: string;
  actorRole: string;
  versionId: string;
  stepKey: string;
}): Promise<{ ok: boolean; message: string }> {
  const { admin, versionId } = input;
  const guard = await requireDraftVersion(admin, versionId);
  if (!guard.ok) return { ok: false, message: guard.message };

  const existing = await loadVersionSteps(admin, versionId);
  const source = existing.find((step) => step.stepKey === input.stepKey);
  if (!source) return { ok: false, message: "That step no longer exists." };

  // First free "<key>-copy", "<key>-copy-2", ... so duplicating twice works.
  const taken = new Set(existing.map((step) => step.stepKey));
  let candidate = `${source.stepKey}-copy`.slice(0, 64);
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${source.stepKey}-copy-${suffix}`.slice(0, 64);
    suffix += 1;
  }

  const logged = await recordAdminAuditEvent(admin, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: "tour.step_created",
    targetType: "tour_version",
    targetId: versionId,
    newState: { stepKey: candidate, duplicatedFrom: source.stepKey }
  });
  if (!logged) return { ok: false, message: "The action was not recorded, so it was not applied." };

  const { error } = await admin
    .from("tour_steps")
    .insert(stepRow(versionId, { ...source, stepKey: candidate }, existing.length + 1));
  if (error) return { ok: false, message: "The step could not be duplicated." };
  return { ok: true, message: "Step duplicated." };
}

export async function moveStep(input: {
  admin: Admin;
  actorId: string;
  actorRole: string;
  versionId: string;
  stepKey: string;
  direction: "up" | "down";
}): Promise<{ ok: boolean; message: string }> {
  const { admin, versionId } = input;
  const guard = await requireDraftVersion(admin, versionId);
  if (!guard.ok) return { ok: false, message: guard.message };

  const existing = await loadVersionSteps(admin, versionId);
  // Reuses the pure, unit-tested reorder rule rather than reimplementing it.
  const reordered = reorderSteps(existing, input.stepKey, input.direction);

  const logged = await recordAdminAuditEvent(admin, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: "tour.steps_reordered",
    targetType: "tour_version",
    targetId: versionId,
    newState: { order: reordered.map((step) => step.stepKey) }
  });
  if (!logged) return { ok: false, message: "The action was not recorded, so it was not applied." };

  const ok = await persistOrder(
    admin,
    versionId,
    reordered.map((step) => step.stepKey)
  );
  return ok ? { ok: true, message: "Order updated." } : { ok: false, message: "The order could not be saved." };
}
