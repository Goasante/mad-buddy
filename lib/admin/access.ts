import "server-only";

import { ADMIN_PERMISSIONS, ROLE_PERMISSIONS, type AdminPermission } from "@/lib/admin/governance";
import { loadAdminAssignments } from "@/lib/admin/service";
import type { SafetyAdminContext } from "@/lib/safety/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type AllowedContext = Extract<SafetyAdminContext, { ok: true }>;
export type AdminAccessRole = "owner" | "admin" | "support";

const legacyPermissions: Record<AdminAccessRole, readonly AdminPermission[]> = {
  owner: ADMIN_PERMISSIONS,
  admin: [
    ...ROLE_PERMISSIONS.trust_safety_administrator,
    "admin.roles.manage",
    "admin.support.manage",
    "admin.sessions.revoke",
    // Owner/admin/support may adjust a user's plan (view is needed to reach the
    // billing screen); refunds/entitlement overrides stay billing.refund-only.
    "admin.billing.view",
    "admin.billing.manage_plan",
    // Owner/admin/support may view and edit the per-tier entitlement matrix.
    "admin.entitlements.view",
    "admin.entitlements.manage"
  ],
  support: [
    ...ROLE_PERMISSIONS.customer_support_agent,
    "admin.users.suspend",
    "admin.sessions.revoke",
    "admin.billing.view",
    "admin.billing.manage_plan",
    "admin.entitlements.view",
    "admin.entitlements.manage"
  ]
};

function isEnvironmentOwner(email: string) {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .includes(email.toLowerCase());
}

export async function getAdminAccess(admin: Admin, context: AllowedContext) {
  const [assignments, legacyResult] = await Promise.all([
    loadAdminAssignments(admin, context.userId),
    admin.from("admin_users").select("role").eq("email", context.email).is("disabled_at", null).maybeSingle()
  ]);
  const activeRoles = assignments.filter((assignment) => {
    const now = Date.now();
    return assignment.status === "active" && assignment.startsAtMs <= now && (!assignment.expiresAtMs || assignment.expiresAtMs > now);
  });
  const role = (legacyResult.data?.role ?? (isEnvironmentOwner(context.email) || context.isDevelopmentFallback ? "owner" : "support")) as AdminAccessRole;
  const permissions = new Set<AdminPermission>(legacyPermissions[role]);
  for (const assignment of activeRoles) {
    for (const permission of ROLE_PERMISSIONS[assignment.role] ?? []) permissions.add(permission);
  }
  return { role, permissions, activeRoles };
}

export async function requireAdminPermission(admin: Admin, context: AllowedContext, permission: AdminPermission) {
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has(permission)) throw new Error("You do not have permission to do that.");
  return access;
}

export async function requireAdminPagePermission(permission: AdminPermission) {
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");
  const admin = createSupabaseAdminClient();
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has(permission)) redirect("/admin");
  return { admin, context, access };
}
