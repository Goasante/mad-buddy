"use server";

import { z } from "zod";
import { guardAction } from "@/lib/admin/enforcement";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { deliverNotification } from "@/lib/notifications/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  canTransitionPlan,
  isRsvpChoice,
  maxVotesPerUser,
  planTierLimitsFor,
  resolvePollWinner,
  resolveRsvp,
  validatePlanTiming,
  validatePlanTitle,
  validatePollOptions,
  type PollTally
} from "@/lib/social/plans";
import {
  activePlanCount,
  eligibleInvitees,
  resolvePlanAccess,
  resolvePlanCapacity
} from "@/lib/social/planning";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, PlanType, PollType } from "@/lib/supabase/database.types";

export type PlanActionState = {
  ok: boolean;
  message: string;
  planId?: string;
  pollId?: string;
};

const uuidSchema = z.string().uuid();

function missingEnvState(): PlanActionState | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return { ok: false, message: "This action needs the server database configuration." };
  }
  return null;
}

async function getAuthedUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

async function senderName(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string) {
  const { data } = await admin.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
  return data?.full_name?.trim() || "A Muddy";
}

// ---------------------------------------------------------------------------
// Create plan (spec §5, §10, §11)
// ---------------------------------------------------------------------------

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

export async function createPlanAction(input: unknown): Promise<PlanActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = createPlanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the plan details and try again." };

  const titleError = validatePlanTitle(parsed.data.title);
  if (titleError) return { ok: false, message: titleError };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before creating a plan." };

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
        access.plan === "free"
          ? "Free plan allows up to 5 active plans. Upgrade for more."
          : "You've reached your active plan limit."
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

// ---------------------------------------------------------------------------
// RSVP (spec §22-§30)
// ---------------------------------------------------------------------------

export async function rsvpAction(planId: string, status: string): Promise<PlanActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(planId).success) return { ok: false, message: "Plan not found." };
  if (!isRsvpChoice(status)) return { ok: false, message: "Choose Going, Maybe, or Can't make it." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

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
    ? "This plan is full — you're on the waitlist."
    : status === "going"
      ? "You're going."
      : status === "maybe"
        ? "You marked this as Maybe."
        : "You marked this as Can't make it.";
  return { ok: true, message };
}

// ---------------------------------------------------------------------------
// Cancel / leave (spec §15, §16)
// ---------------------------------------------------------------------------

export async function cancelPlanAction(planId: string): Promise<PlanActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(planId).success) return { ok: false, message: "Plan not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: plan } = await admin
    .from("plans")
    .select("status, creator_id, title")
    .eq("id", planId)
    .maybeSingle();
  if (!plan) return { ok: false, message: "Plan not found." };
  if (plan.creator_id !== userId) return { ok: false, message: "Only the host can cancel this plan." };
  if (!canTransitionPlan(plan.status, "cancelled")) {
    return { ok: false, message: "This plan can't be cancelled." };
  }

  const { error } = await admin
    .from("plans")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", planId)
    .eq("creator_id", userId);
  if (error) return { ok: false, message: "Couldn't cancel the plan." };

  // Notify everyone who was going or maybe (not the host).
  const { data: participants } = await admin
    .from("plan_participants")
    .select("user_id")
    .eq("plan_id", planId)
    .in("rsvp_status", ["invited", "viewed", "going", "maybe", "waitlisted"])
    .neq("user_id", userId);
  await Promise.all(
    (participants ?? []).map((participant) =>
      deliverNotification(admin, {
        userId: participant.user_id,
        senderId: userId,
        category: "plans",
        priority: "high",
        type: `plan:cancelled`,
        title: "Plan cancelled",
        message: `"${plan.title}" has been cancelled.`
      })
    )
  );

  return { ok: true, message: "This plan has been cancelled." };
}

