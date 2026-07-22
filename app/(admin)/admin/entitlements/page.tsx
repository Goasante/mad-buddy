import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/admin-ui";
import { EntitlementsMatrix, type MatrixData, type SubscriptionTier } from "@/components/admin/entitlements-matrix";
import { getAdminAccess } from "@/lib/admin/access";
import { PLAN_ENTITLEMENTS, UNLIMITED } from "@/lib/billing/entitlements";
import { BOOLEAN_ENTITLEMENTS, NUMERIC_ENTITLEMENTS } from "@/lib/billing/entitlement-catalog";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";

export const dynamic = "force-dynamic";

const TIERS: SubscriptionTier[] = ["free", "buddy_plus", "buddy_pro"];

export default async function AdminEntitlementsPage() {
  const admin = createSupabaseAdminClient();
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.entitlements.view")) redirect("/admin");
  const canManage = access.permissions.has("admin.entitlements.manage");

  const { data: overrideRows } = await admin
    .from("tier_entitlement_overrides")
    .select("plan, entitlement_key, value_type, numeric_value, is_unlimited, boolean_value");

  // `${plan}:${key}` → override value (so cells can show default vs edited).
  const overrides = new Map<string, { numeric?: { unlimited: boolean; value: number }; boolean?: boolean }>();
  for (const row of overrideRows ?? []) {
    const compositeKey = `${row.plan}:${row.entitlement_key}`;
    if (row.value_type === "boolean") {
      overrides.set(compositeKey, { boolean: Boolean(row.boolean_value) });
    } else {
      overrides.set(compositeKey, { numeric: { unlimited: row.is_unlimited, value: Number(row.numeric_value ?? 0) } });
    }
  }

  const data: MatrixData = {
    canManage,
    numeric: NUMERIC_ENTITLEMENTS.map((entry) => ({
      key: entry.key,
      label: entry.label,
      cells: Object.fromEntries(
        TIERS.map((plan) => {
          const override = overrides.get(`${plan}:${entry.key}`)?.numeric;
          const def = PLAN_ENTITLEMENTS[plan][entry.key];
          const defUnlimited = def === UNLIMITED;
          return [
            plan,
            override
              ? { unlimited: override.unlimited, value: override.value, overridden: true }
              : { unlimited: defUnlimited, value: defUnlimited ? 0 : def, overridden: false }
          ];
        })
      ) as MatrixData["numeric"][number]["cells"]
    })),
    boolean: BOOLEAN_ENTITLEMENTS.map((entry) => ({
      key: entry.key,
      label: entry.label,
      cells: Object.fromEntries(
        TIERS.map((plan) => {
          const override = overrides.get(`${plan}:${entry.key}`)?.boolean;
          return [
            plan,
            override !== undefined
              ? { value: override, overridden: true }
              : { value: PLAN_ENTITLEMENTS[plan][entry.key], overridden: false }
          ];
        })
      ) as MatrixData["boolean"][number]["cells"]
    }))
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Entitlements"
        description="What each subscription tier includes. Edit a value to override the built-in default for a tier; reset returns it to the default. Per-user grants live on each account's billing page."
      />
      <EntitlementsMatrix data={data} />
    </div>
  );
}
