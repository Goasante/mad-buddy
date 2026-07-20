"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { getAdminAccess, requireAdminPermission, type AdminAccessRole } from "@/lib/admin/access";
import { canAssignStaffRole, type StaffStanding } from "@/lib/admin/governance";
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

// ---------------------------------------------------------------------------
// Team access: promote/demote EXISTING users (admin operations spec §2).
// Unlike createAdminUserAction (which provisions a brand-new auth login), this
// grants a staff role to an already-authenticated Mad Buddy user. No account
// is created, no password is set.
// ---------------------------------------------------------------------------

export type StaffSearchResult = {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  /** Present only when the acting role is authorised to see it (Owner). */
  email: string | null;
  currentRole: StaffStanding;
  active: boolean;
};

export type StaffSearchState = {
  ok: boolean;
  message: string;
  results: StaffSearchResult[];
  /** Whether more results exist beyond this page. */
  hasMore: boolean;
  /** Whether the actor may see emails (Owner). */
  emailsVisible: boolean;
};

const searchSchema = z.object({
  query: z.string().trim().min(1).max(80),
  offset: z.number().int().min(0).max(500).optional()
});

const PAGE_SIZE = 8;

/**
 * Searches EXISTING users for staff assignment. Server-authorised; returns only
 * the minimum fields (spec §7). Never loads the full user table — it matches on
 * display name / username with a bounded, paginated query. Email is included
 * only for an Owner acting role, resolved per-result and bounded to the page.
 */
export async function searchExistingUsersAction(input: unknown): Promise<StaffSearchState> {
  const empty: StaffSearchState = { ok: false, message: "", results: [], hasMore: false, emailsVisible: false };

  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return { ...empty, message: "Enter a search term." };

  let admin;
  let actorRole: AdminAccessRole;
  try {
    const required = await requireSafetyAdmin();
    admin = required.admin;
    const access = await getAdminAccess(admin, required.context);
    if (!access.permissions.has("admin.roles.manage")) {
      return { ...empty, message: "You don't have permission to manage staff." };
    }
    actorRole = access.role;
    const limit = await consumeRateLimit({ action: "admin.search", userId: required.context.userId });
    if (!limit.allowed) return { ...empty, message: rateLimitMessage(limit.resetAt) };
  } catch {
    return { ...empty, message: "Admin access required." };
  }

  const term = parsed.data.query;
  const offset = parsed.data.offset ?? 0;
  const emailsVisible = actorRole === "owner";

  // Bounded, paginated match — never a full-table scan. Fetch PAGE_SIZE + 1 to
  // detect whether more results exist without a separate count.
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("user_id, full_name, username, avatar_url, deleted_at")
    .is("deleted_at", null)
    .or(`full_name.ilike.%${term}%,username.ilike.%${term}%`)
    .order("full_name", { ascending: true })
    .range(offset, offset + PAGE_SIZE);

  if (error) return { ...empty, message: "Search could not be completed.", emailsVisible };

  const rows = profiles ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  if (page.length === 0) {
    return { ok: true, message: "No matching users.", results: [], hasMore: false, emailsVisible };
  }

  // Current staff standing for each result (one batched query, not N).
  const userIds = page.map((row) => row.user_id);
  const { data: staff } = await admin
    .from("admin_users")
    .select("auth_user_id, role, disabled_at")
    .in("auth_user_id", userIds);
  const staffByUser = new Map(
    (staff ?? [])
      .filter((row) => row.auth_user_id && !row.disabled_at)
      .map((row) => [row.auth_user_id as string, row.role as StaffStanding])
  );

  const results: StaffSearchResult[] = [];
  for (const row of page) {
    let email: string | null = null;
    if (emailsVisible) {
      // Bounded to the page size; only an Owner reaches this branch.
      const { data } = await admin.auth.admin.getUserById(row.user_id);
      email = data.user?.email ?? null;
    }
    results.push({
      userId: row.user_id,
      displayName: row.full_name,
      username: row.username,
      avatarUrl: row.avatar_url,
      email,
      currentRole: staffByUser.get(row.user_id) ?? "standard",
      active: true
    });
  }

  return { ok: true, message: "", results, hasMore, emailsVisible };
}

const assignRoleSchema = z.object({
  targetUserId: z.string().uuid(),
  requestedRole: z.enum(["owner", "admin", "support", "standard"]),
  reason: z.string().trim().max(280).optional()
});

/**
 * Grants/changes/removes a staff role for an existing user. Every guard is
 * server-side: the acting role is re-resolved from the session, the grant
 * matrix is enforced, Owner and final-Owner are protected, the target must
 * exist and be active, and the change is audited (audit-first, rolled back if
 * the audit write fails). Idempotent via upsert on a stable key.
 */
