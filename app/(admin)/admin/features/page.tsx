import { redirect } from "next/navigation";
import { FeatureFlagControl } from "@/components/admin/feature-flag-control";
import { AdminPageHeader, AdminSection } from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/card";
import { getAdminAccess } from "@/lib/admin/access";
import { MANAGED_FEATURES, resolveGlobalFeatureFlag } from "@/lib/features/feature-flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";

export const dynamic = "force-dynamic";

export default async function AdminFeaturesPage() {
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");

  const admin = createSupabaseAdminClient();
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.feature_flags.manage")) redirect("/admin");

  const { data: flags } = await admin
    .from("feature_flags")
    .select("key, description, status, default_value, updated_at, updated_by")
    .in("key", MANAGED_FEATURES.map((feature) => feature.key));
  const flagByKey = new Map((flags ?? []).map((flag) => [flag.key, flag]));
  const actorIds = [...new Set((flags ?? []).map((flag) => flag.updated_by).filter((id): id is string => Boolean(id)))];
  const { data: actors } = actorIds.length
    ? await admin.from("profiles").select("user_id, full_name, username").in("user_id", actorIds)
    : { data: [] };
  const actorById = new Map(
    (actors ?? []).map((actor) => [actor.user_id, actor.full_name?.trim() || actor.username || "Admin"])
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Feature controls"
        description="Release optional product features deliberately. Every change applies globally, is rate-limited, and is recorded in the audit log."
      />

      <AdminSection
        title="Social discovery"
        description="Optional discovery surfaces can be paused without affecting core friendships, privacy, or account access."
      >
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-border/70">
            {MANAGED_FEATURES.map((feature) => {
              const flag = flagByKey.get(feature.key);
              return flag ? (
                <FeatureFlagControl
                  key={feature.key}
                  flagKey={feature.key}
                  title={feature.title}
                  description={flag.description ?? feature.description}
                  enabled={resolveGlobalFeatureFlag(flag)}
                  status={flag.status}
                  updatedAt={flag.updated_at}
                  enabledImpact={feature.enabledImpact}
                  disabledImpact={feature.disabledImpact}
                  changedBy={flag.updated_by ? actorById.get(flag.updated_by) ?? "Admin" : "System"}
                />
              ) : (
                <div key={feature.key} className="px-4 py-5 sm:px-5">
                  <p className="text-sm font-semibold">{feature.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Apply the latest database migration to make this control available.
                  </p>
                </div>
              );
            })}
          </div>
        </Card>
      </AdminSection>
    </div>
  );
}
