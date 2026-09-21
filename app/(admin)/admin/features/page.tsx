import { redirect } from "next/navigation";
import { FeatureFlagControl } from "@/components/admin/feature-flag-control";
import { AdminPageHeader, AdminSection } from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/card";
import { getAdminAccess } from "@/lib/admin/access";
import { readWebAdsConfiguration } from "@/lib/ads/config";
import { MANAGED_FEATURES, resolveGlobalFeatureFlag } from "@/lib/features/feature-flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";

export const dynamic = "force-dynamic";

const CATEGORY_COPY: Record<string, string> = {
  Monetization:
    "Control advertising independently from Mad Buddy Access. Turning ads off globally never grants or revokes anyone's Access.",
  "Social discovery": "Pause discovery surfaces without affecting core friendships, privacy, or account access.",
  Media: "Control optional media experiences independently from chat attachments and existing content.",
  Life: "Release private Life surfaces gradually without deleting the underlying user-owned information."
};

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

  const categories = [...new Set(MANAGED_FEATURES.map((feature) => feature.category))];
  const webAds = readWebAdsConfiguration(process.env);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Feature controls"
        description="Release optional product features and monetization surfaces deliberately. Every change applies globally, is rate-limited, and is recorded in the audit log."
      />

      {categories.map((category) => {
        const features = MANAGED_FEATURES.filter((feature) => feature.category === category);
        return (
          <AdminSection
            key={category}
            title={category}
            description={CATEGORY_COPY[category] ?? "Global release controls for this product area."}
          >
            {category === "Monetization" ? (
              <div className="mb-3 rounded-xl border border-border/70 bg-card/40 px-4 py-3">
                <p className="text-sm font-semibold">Google AdSense provider</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {webAds.ok
                    ? "Configured. Ads still require the master switch, the format switch, an ad-eligible account and an approved route."
                    : `Not configured. Advertising will remain off even if a switch is enabled. Missing or invalid: ${webAds.missing.join(", ")}.`}
                </p>
              </div>
            ) : null}

            <Card className="overflow-hidden p-0">
              <div className="divide-y divide-border/70">
                {features.map((feature) => {
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
        );
      })}
    </div>
  );
}
