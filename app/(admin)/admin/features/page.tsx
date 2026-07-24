import { redirect } from "next/navigation";
import { FeatureFlagControl } from "@/components/admin/feature-flag-control";
import { AdminPageHeader, AdminSection } from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/card";
import { getAdminAccess } from "@/lib/admin/access";
import { OPEN_MOMENTS_FLAG, resolveGlobalFeatureFlag } from "@/lib/features/feature-flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";

export const dynamic = "force-dynamic";

export default async function AdminFeaturesPage() {
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");

  const admin = createSupabaseAdminClient();
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.feature_flags.manage")) redirect("/admin");

  const { data: flag } = await admin
    .from("feature_flags")
    .select("key, description, status, default_value, updated_at")
    .eq("key", OPEN_MOMENTS_FLAG)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Feature controls"
        description="Release optional product features deliberately. Changes apply globally, are rate-limited, and are recorded in the audit log."
      />

      <AdminSection
        title="Social discovery"
        description="Open Moments remains separate from private Moments and is disabled by default."
      >
        <Card className="overflow-hidden p-0">
          {flag ? (
            <FeatureFlagControl
              flagKey={OPEN_MOMENTS_FLAG}
              title="Open Moments"
              description={
                flag.description ??
                "Authenticated members can view public Moments and Buddy Pro members can publish them."
              }
              enabled={resolveGlobalFeatureFlag(flag)}
              status={flag.status}
              updatedAt={flag.updated_at}
            />
          ) : (
            <p className="px-4 py-5 text-sm text-muted-foreground">
              Open Moments will appear here after its database migration is applied.
            </p>
          )}
        </Card>
      </AdminSection>
    </div>
  );
}
