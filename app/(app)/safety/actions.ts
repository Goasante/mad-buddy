"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deliverNotification } from "@/lib/notifications/server";
import { requireSafetyAdmin } from "@/lib/safety/admin";

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
    const { admin } = await requireSafetyAdmin();
    const { error } = await admin
      .from("reports")
      .update({ status: parsed.data.status })
      .eq("id", parsed.data.reportId);

    if (error) {
      return { ok: false, message: error.message };
    }

    revalidatePath("/safety");
    return { ok: true, message: "Report status updated." };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Safety action failed."
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
    const { data: report, error: reportError } = await admin
      .from("reports")
      .select("id, reporter_id, reported_user_id, status")
      .eq("id", parsed.data.reportId)
      .maybeSingle();

    if (reportError || !report?.reported_user_id) {
      return { ok: false, message: reportError?.message ?? "Reported user is no longer available." };
    }

    const { data: existingBlock, error: existingBlockError } = await admin
      .from("blocked_users")
      .select("id")
      .eq("blocker_id", context.userId)
      .eq("blocked_id", report.reported_user_id)
      .maybeSingle();

    if (existingBlockError) {
      return { ok: false, message: existingBlockError.message };
    }

    const blockResult = existingBlock
      ? { error: null }
      : await admin.from("blocked_users").insert({
          blocker_id: context.userId,
          blocked_id: report.reported_user_id
        });

    if (blockResult.error) {
      return { ok: false, message: blockResult.error.message };
    }

    const { error: updateError } = await admin
      .from("reports")
      .update({ status: "reviewing" })
      .eq("id", report.id);

    if (updateError) {
      return { ok: false, message: updateError.message };
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
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Safety action failed."
    };
  }
}
