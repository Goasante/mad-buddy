import "server-only";

import { z } from "zod";
import { guardAction } from "@/lib/admin/enforcement";
import { upgradePromptFor } from "@/lib/billing/entitlements";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { deliverNotification } from "@/lib/notifications/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  isRsvpChoice,
  planTierLimitsFor,
  resolveRsvp,
  validatePlanTiming,
  validatePlanTitle
} from "@/lib/social/plans";
import {
  activePlanCount,
  eligibleInvitees,
  resolvePlanAccess,
  resolvePlanCapacity
} from "@/lib/social/planning";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import type { PlanType } from "@/lib/supabase/database.types";

/**
 * Transport-agnostic Plans service. Takes an already-authenticated `userId`;
 * shared by the web Server Actions (`createPlanAction`/`rsvpAction`) and the
 * mobile routes `/api/plans` and `/api/plans/[id]/rsvp`.
 *
 * Reads (the plans list) run under RLS directly from the client — only these
 * privileged mutations (tier limits, capacity, invite notifications) need the
 * service-role path, so they live here.
 */

export type ServiceResult = { ok: boolean; message: string; planId?: string };

const uuidSchema = z.string().uuid();

const createPlanSchema = z.object({
  title: z.string(),
  description: z.string().max(500).optional(),
  planType: z.enum(["quick", "scheduled", "poll"]),
  startAt: z.string().datetime({ offset: true }).nullable().optional(),
  endAt: z.string().datetime({ offset: true }).nullable().optional(),
  timezone: z.string().max(60).optional(),
  rsvpDeadline: z.string().datetime({ offset: true }).nullable().optional(),
  placeType: z.enum(["custom", "decide_in_chat", "poll"]).optional(),
  customPlaceText: z.string().max(120).optional(),
  reminderMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  participantIds: z.array(uuidSchema).max(500).optional()
});

function serviceRoleEnvMessage(): string | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return "This action needs the server database configuration.";
  }
  return null;
}

async function senderName(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string) {
  const { data } = await admin.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
  return data?.full_name?.trim() || "A Muddy";
}

