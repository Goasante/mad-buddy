"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { requireSafetyAdmin } from "@/lib/safety/admin";

export type CreateAdminState = {
  ok: boolean;
  message: string;
};

const createAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "support", "owner"]).default("admin")
});

export async function createAdminUserAction(input: unknown): Promise<CreateAdminState> {
  const requestId = createRequestId();
  const startedAt = Date.now();

  let currentAdmin;
  let admin;

  try {
    const required = await requireSafetyAdmin();
    currentAdmin = required.context;
    admin = required.admin;
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
      message: authError?.message ?? "Could not create the admin auth account."
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
