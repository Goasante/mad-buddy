"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { refreshMaintenanceState } from "@/lib/maintenance/loader";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

export type MaintenanceActionState = { ok: boolean; message: string };

const schema = z.object({
  isActive: z.boolean(),
  message: z.string().trim().max(500).optional(),
  reason: z.string().trim().min(3).max(500)
});

/** Pause or resume the whole app for every non-staff user. */
export async function setMaintenanceModeAction(input: unknown): Promise<MaintenanceActionState> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Add a short reason for this change." };

  let admin: Awaited<ReturnType<typeof requireSafetyAdmin>>["admin"];
  let actorId: string;
  try {
    const auth = await requireSafetyAdmin();
    await requireAdminPermission(auth.admin, auth.context, "admin.maintenance.manage");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: auth.context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
    admin = auth.admin;
    actorId = auth.context.userId;
  } catch {
    return { ok: false, message: "You don't have permission to change maintenance mode." };
  }

  const { isActive } = parsed.data;
  const message = parsed.data.message?.trim() || null;

  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: isActive ? "maintenance_mode_enabled" : "maintenance_mode_disabled",
    targetType: "system",
    newState: { isActive, message },
    reason: parsed.data.reason
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so nothing was changed." };

  const nowIso = new Date().toISOString();
  const { error } = await admin.from("maintenance_mode").upsert(
    {
      id: true,
      is_active: isActive,
      message,
      activated_by: isActive ? actorId : null,
      activated_at: isActive ? nowIso : null,
      updated_at: nowIso
    },
    { onConflict: "id" }
  );
  if (error) return { ok: false, message: "Maintenance mode could not be updated." };

  await refreshMaintenanceState(admin);
  revalidatePath("/admin/maintenance");
  return {
    ok: true,
    message: isActive ? "The app is now paused for users." : "The app is live again."
  };
}