export async function assignStaffRoleAction(input: unknown): Promise<CreateAdminState> {
  const parsed = assignRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid user and role." };

  let admin;
  let actorUserId: string;
  let actorRole: AdminAccessRole;
  try {
    const required = await requireSafetyAdmin();
    admin = required.admin;
    actorUserId = required.context.userId;
    const access = await getAdminAccess(admin, required.context);
    if (!access.permissions.has("admin.roles.manage")) {
      return { ok: false, message: "You don't have permission to manage staff." };
    }
    actorRole = access.role;
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: actorUserId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
  } catch {
    return { ok: false, message: "Admin access required." };
  }

  const { targetUserId, requestedRole, reason } = parsed.data;

  // Target must exist and be an active (non-deleted) account.
  const { data: targetProfile } = await admin
    .from("profiles")
    .select("user_id, full_name, deleted_at")
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (!targetProfile || targetProfile.deleted_at) {
    return { ok: false, message: "That user is unavailable." };
  }

  // Resolve the target's current staff standing from the canonical source.
  const { data: existing } = await admin
    .from("admin_users")
    .select("id, email, role, disabled_at")
    .eq("auth_user_id", targetUserId)
    .maybeSingle();
  const currentRole: StaffStanding =
    existing && !existing.disabled_at ? (existing.role as StaffStanding) : "standard";

  // The grant matrix — the single authority on whether this is allowed.
  const grant = canAssignStaffRole({
    actorRole,
    isSelf: targetUserId === actorUserId,
    targetCurrentRole: currentRole,
    requestedRole
  });
  if (!grant.allowed) {
    // Record the denied attempt (best-effort) so escalation attempts are visible.
    await recordAdminAuditEvent(admin, {
      actorId: actorUserId,
      action: "staff_role_change_denied",
      targetType: "user",
      targetId: targetUserId,
      previousState: { role: currentRole },
      newState: { role: requestedRole },
      reason: grant.reason
    });
    return { ok: false, message: staffGrantMessage(grant.reason) };
  }

  // Final-owner protection is data-level: never lose the last active owner.
  // (The matrix already blocks assigning/removing owner via the UI, so this is
  // defence in depth in case currentRole was owner through another path.)
  if (currentRole === "owner" && requestedRole !== "owner") {
    const { count } = await admin
      .from("admin_users")
      .select("id", { count: "exact", head: true })
      .eq("role", "owner")
      .is("disabled_at", null);
    if ((count ?? 0) <= 1) return { ok: false, message: "Keep at least one active owner." };
  }

  // The target's email (needed for the email-keyed admin_users row).
  const { data: authUser } = await admin.auth.admin.getUserById(targetUserId);
  const email = authUser.user?.email?.trim().toLowerCase();
  if (!email && requestedRole !== "standard") {
    return { ok: false, message: "That account has no email on file, so it can't receive staff access." };
  }

  // Audit-first: if we can't record it, we don't do it (matches createAdminUserAction).
  const logged = await recordAdminAuditEvent(admin, {
    actorId: actorUserId,
    action: requestedRole === "standard" ? "staff_access_removed" : "staff_role_assigned",
    targetType: "user",
    targetId: targetUserId,
    previousState: { role: currentRole },
    newState: { role: requestedRole },
    reason: reason || "Team access management"
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

  if (requestedRole === "standard") {
    // Remove staff access: disable the admin_users row and revoke the assignment.
    if (existing) {
      await admin.from("admin_users").update({ disabled_at: new Date().toISOString() }).eq("id", existing.id);
    }
    await admin.from("admin_assignments").update({ status: "revoked" }).eq("user_id", targetUserId);
    revalidatePath("/admin/admins");
    return { ok: true, message: `${targetProfile.full_name} no longer has staff access.` };
  }

  // Grant/change: upsert the canonical admin_users row (idempotent on email).
  const { error: upsertError } = await admin.from("admin_users").upsert(
    {
      email: email!,
      auth_user_id: targetUserId,
      role: requestedRole,
      invited_by_user_id: actorUserId,
      disabled_at: null
    },
    { onConflict: "email" }
  );
  if (upsertError) return { ok: false, message: "Couldn't update staff access." };

  // Keep the granular governance assignment in sync (matches createAdminUserAction).
  const governanceRole = governanceRoleByLegacyRole[requestedRole as keyof typeof governanceRoleByLegacyRole];
  const { data: role } = await admin.from("admin_roles").select("id").eq("name", governanceRole).maybeSingle();
  if (role) {
    await admin.from("admin_assignments").upsert(
      {
        user_id: targetUserId,
        role_id: role.id,
        status: "active",
        assigned_by: actorUserId,
        starts_at: new Date().toISOString(),
        expires_at: null
      },
      { onConflict: "user_id,role_id" }
    );
  }

  revalidatePath("/admin/admins");
  const label = requestedRole === "admin" ? "an Admin" : "Support";
  return { ok: true, message: `${targetProfile.full_name} is now ${label}.` };
}

function staffGrantMessage(reason: string): string {
  switch (reason) {
    case "owner_not_assignable":
      return "The Owner role can't be assigned here.";
    case "cannot_modify_owner":
      return "Owners can't be changed from Team access.";
    case "admin_cannot_grant_admin":
      return "Only an Owner can grant Admin access.";
    case "admin_cannot_manage_admin":
      return "Only an Owner can change an Admin.";
    case "self":
      return "You can't change your own role.";
    case "no_change":
      return "That user already has this role.";
    case "not_permitted":
      return "You don't have permission to do that.";
    default:
      return "That change isn't allowed.";
  }
}

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