export async function createPlan(userId: string, input: unknown): Promise<ServiceResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };

  const parsed = createPlanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the plan details and try again." };

  const titleError = validatePlanTitle(parsed.data.title);
  if (titleError) return { ok: false, message: titleError };

  const rateLimit = await consumeRateLimit({ action: "plans.create", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const startAtMs = parsed.data.startAt ? Date.parse(parsed.data.startAt) : null;
  const endAtMs = parsed.data.endAt ? Date.parse(parsed.data.endAt) : null;
  const timingError = validatePlanTiming({
    planType: parsed.data.planType as PlanType,
    startAtMs,
    endAtMs,
    nowMs: Date.now()
  });
  if (timingError) return { ok: false, message: timingError };

  const admin = createSupabaseAdminClient();

  const guard = await guardAction(admin, { userId, surface: "plans" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  const access = await getCurrentSubscriptionAccess(userId);
  const limits = planTierLimitsFor(access.plan);

  if ((await activePlanCount(admin, userId)) >= limits.maxActivePlans) {
    return {
      ok: false,
      message:
        upgradePromptFor("max_active_plans", access.plan) ?? "You've reached your active plan limit."
    };
  }

  const invitees = await eligibleInvitees(admin, userId, parsed.data.participantIds ?? []);
  // +1 for the host themselves.
  if (invitees.length + 1 > limits.maxPlanParticipants) {
    return {
      ok: false,
      message: `Plans can have up to ${limits.maxPlanParticipants} people on your plan.`
    };
  }

  const isPoll = parsed.data.planType === "poll";
  const { data: plan, error } = await admin
    .from("plans")
    .insert({
      creator_id: userId,
      title: parsed.data.title.trim(),
      description: parsed.data.description?.trim() || null,
      plan_type: parsed.data.planType as PlanType,
      status: isPoll ? "polling" : "inviting",
      start_at: parsed.data.startAt ?? null,
      end_at: parsed.data.endAt ?? null,
      timezone: parsed.data.timezone || "UTC",
      rsvp_deadline: parsed.data.rsvpDeadline ?? null,
      max_participants: limits.maxPlanParticipants === Infinity ? 500 : limits.maxPlanParticipants,
      place_type: parsed.data.placeType ?? "custom",
      custom_place_text: parsed.data.customPlaceText?.trim() || null,
      reminder_minutes: parsed.data.reminderMinutes ?? null
    })
    .select("id")
    .single();

  if (error || !plan) return { ok: false, message: "Couldn't create the plan. Try again." };

  const { recordMilestone } = await import("@/lib/onboarding/service");
  await recordMilestone(admin, userId, "first_plan_created");

  // Host row (auto-going) plus one invited row per eligible Muddy.
  const rows = [
    { plan_id: plan.id, user_id: userId, role: "host" as const, rsvp_status: "going" as const },
    ...invitees.map((inviteeId) => ({
      plan_id: plan.id,
      user_id: inviteeId,
      role: "participant" as const,
      rsvp_status: "invited" as const,
      invited_by: userId
    }))
  ];
  await admin.from("plan_participants").insert(rows);

  if (invitees.length > 0) {
    const name = await senderName(admin, userId);
    await Promise.all(
      invitees.map((inviteeId) =>
        deliverNotification(admin, {
          userId: inviteeId,
          senderId: userId,
          category: "plans",
          type: `plan:invite`,
          title: "New plan invite",
          message: `${name} invited you to "${parsed.data.title.trim()}".`
        })
      )
    );
  }

  return { ok: true, message: "Plan created.", planId: plan.id };
}

export async function rsvp(userId: string, planId: string, status: string): Promise<ServiceResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };
  if (!uuidSchema.safeParse(planId).success) return { ok: false, message: "Plan not found." };
  if (!isRsvpChoice(status)) return { ok: false, message: "Choose Going, Maybe, or Can't make it." };

  const admin = createSupabaseAdminClient();
  const access = await resolvePlanAccess(admin, userId, planId);
  if (!access.exists) return { ok: false, message: "Plan not found." };
  if (!access.participant && !access.isCreator) {
    return { ok: false, message: "You're not on this plan." };
  }

  const { data: plan } = await admin
    .from("plans")
    .select("status, rsvp_deadline")
    .eq("id", planId)
    .maybeSingle();
  if (!plan) return { ok: false, message: "Plan not found." };

  const capacity = await resolvePlanCapacity(admin, planId);
  const decision = resolveRsvp({
    currentStatus: access.participant?.rsvp_status ?? "invited",
    desired: status,
    planStatus: plan.status,
    rsvpDeadlineMs: plan.rsvp_deadline ? Date.parse(plan.rsvp_deadline) : null,
    nowMs: Date.now(),
    // Exclude the responder's own seat from the taken count.
    goingCount:
      access.participant?.rsvp_status === "going" ? Math.max(0, capacity.goingCount - 1) : capacity.goingCount,
    maxParticipants: capacity.maxParticipants
  });

  if (!decision.allowed) {
    const message =
      decision.reason === "removed"
        ? "You're no longer on this plan."
        : decision.reason === "plan_closed"
          ? "This plan is closed."
          : "The RSVP deadline has passed.";
    return { ok: false, message };
  }

  const finalStatus = decision.waitlisted ? "waitlisted" : decision.status;
  const { error } = await admin
    .from("plan_participants")
    .update({
      rsvp_status: finalStatus,
      responded_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("plan_id", planId)
    .eq("user_id", userId);

  if (error) return { ok: false, message: "Couldn't save your RSVP." };

  const message = decision.waitlisted
    ? "This plan is full, you're on the waitlist."
    : status === "going"
      ? "You're going."
      : status === "maybe"
        ? "You marked this as Maybe."
        : "You marked this as Can't make it.";
  return { ok: true, message };
}
