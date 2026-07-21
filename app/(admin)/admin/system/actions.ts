"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { activateEmergencyControl, deactivateEmergencyControl, recordAdminAuditEvent } from "@/lib/admin/service";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { isEmergencyControl, isRetryableJobStatus } from "@/lib/admin/app-health";
import type { EmergencyControl } from "@/lib/admin/governance";

export type HealthActionState = { ok: boolean; message: string };

type Admin = Awaited<ReturnType<typeof requireSafetyAdmin>>["admin"];

async function authorize(permission: "admin.emergency_controls.manage" | "admin.security.incidents.manage") {
  const { admin, context } = await requireSafetyAdmin();
  await requireAdminPermission(admin, context, permission);
  const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
  if (!limit.allowed) return { ok: false as const, message: rateLimitMessage(limit.resetAt) };
  return { ok: true as const, admin, actorId: context.userId };
}

// ---------------------------------------------------------------------------
// Emergency controls — flip a kill switch. Both directions are audited (via the
// service helpers) and refuse to run if the audit write fails.
// ---------------------------------------------------------------------------
const controlSchema = z.object({
  control: z.string().min(1),
  disabled: z.boolean(),
  reason: z.string().trim().min(3).max(500)
});

export async function setEmergencyControlAction(input: unknown): Promise<HealthActionState> {
  const parsed = controlSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Add a short reason for this change." };
  if (!isEmergencyControl(parsed.data.control)) return { ok: false, message: "Unknown control." };

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await authorize("admin.emergency_controls.manage");
    if (!auth.ok) return auth;
    admin = auth.admin;
    actorId = auth.actorId;
  } catch {
    return { ok: false, message: "You don't have permission to change emergency controls." };
  }

  const control = parsed.data.control as EmergencyControl;
  const done = parsed.data.disabled
    ? await activateEmergencyControl(admin, { control, actorId, reason: parsed.data.reason })
    : await deactivateEmergencyControl(admin, { control, actorId, reason: parsed.data.reason });
  if (!done) return { ok: false, message: "The change could not be recorded, so nothing was flipped." };

  revalidatePath("/admin/system");
  return { ok: true, message: parsed.data.disabled ? "Feature disabled." : "Feature restored." };
}

// ---------------------------------------------------------------------------
// Requeue a failed / dead-letter job.
// ---------------------------------------------------------------------------
const retrySchema = z.object({ jobId: z.string().uuid() });

export async function retryJobAction(input: unknown): Promise<HealthActionState> {
  const parsed = retrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid job." };

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await authorize("admin.security.incidents.manage");
    if (!auth.ok) return auth;
    admin = auth.admin;
    actorId = auth.actorId;
  } catch {
    return { ok: false, message: "You don't have permission to requeue jobs." };
  }

  const { data: job } = await admin.from("jobs").select("id, status, job_type").eq("id", parsed.data.jobId).maybeSingle();
  if (!job) return { ok: false, message: "That job is unavailable." };
  if (!isRetryableJobStatus(job.status)) return { ok: false, message: "Only failed or dead-letter jobs can be requeued." };

  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: "job_requeued",
    targetType: "job",
    targetId: job.id,
    previousState: { status: job.status },
    newState: { status: "queued", jobType: job.job_type },
    reason: "App health requeue"
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so the job was not requeued." };

  const { error } = await admin
    .from("jobs")
    .update({ status: "queued", run_at: new Date().toISOString(), locked_at: null, locked_by: null })
    .eq("id", job.id);
  if (error) return { ok: false, message: "The job could not be requeued." };

  revalidatePath("/admin/system");
  return { ok: true, message: "Job requeued." };
}
