import type { SupabaseClient } from "@supabase/supabase-js";

import type { ModerationActionType, ReportKind } from "@/lib/admin/moderation";
import type { Database } from "@/lib/supabase/database.types";

const POINTS: Partial<Record<ModerationActionType, number>> = {
  hide_content: 1,
  remove_content: 2,
  warn_user: 1,
  rate_limit_user: 2,
  suspend_feature: 2,
  temporary_suspension: 4,
  permanent_suspension: 8
};

export type EscalationLevel = "none" | "warning" | "day_suspension" | "week_suspension" | "month_suspension" | "permanent_review";

export function strikePointsForAction(action: ModerationActionType): number {
  return POINTS[action] ?? 0;
}

export function escalationForPoints(points: number): { level: EscalationLevel; label: string } {
  if (points >= 16) return { level: "permanent_review", label: "Permanent suspension review" };
  if (points >= 12) return { level: "month_suspension", label: "30-day suspension" };
  if (points >= 8) return { level: "week_suspension", label: "7-day suspension" };
  if (points >= 5) return { level: "day_suspension", label: "24-hour suspension" };
  if (points >= 3) return { level: "warning", label: "Formal warning" };
  return { level: "none", label: "No automatic escalation" };
}

export async function recordModerationStrike(
  admin: SupabaseClient<Database>,
  input: {
    userId: string;
    reportKind: ReportKind;
    reportId: string;
    actionType: ModerationActionType;
    reasonCode: string;
    actorId: string;
  }
): Promise<void> {
  const points = strikePointsForAction(input.actionType);
  if (points === 0) return;
  await admin.from("moderation_strikes").upsert({
    user_id: input.userId,
    report_kind: input.reportKind,
    report_id: input.reportId,
    action_type: input.actionType,
    points,
    reason_code: input.reasonCode.slice(0, 120),
    created_by: input.actorId,
    expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
    reversed_at: null
  }, { onConflict: "report_kind,report_id" });
}

export async function activeStrikePoints(admin: SupabaseClient<Database>, userId: string): Promise<number> {
  const { data } = await admin
    .from("moderation_strikes")
    .select("points")
    .eq("user_id", userId)
    .is("reversed_at", null)
    .gt("expires_at", new Date().toISOString());
  return (data ?? []).reduce((total: number, row: { points: number }) => total + row.points, 0);
}
