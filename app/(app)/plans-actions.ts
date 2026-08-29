"use server";

import { z } from "zod";
import { upgradePromptFor } from "@/lib/billing/entitlements";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { deliverNotification } from "@/lib/notifications/server";
import {
  canTransitionPlan,
  isPlanChatCloseDays,
  maxVotesPerUser,
  planChatClosesAtMs,
  planTierLimitsFor,
  resolvePollWinner,
  validatePollOptions,
  type PollTally
} from "@/lib/social/plans";
import { addPlanParticipants, createPlan, rsvp } from "@/lib/plans/service";
import { resolvePlanAccess } from "@/lib/social/planning";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, PollType } from "@/lib/supabase/database.types";

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

// ---------------------------------------------------------------------------
// Create plan (spec §5, §10, §11)
// ---------------------------------------------------------------------------

export async function createPlanAction(input: unknown): Promise<PlanActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before creating a plan." };

  return createPlan(userId, input);
}

// ---------------------------------------------------------------------------
// RSVP (spec §22-§30)
// ---------------------------------------------------------------------------

export async function rsvpAction(planId: string, status: string): Promise<PlanActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  return rsvp(userId, planId, status);
}

// ---------------------------------------------------------------------------
// Cancel / leave (spec §15, §16)
// ---------------------------------------------------------------------------

/**
 * Archives a Plan's chat and files it under every member's Archived view.
 *
 * The same two switches the scheduled closure job flips, and for the same
 * reason: conversations.status = 'archived' is what canSendMessage refuses, and
 * conversation_user_preferences.archived_at is what moves a chat out of the
 * active inbox. Nothing is deleted and membership is untouched, so the history
 * stays readable to exactly the people who could read it before.
 */
async function closePlanChatNow(admin: ReturnType<typeof createSupabaseAdminClient>, planId: string) {
  const nowIso = new Date().toISOString();
  const { data: closed } = await admin
    .from("conversations")
    .update({ status: "archived", updated_at: nowIso })
    .eq("context_type", "plan")
    .eq("context_id", planId)
    .eq("status", "active")
    .select("id");
  if (!closed?.length) return;

  const { data: members } = await admin
    .from("conversation_members")
    .select("conversation_id, user_id")
    .in(
      "conversation_id",
      closed.map((row) => row.id)
    )
    .eq("status", "joined");

  for (const member of members ?? []) {
    await admin
      .from("conversation_user_preferences")
      .upsert(
        {
          conversation_id: member.conversation_id,
          user_id: member.user_id,
          archived_at: nowIso,
          updated_at: nowIso
        },
        { onConflict: "conversation_id,user_id", ignoreDuplicates: true }
      );
    // Fills only an empty archived_at, so a member's own earlier choice stands.
    await admin
      .from("conversation_user_preferences")
      .update({ archived_at: nowIso, updated_at: nowIso })
      .eq("conversation_id", member.conversation_id)
      .eq("user_id", member.user_id)
      .is("archived_at", null);
  }
}

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

  /* A CANCELLED PLAN CLOSES ITS CHAT NOW.
   *
   * Cancelling used to leave the Plan Chat fully open forever: the plan
   * vanished from Upcoming, everyone was notified it was off, and the chat
   * stayed live indefinitely with nothing left to arrange. The hourly closure
   * job would eventually catch it -- planChatClosesAtMs returns the terminal
   * instant for a cancelled plan -- but making the host wait up to an hour to
   * see the consequence of their own action is the wrong shape. Doing it here
   * as well is safe precisely because both paths apply the same rule: the job
   * re-filters on status = 'active' and simply finds nothing to do.
   *
   * CLOSED, NOT DELETED. Every message stays exactly where it was, and every
   * member keeps reading it -- people need to see "sorry, called it off" and
   * whatever was said afterwards. Only new messages stop. */
  await closePlanChatNow(admin, planId);

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

// ---------------------------------------------------------------------------
// Plan Chat closure window
// ---------------------------------------------------------------------------

/**
 * The four windows a client may ask for. Anything else is refused before a
 * single row is read.
 *
 * A NUMBER, NOT A TIMESTAMP. The client never proposes when the chat closes;
 * it picks one of four durations and the server derives the instant from the
 * Plan's own timing. There is nothing on the wire to forge -- a caller cannot
 * push the close time out to next year, because no close time is transmitted.
 */
