"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { requireAdminPermission } from "@/lib/admin/access";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

export type CreateAdminState = {
  ok: boolean;
  message: string;
};

const createAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "support", "owner"]).default("admin")
});

const adminAccessSchema = z.object({
  email: z.string().email(),
  disabled: z.boolean()
});

const governanceRoleByLegacyRole = {
  owner: "super_administrator",
  admin: "trust_safety_administrator",
  support: "customer_support_agent"
} as const;

export async function createAdminUserAction(input: unknown): Promise<CreateAdminState> {
  const requestId = createRequestId();
  const startedAt = Date.now();

  let currentAdmin;
  let admin;

  try {
    const required = await requireSafetyAdmin();
    currentAdmin = required.context;
    admin = required.admin;
    await requireAdminPermission(admin, currentAdmin, "admin.roles.manage");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: currentAdmin.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
  } catch (error) {
    logBackendEvent("warn", {
      requestId,
      action: "admin_users.create",
      statusCode: 403,
      latencyMs: Date.now() - startedAt,
      errorType: errorType(error)
    });
    return { ok: false, message: "Admin access required." };
  }

  const parsed = createAdminSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Enter a valid email, role, and password with at least 8 characters."
    };
  }

  const actorAccess = await requireAdminPermission(admin, currentAdmin, "admin.roles.manage");
  if (parsed.data.role === "owner" && actorAccess.role !== "owner") {
    return { ok: false, message: "Only an owner can create another owner." };
  }

  const email = parsed.data.email.trim().toLowerCase();
  const { data: existingAdmin } = await admin
    .from("admin_users")
    .select("id, disabled_at")
    .eq("email", email)
    .maybeSingle();

  if (existingAdmin && !existingAdmin.disabled_at) {
    return { ok: false, message: "That email is already an active admin." };
  }

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: parsed.data.password,
    email_confirm: true,
    app_metadata: {
      mad_buddy_admin: true,
      mad_buddy_admin_role: parsed.data.role
    }
  });

  if (authError || !authData.user) {
    logBackendEvent("warn", {
      requestId,
      action: "admin_users.create",
      statusCode: 400,
      latencyMs: Date.now() - startedAt,
      errorType: authError ? errorType(authError) : "missing_user"
    });
    return {
      ok: false,
      message: "Could not create the admin auth account. Check the details and try again."
    };
  }

  const { error: upsertError } = await admin.from("admin_users").upsert(
    {
      email,
      auth_user_id: authData.user.id,
      role: parsed.data.role,
      invited_by_user_id: currentAdmin.userId,
      disabled_at: null
    },
    { onConflict: "email" }
  );

  if (upsertError) {
    await admin.auth.admin.deleteUser(authData.user.id);
    logBackendEvent("error", {
      requestId,
      action: "admin_users.create",
      statusCode: 500,
      latencyMs: Date.now() - startedAt,
      userId: currentAdmin.userId,
      errorType: upsertError.code
    });
    return { ok: false, message: "Auth user was created, but admin access could not be saved." };
  }

  const governanceRole = governanceRoleByLegacyRole[parsed.data.role];
  const { data: role, error: roleError } = await admin.from("admin_roles").select("id").eq("name", governanceRole).maybeSingle();
  if (roleError || !role) {
    await admin.from("admin_users").delete().eq("auth_user_id", authData.user.id);
    await admin.auth.admin.deleteUser(authData.user.id);
    return { ok: false, message: "The governance role is unavailable, so the admin was not created." };
  }
  const { error: assignmentError } = await admin.from("admin_assignments").upsert(
      {
        user_id: authData.user.id,
        role_id: role.id,
        status: "active",
        assigned_by: currentAdmin.userId,
        starts_at: new Date().toISOString(),
        expires_at: null
      },
      { onConflict: "user_id,role_id" }
    );
  if (assignmentError) {
    await admin.from("admin_users").delete().eq("auth_user_id", authData.user.id);
    await admin.auth.admin.deleteUser(authData.user.id);
    return { ok: false, message: "The governance role could not be assigned, so the admin was not created." };
  }

  const logged = await recordAdminAuditEvent(admin, {
    actorId: currentAdmin.userId,
    action: "admin_access_created",
    targetType: "admin_user",
    targetId: authData.user.id,
    newState: { email, role: parsed.data.role, governanceRole },
    reason: "Admin team management"
  });
  if (!logged) {
    await admin.from("admin_users").delete().eq("auth_user_id", authData.user.id);
    await admin.auth.admin.deleteUser(authData.user.id);
    return { ok: false, message: "The audit entry could not be recorded, so the admin was not created." };
  }

  logBackendEvent("info", {
    requestId,
    action: "admin_users.create",
    statusCode: 200,
    latencyMs: Date.now() - startedAt,
    userId: currentAdmin.userId
  });

  revalidatePath("/admin/admins");
  return { ok: true, message: `${email} can now log in at /admin/login.` };
}

export async function setAdminAccessAction(input: unknown): Promise<CreateAdminState> {
  const parsed = adminAccessSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid admin account." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.roles.manage");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
    const email = parsed.data.email.trim().toLowerCase();
    if (email === context.email && parsed.data.disabled) return { ok: false, message: "You cannot disable your own admin access." };

    const { data: target, error: targetError } = await admin
      .from("admin_users")
      .select("auth_user_id, role, disabled_at")
      .eq("email", email)
      .maybeSingle();
    if (targetError || !target) return { ok: false, message: "That admin account is unavailable." };

    if (parsed.data.disabled && target.role === "owner") {
      const { count } = await admin.from("admin_users").select("id", { count: "exact", head: true }).eq("role", "owner").is("disabled_at", null);
      if ((count ?? 0) <= 1) return { ok: false, message: "Keep at least one active owner." };
    }

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: parsed.data.disabled ? "admin_access_disabled" : "admin_access_enabled",
      targetType: "admin_user",
      targetId: target.auth_user_id ?? undefined,
      previousState: { disabled: Boolean(target.disabled_at) },
      newState: { disabled: parsed.data.disabled },
      reason: "Admin team management"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

    const disabledAt = parsed.data.disabled ? new Date().toISOString() : null;
    const { error } = await admin.from("admin_users").update({ disabled_at: disabledAt }).eq("email", email);
    if (error) return { ok: false, message: "Couldn't update admin access." };
    if (target.auth_user_id) {
      await admin.from("admin_assignments").update({ status: parsed.data.disabled ? "suspended" : "active" }).eq("user_id", target.auth_user_id);
    }

    revalidatePath("/admin/admins");
    return { ok: true, message: parsed.data.disabled ? "Admin access disabled." : "Admin access enabled." };
  } catch {
    return { ok: false, message: "Admin access required." };
  }
}
