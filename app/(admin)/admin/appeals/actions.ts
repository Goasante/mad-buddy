"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { deliverNotification } from "@/lib/notifications/server";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

const schema = z.object({
  appealId: z.string().uuid(),
  decision: z.enum(["upheld", "reversed"]),
  note: z.string().trim().min(3).max(1000)
});

export async function decideAppealAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Add a clear decision note." };
  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.appeals.review");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const { data: appeal } = await admin
      .from("appeals")
      .select("id, subject_user_id, source_restriction_id, status")
      .eq("id", parsed.data.appealId)
      .maybeSingle();
    if (!appeal || !["submitted", "in_review"].includes(appeal.status)) {
      return { ok: false, message: "That appeal has already been decided or is unavailable." };
    }

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: `appeal_${parsed.data.decision}`,
      targetType: "appeal",
      targetId: appeal.id,
      previousState: { status: appeal.status },
      newState: { status: "decided", decision: parsed.data.decision },
      reason: parsed.data.note
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

    if (parsed.data.decision === "reversed" && appeal.source_restriction_id) {
      const { error } = await admin.from("user_restrictions").update({ lifted_at: new Date().toISOString() }).eq("id", appeal.source_restriction_id).eq("user_id", appeal.subject_user_id);
      if (error) return { ok: false, message: "The restriction could not be lifted." };
    }
    const now = new Date().toISOString();
    const { error } = await admin.from("appeals").update({
      status: "decided",
      decision: parsed.data.decision,
      decision_note: parsed.data.note,
      assigned_to: context.userId,
      decided_at: now,
      updated_at: now
    }).eq("id", appeal.id);
    if (error) return { ok: false, message: "The appeal decision could not be saved." };

    await deliverNotification(admin, {
      userId: appeal.subject_user_id,
      type: "system_alert",
      priority: "high",
      title: parsed.data.decision === "reversed" ? "Appeal approved" : "Appeal decision",
      message: parsed.data.decision === "reversed" ? "Your appeal was approved and the restriction was removed." : `Your appeal was not approved. ${parsed.data.note}`
    });
    revalidatePath("/admin/appeals");
    revalidatePath("/settings/account-status");
    return { ok: true, message: parsed.data.decision === "reversed" ? "Appeal approved and restriction removed." : "Appeal upheld." };
  } catch {
    return { ok: false, message: "Admin access is required." };
  }
}