const closeWindowSchema = z.object({
  planId: uuidSchema,
  days: z.number().int().refine(isPlanChatCloseDays, "Choose 1, 3, 7 or 14 days.")
});

/**
 * Sets how long a Plan's chat stays open after the Plan ends.
 *
 * HOST ONLY. Checked against plans.creator_id on the server, and enforced
 * again by the `.eq("creator_id", userId)` on the write itself, so a
 * participant calling this action directly changes nothing even if the first
 * check were somehow passed. Being in the Plan Chat is not authorization to
 * govern it.
 *
 * WORKS BEFORE AND AFTER THE SCHEDULED CLOSE. Extending a chat that has
 * already closed reopens it, because closure state is derived from the window
 * -- so a host who meant 14 days and picked 1 is not stuck with a dead chat.
 * The reopen is deliberate and explicit rather than a side effect: the
 * conversation goes back to 'active' only when the new window actually puts
 * the close time in the future.
 */
export async function setPlanChatCloseWindowAction(input: unknown): Promise<PlanActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = closeWindowSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose 1, 3, 7 or 14 days." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: plan } = await admin
    .from("plans")
    .select("id, creator_id, status, start_at, end_at, created_at, cancelled_at, completed_at")
    .eq("id", parsed.data.planId)
    .maybeSingle();
  if (!plan) return { ok: false, message: "Plan not found." };
  if (plan.creator_id !== userId) {
    return { ok: false, message: "Only the host can change this." };
  }

  const { error } = await admin
    .from("plans")
    .update({ chat_close_days: parsed.data.days, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.planId)
    // Belt and braces: the authorization above already refused a non-host, and
    // this makes a non-host write impossible rather than merely unreachable.
    .eq("creator_id", userId);
  if (error) return { ok: false, message: "Couldn't update the chat window." };

  /* REOPEN, WHEN THE NEW WINDOW ACTUALLY SAYS SO.
   *
   * The closure job archives the conversation; nothing else would ever undo
   * that, so a host lengthening the window after the chat closed would see no
   * effect at all. Re-deriving the close time with the NEW window and
   * reopening only when it lands in the future keeps one rule in charge of the
   * state -- and shortening the window still leaves the chat closed, because
   * the derived time is then in the past. */
  const closesAtMs = planChatClosesAtMs(
    {
      status: plan.status,
      startAt: plan.start_at,
      endAt: plan.end_at,
      createdAt: plan.created_at,
      closeDays: parsed.data.days,
      terminalAt: plan.cancelled_at ?? plan.completed_at
    },
    Date.now()
  );
  if (closesAtMs !== null && closesAtMs > Date.now()) {
    await admin
      .from("conversations")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("context_type", "plan")
      .eq("context_id", parsed.data.planId)
      // Only a chat this job closed. A conversation restricted or deleted for
      // moderation reasons is never reopened by a scheduling choice.
      .eq("status", "archived");
  }

  return { ok: true, message: `Chat closes ${parsed.data.days} day${parsed.data.days === 1 ? "" : "s"} after the plan.` };
}

export async function leavePlanAction(planId: string): Promise<PlanActionState> {
  if (!uuidSchema.safeParse(planId).success) return { ok: false, message: "Plan not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: plan } = await admin.from("plans").select("creator_id").eq("id", planId).maybeSingle();
  if (!plan) return { ok: false, message: "Plan not found." };
  if (plan.creator_id === userId) {
    return { ok: false, message: "You're the host, cancel the plan instead." };
  }

  const result = await rsvp(userId, planId, "not_going");
  return result.ok ? { ...result, message: "You've left this plan." } : result;
}

export async function addPlanParticipantsAction(
  planId: string,
  participantIds: string[]
): Promise<PlanActionState> {
  if (!uuidSchema.safeParse(planId).success) return { ok: false, message: "Plan not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  return addPlanParticipants(userId, planId, participantIds);
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
        upgradePromptFor("max_polls_per_plan", subscription.plan) ?? "You've reached the poll limit for this plan."
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
      message: winner.reason === "no_votes" ? "No votes yet." : "There's a tie, pick a winner manually."
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
