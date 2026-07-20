"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deliverNotification } from "@/lib/notifications/server";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { requireAdminPermission } from "@/lib/admin/access";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

export type SafetyActionState = {
  ok: boolean;
  message: string;
};

const reportStatusSchema = z.object({
  reportId: z.string().uuid(),
  status: z.enum(["open", "reviewing", "resolved", "dismissed"])
});

const blockReportedUserSchema = z.object({
  reportId: z.string().uuid()
});

export async function updateReportStatusAction(input: unknown): Promise<SafetyActionState> {
  const parsed = reportStatusSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Choose a valid report status." };
  }

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.reports.review");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
    const { data: report, error: reportError } = await admin
      .from("reports")
      .select("status")
      .eq("id", parsed.data.reportId)
      .maybeSingle();
    if (reportError || !report) return { ok: false, message: "That report is unavailable." };

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "report_status_changed",
      targetType: "report",
      targetId: parsed.data.reportId,
      previousState: { status: report.status },
      newState: { status: parsed.data.status },
      reason: "Trust and safety review"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

    const { error } = await admin
      .from("reports")
      .update({ status: parsed.data.status })
      .eq("id", parsed.data.reportId);

    if (error) {
      return { ok: false, message: "The report status could not be updated." };
    }

    revalidatePath("/safety");
    revalidatePath("/admin");
    revalidatePath("/admin/reports");
    return { ok: true, message: "Report status updated." };
  } catch {
    return {
      ok: false,
      message: "Safety action failed."
    };
  }
}

export async function blockReportedUserAction(input: unknown): Promise<SafetyActionState> {
  const parsed = blockReportedUserSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Choose a valid report." };
  }

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.reports.review");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
    const { data: report, error: reportError } = await admin
      .from("reports")
      .select("id, reporter_id, reported_user_id, status")
      .eq("id", parsed.data.reportId)
      .maybeSingle();

    if (reportError || !report?.reported_user_id) {
      return { ok: false, message: "Reported user is no longer available." };
    }

    const { data: existingBlock, error: existingBlockError } = await admin
      .from("blocked_users")
      .select("id")
      .eq("blocker_id", context.userId)
      .eq("blocked_id", report.reported_user_id)
      .maybeSingle();

    if (existingBlockError) {
      return { ok: false, message: "The existing block status could not be checked." };
    }

    const blockResult = existingBlock
      ? { error: null }
      : await admin.from("blocked_users").insert({
          blocker_id: context.userId,
          blocked_id: report.reported_user_id
        });

    if (blockResult.error) {
      return { ok: false, message: "The reported user could not be blocked." };
    }

    const { error: updateError } = await admin
      .from("reports")
      .update({ status: "reviewing" })
      .eq("id", report.id);

    if (updateError) {
      return { ok: false, message: "The report could not be moved to review." };
    }

    if (report.reporter_id) {
      await deliverNotification(admin, {
        userId: report.reporter_id,
        priority: "high",
        type: "system_alert",
        title: "Safety report update",
        message: "A safety report you submitted is now under review."
      });
    }

    revalidatePath("/safety");
    return { ok: true, message: "Reported user blocked for this moderator and report moved to review." };
  } catch {
    return {
      ok: false,
      message: "Safety action failed."
    };
  }
}
