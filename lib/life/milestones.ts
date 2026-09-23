/**
 * Factual friendship milestones.
 *
 * Pure. A milestone is a COUNT or a DATE that has been reached — never a
 * judgement. "Five plans together" is a fact; "great friendship" is not.
 */
import { lifeDedupeKey, relationshipId } from "@/lib/life/events";

export type MilestoneCode =
  | "first_plan_together"
  | "five_plans_together"
  | "ten_plans_together"
  | "first_reconnect"
  | `anniversary_year_${number}`;

export type MilestoneFacts = {
  createdAtMs: number | null;
  plansAttendedTogether: number;
  reconnectsCompleted: number;
};

export type Milestone = {
  code: MilestoneCode;
  label: string;
  reachedAtMs: number | null;
};

export type UpcomingMilestoneReminder = {
  code: MilestoneCode;
  label: string;
  kind: "plan_threshold" | "anniversary";
  plansRemaining: number | null;
  daysRemaining: number | null;
};

const DAY = 24 * 60 * 60 * 1000;

function daysInUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function anniversaryAtMs(createdAtMs: number, yearNumber: number): number {
  const created = new Date(createdAtMs);
  const year = created.getUTCFullYear() + yearNumber;
  const month = created.getUTCMonth();
  const day = Math.min(created.getUTCDate(), daysInUtcMonth(year, month));
  return Date.UTC(
    year,
    month,
    day,
    created.getUTCHours(),
    created.getUTCMinutes(),
    created.getUTCSeconds(),
    created.getUTCMilliseconds()
  );
}

function completedAnniversaryYears(createdAtMs: number, nowMs: number): number {
  const created = new Date(createdAtMs);
  const now = new Date(nowMs);
  let years = now.getUTCFullYear() - created.getUTCFullYear();
  if (years <= 0) return 0;
  if (anniversaryAtMs(createdAtMs, years) > nowMs) years -= 1;
  return Math.max(0, years);
}

export function milestoneLabel(code: MilestoneCode): string {
  if (code === "first_plan_together") return "First plan together";
  if (code === "five_plans_together") return "Five plans together";
  if (code === "ten_plans_together") return "Ten plans together";
  if (code === "first_reconnect") return "Reconnected";
  const year = Number(code.slice("anniversary_year_".length));
  return year === 1 ? "One year as Muddies" : `${year} years as Muddies`;
}

export function milestonesFor(facts: MilestoneFacts, nowMs: number): Milestone[] {
  const reached: Milestone[] = [];
  if (facts.plansAttendedTogether >= 1) reached.push({ code: "first_plan_together", label: milestoneLabel("first_plan_together"), reachedAtMs: null });
  if (facts.plansAttendedTogether >= 5) reached.push({ code: "five_plans_together", label: milestoneLabel("five_plans_together"), reachedAtMs: null });
  if (facts.plansAttendedTogether >= 10) reached.push({ code: "ten_plans_together", label: milestoneLabel("ten_plans_together"), reachedAtMs: null });
  if (facts.reconnectsCompleted >= 1) reached.push({ code: "first_reconnect", label: milestoneLabel("first_reconnect"), reachedAtMs: null });

  if (facts.createdAtMs !== null) {
    const years = completedAnniversaryYears(facts.createdAtMs, nowMs);
    for (let year = 1; year <= years; year += 1) {
      const code = `anniversary_year_${year}` as MilestoneCode;
      reached.push({ code, label: milestoneLabel(code), reachedAtMs: anniversaryAtMs(facts.createdAtMs, year) });
    }
  }
  return reached;
}

export function upcomingMilestoneReminders(facts: MilestoneFacts, nowMs: number): UpcomingMilestoneReminder[] {
  const reminders: UpcomingMilestoneReminder[] = [];
  if (facts.plansAttendedTogether === 4) {
    reminders.push({ code: "five_plans_together", label: milestoneLabel("five_plans_together"), kind: "plan_threshold", plansRemaining: 1, daysRemaining: null });
  }
  if (facts.plansAttendedTogether === 9) {
    reminders.push({ code: "ten_plans_together", label: milestoneLabel("ten_plans_together"), kind: "plan_threshold", plansRemaining: 1, daysRemaining: null });
  }
  if (facts.createdAtMs !== null) {
    const nextYear = completedAnniversaryYears(facts.createdAtMs, nowMs) + 1;
    const nextAt = anniversaryAtMs(facts.createdAtMs, nextYear);
    const daysRemaining = Math.ceil((nextAt - nowMs) / DAY);
    if (daysRemaining >= 1 && daysRemaining <= 7) {
      const code = `anniversary_year_${nextYear}` as MilestoneCode;
      reminders.push({ code, label: milestoneLabel(code), kind: "anniversary", plansRemaining: null, daysRemaining });
    }
  }
  return reminders;
}

export function milestoneReminderCopy(reminder: UpcomingMilestoneReminder, friendName: string) {
  const name = friendName.trim() || "your Muddy";
  if (reminder.kind === "plan_threshold") {
    return { title: "One plan from a milestone", body: `One more completed plan with ${name} reaches ${reminder.label.toLowerCase()}.` };
  }
  const days = reminder.daysRemaining ?? 1;
  return {
    title: "Friendship milestone coming up",
    body: `Your ${reminder.label.toLowerCase()} milestone with ${name} is in ${days} ${days === 1 ? "day" : "days"}.`
  };
}

export function milestoneDedupeKey(userA: string, userB: string, code: MilestoneCode): string {
  return lifeDedupeKey("friendship.milestone_reached", relationshipId(userA, userB), code);
}

export const MILESTONE_FORBIDDEN_WORDS = ["best", "closest", "strongest", "top", "favourite", "score", "rank"];
