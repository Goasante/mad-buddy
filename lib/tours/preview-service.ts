import "server-only";

import { getAdminAccess } from "@/lib/admin/access";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { BOOLEAN_ENTITLEMENTS, NUMERIC_ENTITLEMENTS } from "@/lib/billing/entitlement-catalog";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";

/**
 * Loads a tour version for DRAFT PREVIEW.
 *
 * Deliberately a separate path from getTourToOffer():
 *  * It ignores status, so it can load drafts — which is exactly why it must
 *    never be reachable from the consumer path. The consumer loader still
 *    filters `status = 'published'`, and the RLS policies still only expose
 *    published versions to `authenticated`, so draft content cannot leak
 *    through eligibility or the consumer API. This function reads through the
 *    service-role client only after the permission check below.
 *  * It ignores eligibility entirely (plan targeting, cohort, prior progress).
 *    An admin previewing a draft should see it regardless of whether they
 *    personally would qualify.
 *  * Feature-flag gating on individual steps is also ignored, so a step behind
 *    a disabled feature is still previewable. It is reported instead, since the
 *    admin needs to know that consumers would not see it.
 *
 * Returns null when the caller lacks `admin.tours.manage`. That check happens
 * here, on every load, so the preview cookie by itself grants nothing.
 */

export type PreviewStep = {
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

export type PreviewTour = {
  tourVersionId: string;
  slug: string;
  title: string;
  description: string;
  version: number;
  status: string;
  steps: PreviewStep[];
  plan: SubscriptionPlan;
  entitlements: Record<
    string,
    { key: string; label: string; free: string; buddyPlus: string; buddyPro: string; current: string }
  >;
};

function formatEntitlementValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Included" : "Not included";
  if (value === null) return "Unlimited";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "Unlimited";
    return new Intl.NumberFormat("en-GB").format(value);
  }
  return "—";
}

function resolveEntitlements(steps: PreviewStep[], plan: SubscriptionPlan) {
  const keys = [...new Set(steps.flatMap((step) => step.entitlementKeys))];
  if (keys.length === 0) return {};

  const labels = new Map<string, string>(
    [...NUMERIC_ENTITLEMENTS, ...BOOLEAN_ENTITLEMENTS].map((entry) => [entry.key as string, entry.label])
  );
  const byPlan = {
    free: entitlementsFor("free") as unknown as Record<string, unknown>,
    buddy_plus: entitlementsFor("buddy_plus") as unknown as Record<string, unknown>,
    buddy_pro: entitlementsFor("buddy_pro") as unknown as Record<string, unknown>
  };

  const resolved: PreviewTour["entitlements"] = {};
  for (const key of keys) {
    const label = labels.get(key);
    if (!label) continue;
    resolved[key] = {
      key,
      label,
      free: formatEntitlementValue(byPlan.free[key]),
      buddyPlus: formatEntitlementValue(byPlan.buddy_plus[key]),
      buddyPro: formatEntitlementValue(byPlan.buddy_pro[key]),
      current: formatEntitlementValue(byPlan[plan]?.[key])
    };
  }
  return resolved;
}

/** True when the current viewer may author/preview tours. */
export async function canPreviewTours(): Promise<boolean> {
  try {
    const context = await getSafetyAdminContext();
    if (!context.ok) return false;
    const access = await getAdminAccess(createSupabaseAdminClient(), context);
    return access.permissions.has("admin.tours.manage");
  } catch {
    return false;
  }
}

export async function loadTourForPreview(versionId: string): Promise<PreviewTour | null> {
  try {
    // Permission first: nothing about a draft is read before this passes.
    if (!(await canPreviewTours())) return null;

    const admin = createSupabaseAdminClient();
    const { data: version } = await admin
      .from("tour_versions")
      .select("id, version, status, tours!inner(slug, title, description)")
      .eq("id", versionId)
      .maybeSingle();
    if (!version) return null;

    const tour = version.tours as unknown as { slug: string; title: string; description: string } | null;
    if (!tour) return null;

    const { data: stepRows } = await admin
      .from("tour_steps")
      .select(
        "id, position, step_key, title, body, target_id, route, media_path, cta_label, cta_href, requires_feature_flag, entitlement_keys"
      )
      .eq("tour_version_id", versionId)
      .order("position", { ascending: true });

    const steps: PreviewStep[] = (stepRows ?? []).map((row) => ({
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
    }));

    // The admin's own real plan, so entitlement tables render truthfully.
    // Simulating another plan is deliberately out of scope here.
    const context = await getSafetyAdminContext();
    const plan: SubscriptionPlan = context.ok
      ? (await getCurrentSubscriptionAccess(context.userId)).plan
      : "free";

    return {
      tourVersionId: version.id,
      slug: tour.slug,
      title: tour.title,
      description: tour.description,
      version: version.version,
      status: version.status,
      steps,
      plan,
      entitlements: resolveEntitlements(steps, plan)
    };
  } catch {
    return null;
  }
}