export async function leavePlanAction(planId: string): Promise<PlanActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(planId).success) return { ok: false, message: "Plan not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: plan } = await admin.from("plans").select("creator_id").eq("id", planId).maybeSingle();
  if (!plan) return { ok: false, message: "Plan not found." };
  // A lone host must cancel rather than leave (spec §16).
  if (plan.creator_id === userId) {
    return { ok: false, message: "You're the host — cancel the plan instead." };
  }

  const { error } = await admin
    .from("plan_participants")
    .update({ rsvp_status: "not_going", responded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("plan_id", planId)
    .eq("user_id", userId);
  if (error) return { ok: false, message: "Couldn't leave the plan." };
  return { ok: true, message: "You've left this plan." };
}

export async function addPlanParticipantsAction(
  planId: string,
  participantIds: string[]
): Promise<PlanActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(planId).success) return { ok: false, message: "Plan not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const access = await resolvePlanAccess(admin, userId, planId);
  if (!access.exists) return { ok: false, message: "Plan not found." };
  if (!access.canEdit) return { ok: false, message: "Only the host can invite people." };

  const rateLimit = await consumeRateLimit({ action: "plans.invite", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const invitees = await eligibleInvitees(admin, userId, participantIds);
  if (invitees.length === 0) return { ok: false, message: "Add approved Muddies only." };

  const { error } = await admin.from("plan_participants").upsert(
    invitees.map((inviteeId) => ({
      plan_id: planId,
      user_id: inviteeId,
      role: "participant" as const,
      rsvp_status: "invited" as const,
      invited_by: userId
    })),
    { onConflict: "plan_id,user_id", ignoreDuplicates: true }
  );
  if (error) return { ok: false, message: "Couldn't add those people." };

  const name = await senderName(admin, userId);
  const { data: plan } = await admin.from("plans").select("title").eq("id", planId).maybeSingle();
  await Promise.all(
    invitees.map((inviteeId) =>
      deliverNotification(admin, {
        userId: inviteeId,
        senderId: userId,
        category: "plans",
        type: `plan:invite`,
        title: "New plan invite",
        message: `${name} invited you to "${plan?.title ?? "a plan"}".`
      })
    )
  );
  return { ok: true, message: `Invited ${invitees.length} to the plan.` };
}

// ---------------------------------------------------------------------------
// Polls (spec §32-§43)
// ---------------------------------------------------------------------------

const createPollSchema = z.object({
  planId: uuidSchema,
  pollType: z.enum(["time", "date", "place", "activity"]),
  question: z.string().min(1).max(160),
  selectionMode: z.enum(["single", "multiple"]).optional(),
  options: z.array(z.object({ label: z.string(), value: z.string().max(120).optional() })).min(2).max(6),
  closesAt: z.string().datetime({ offset: true }).nullable().optional()
});

export async function createPollAction(input: unknown): Promise<PlanActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = createPollSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the poll details and try again." };

  const optionsError = validatePollOptions(parsed.data.options.map((option) => option.label));
  if (optionsError) return { ok: false, message: optionsError };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const access = await resolvePlanAccess(admin, userId, parsed.data.planId);
  if (!access.exists) return { ok: false, message: "Plan not found." };
  if (!access.canEdit) return { ok: false, message: "Only the host can add a poll." };

  const subscription = await getCurrentSubscriptionAccess(userId);
  const limits = planTierLimitsFor(subscription.plan);
  const { count: pollCount } = await admin
    .from("plan_polls")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", parsed.data.planId);
  if ((pollCount ?? 0) >= limits.maxPollsPerPlan) {
    return {
      ok: false,
      message:
        subscription.plan === "free"
          ? "Free plan allows one poll per plan. Upgrade for more."
          : "You've reached the poll limit for this plan."
    };
  }

  const { data: poll, error } = await admin
    .from("plan_polls")
    .insert({
      plan_id: parsed.data.planId,
      creator_id: userId,
      poll_type: parsed.data.pollType as PollType,
      question: parsed.data.question.trim(),
      selection_mode: parsed.data.selectionMode ?? "single",
      closes_at: parsed.data.closesAt ?? null
    })
    .select("id")
    .single();
  if (error || !poll) return { ok: false, message: "Couldn't create the poll." };

  await admin.from("plan_poll_options").insert(
    parsed.data.options.map((option, index) => ({
      poll_id: poll.id,
      label: option.label.trim(),
      value: option.value ?? null,
      sort_order: index
    }))
  );

  return { ok: true, message: "Poll added.", pollId: poll.id };
}

export async function votePollAction(pollId: string, optionIds: string[]): Promise<PlanActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(pollId).success) return { ok: false, message: "Poll not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: poll } = await admin
    .from("plan_polls")
    .select("id, plan_id, status, selection_mode, closes_at")
    .eq("id", pollId)
    .maybeSingle();
  if (!poll) return { ok: false, message: "Poll not found." };
  if (poll.status !== "open") return { ok: false, message: "This poll is closed." };
  if (poll.closes_at && Date.parse(poll.closes_at) <= Date.now()) {
    return { ok: false, message: "This poll has closed." };
  }

  const access = await resolvePlanAccess(admin, userId, poll.plan_id);
  if (!access.canView) return { ok: false, message: "You can't vote on this poll." };

  const allowed = maxVotesPerUser(poll.selection_mode);
  const chosen = [...new Set(optionIds)].filter((id) => uuidSchema.safeParse(id).success).slice(0, allowed);
  if (chosen.length === 0) return { ok: false, message: "Pick an option." };

  // Options must belong to this poll (no cross-poll vote stuffing).
  const { data: validOptions } = await admin
    .from("plan_poll_options")
    .select("id")
    .eq("poll_id", pollId)
    .in("id", chosen);
  const validIds = (validOptions ?? []).map((option) => option.id);
  if (validIds.length === 0) return { ok: false, message: "That option isn't part of this poll." };

  // Replace prior votes (single-choice) or reconcile (multiple-choice).
  await admin.from("plan_poll_votes").delete().eq("poll_id", pollId).eq("user_id", userId);
  const { error } = await admin
    .from("plan_poll_votes")
    .insert(validIds.map((optionId) => ({ poll_id: pollId, option_id: optionId, user_id: userId })));
  if (error) return { ok: false, message: "Couldn't record your vote." };

  return { ok: true, message: "Vote recorded." };
}

export async function confirmPollAction(pollId: string): Promise<PlanActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(pollId).success) return { ok: false, message: "Poll not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: poll } = await admin
    .from("plan_polls")
    .select("id, plan_id, poll_type, status")
    .eq("id", pollId)
    .maybeSingle();
  if (!poll) return { ok: false, message: "Poll not found." };

  const access = await resolvePlanAccess(admin, userId, poll.plan_id);
  if (!access.canEdit) return { ok: false, message: "Only the host can confirm a result." };

  const { data: options } = await admin
    .from("plan_poll_options")
    .select("id, label, value")
    .eq("poll_id", pollId);
  const { data: votes } = await admin.from("plan_poll_votes").select("option_id").eq("poll_id", pollId);

  const voteCounts = new Map<string, number>();
  for (const vote of votes ?? []) {
    voteCounts.set(vote.option_id, (voteCounts.get(vote.option_id) ?? 0) + 1);
  }
  const tallies: PollTally[] = (options ?? []).map((option) => ({
    optionId: option.id,
    votes: voteCounts.get(option.id) ?? 0,
    sortValue: option.value ?? option.label
  }));

  const tieBreak = poll.poll_type === "time" || poll.poll_type === "date" ? "earliest" : "host";
  const winner = resolvePollWinner(tallies, tieBreak);
  if (!winner.resolved) {
    return {
      ok: false,
      message: winner.reason === "no_votes" ? "No votes yet." : "There's a tie — pick a winner manually."
    };
  }

  const winningOption = (options ?? []).find((option) => option.id === winner.winnerId);
  await admin
    .from("plan_polls")
    .update({ status: "confirmed", confirmed_option_id: winner.winnerId, updated_at: new Date().toISOString() })
    .eq("id", pollId);

  // Apply the winning option to the plan and move it toward confirmed.
  const planUpdate: Database["public"]["Tables"]["plans"]["Update"] = {
    updated_at: new Date().toISOString()
  };
  if (poll.poll_type === "time" || poll.poll_type === "date") {
    if (winningOption?.value) planUpdate.start_at = winningOption.value;
  } else if (poll.poll_type === "place") {
    planUpdate.custom_place_text = winningOption?.label ?? null;
  }
  const { data: plan } = await admin.from("plans").select("status").eq("id", poll.plan_id).maybeSingle();
  if (plan && canTransitionPlan(plan.status, "confirmed")) planUpdate.status = "confirmed";
  await admin.from("plans").update(planUpdate).eq("id", poll.plan_id);

  return { ok: true, message: `Confirmed: ${winningOption?.label ?? "winning option"}.` };
}
