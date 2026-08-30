import "server-only";

import { z } from "zod";
import { guardAction } from "@/lib/admin/enforcement";
import { upgradePromptFor } from "@/lib/billing/entitlements";
import { loadEffectivePlansForUsers } from "@/lib/billing/service";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { PLAN_CATEGORIES } from "@/lib/plans/plan-covers";
import {
  canonicalPlanErrorIdentifier,
  mapCanonicalPlanError,
  toCanonicalPlanLimit,
  toCanonicalParticipantLimit,
  type PlanServiceCode
} from "@/lib/plans/canonical-contract";
import type { PlanCategory } from "@/lib/supabase/database.types";
import {
  isRsvpChoice,
  planTierLimitsFor,
  validatePlanTiming,
  validatePlanTitle
} from "@/lib/social/plans";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import type { PlanType, SubscriptionPlan } from "@/lib/supabase/database.types";

/**
 * Transport-agnostic Plans service. Takes an already-authenticated `userId`;
 * shared by the web Server Actions (`createPlanAction`/`rsvpAction`) and the
 * mobile routes `/api/plans` and `/api/plans/[id]/rsvp`.
 *
 * Reads (the plans list) run under RLS directly from the client — only these
 * privileged mutations (tier limits, capacity, invite notifications) need the
 * service-role path, so they live here.
 */

export type ServiceResult = {
  ok: boolean;
  message: string;
  code?: PlanServiceCode;
  planId?: string;
  conversationId?: string;
  created?: boolean;
  rsvpStatus?: string;
  addedCount?: number;
};

export type PlanListItem = {
  id: string;
  title: string;
  description: string | null;
  planType: string;
  status: string;
  startAt: string | null;
  /** Honoured by planPhase, so a plan stays upcoming until it actually ends. */
  endAt: string | null;
  /** Anchors the grace window for an undated plan. */
  createdAt: string | null;
  placeText: string | null;
  organiserName: string;
  organiserPlan: SubscriptionPlan;
  isHost: boolean;
  myRsvp: string;
  goingCount: number;
  attendeeCount: number;
  /**
   * The Plan conversation, but ONLY when this viewer is a joined member of it.
   * Null means "no chat for you yet" -- an invitee who has not responded, or a
   * Plan whose conversation does not exist. The UI keys the Plan Chat CTA off
   * this, so it can never offer a door the server would close.
   */
  myConversationId: string | null;
};

export type PlanInviteeItem = {
  id: string;
  name: string;
  username: string;
  /** Safe profile avatar, or null for the canonical fallback. */
  avatarUrl: string | null;
  plan: SubscriptionPlan;
};

const uuidSchema = z.string().uuid();

const createPlanSchema = z.object({
  requestKey: uuidSchema,
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
  // What the plan IS, which resolves its canonical cover. Optional: a plan
  // without one renders the branded fallback rather than a guessed cover.
  // Validated against the cover registry, so this enum and the
  // plans_category_check constraint cannot drift apart.
  category: z.enum(PLAN_CATEGORIES as [PlanCategory, ...PlanCategory[]]).nullable().optional(),
  participantIds: z.array(uuidSchema).max(500).optional()
});

const addParticipantsSchema = z.object({
  planId: uuidSchema,
  participantIds: z.array(uuidSchema).min(1).max(500)
});

function serviceRoleEnvMessage(): string | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return "This action needs the server database configuration.";
  }
  return null;
}

/**
 * The user's plans (participant or creator) plus their Muddies for the invite
 * picker. Read-only, service-role resolved (mirrors the web plans page loader,
 * trimmed for the mobile list: no polls/avatars). Shared by `/api/plans` GET.
 */
export async function listPlansForUser(
  userId: string
): Promise<ServiceResult & { plans: PlanListItem[]; invitees: PlanInviteeItem[] }> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage, plans: [], invitees: [] };

  const admin = createSupabaseAdminClient();

  const [{ data: myRows }, { data: createdPlans }, { data: friendships }] = await Promise.all([
    admin
      .from("plan_participants")
      .select("plan_id, role, rsvp_status")
      .eq("user_id", userId)
      .neq("rsvp_status", "removed"),
    admin.from("plans").select("id").eq("creator_id", userId),
    admin
      .from("friendships")
      .select("user_one_id, user_two_id")
      // Active friendships only: ended_at IS NULL is the canonical definition of "currently Muddies".
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`).is("ended_at", null)
  ]);

  const friendIds = (friendships ?? []).map((friendship) =>
    friendship.user_one_id === userId ? friendship.user_two_id : friendship.user_one_id
  );
  const inviteeProfiles = friendIds.length
    ? (await admin.from("profiles").select("user_id, full_name, username, avatar_url").in("user_id", friendIds)).data ?? []
    : [];
  const inviteePlans = await loadEffectivePlansForUsers(admin, friendIds);
  const invitees: PlanInviteeItem[] = inviteeProfiles.map((profile) => ({
        id: profile.user_id,
        name: profile.full_name?.trim() || "A Muddy",
        username: profile.username,
        /* THE SAME PERSON EITHER SIDE OF A TAP.
         *
         * This query never selected avatar_url, so a Muddy shown with their
         * real photo on Home arrived in the Plan composer as a bare initial --
         * the app appearing to forget who they were between two screens. One
         * more column on a query that already runs: no extra round trip and
         * no per-participant fetch. */
        avatarUrl: profile.avatar_url,
        plan: inviteePlans.get(profile.user_id) ?? "free"
      }));

  const planIds = [
    ...new Set([
      ...(myRows ?? []).map((row) => row.plan_id),
      ...(createdPlans ?? []).map((row) => row.id)
    ])
  ];
  const myRowByPlan = new Map((myRows ?? []).map((row) => [row.plan_id, row]));

  if (planIds.length === 0) {
    return { ok: true, message: "ok", plans: [], invitees };
  }

  const [{ data: planRows }, { data: participantRows }] = await Promise.all([
    admin
      .from("plans")
      .select(
        // end_at and created_at feed the canonical lifecycle helper: end_at so
        // a plan running 7-11pm stays upcoming at 8, created_at so an undated
        // plan's grace window can be measured. Both were written but never
        // read back, which is why the client could not tell either apart.
        "id, creator_id, title, description, plan_type, status, start_at, end_at, created_at, custom_place_text, category, cover_image_url"
      )
      .in("id", planIds),
    admin.from("plan_participants").select("plan_id, user_id, role, rsvp_status").in("plan_id", planIds)
  ]);

  /* THE PLAN CHAT LINK, AND WHO IS ALLOWED TO SEE IT.
   *
   * Plan detail had no way into the Plan conversation at all -- the one place
   * the people meeting up would actually coordinate was unreachable from the
   * Plan itself.
   *
   * Membership is the gate, not RSVP. The canonical rule admits `going` and
   * `maybe` (plus friendship/block checks) via reconcile_plan_conversation_
   * members, and re-deriving that here would be a second, drifting copy of it.
   * Reading conversation_members instead means the button appears exactly when
   * the server would let the user in -- so an invitee never taps a CTA that is
   * about to refuse them, and a rule change in the migration needs no matching
   * change here. */
  const { data: planConversations } = await admin
    .from("conversations")
    .select("id, context_id")
    .eq("context_type", "plan")
    .in("context_id", planIds);

  const conversationIds = (planConversations ?? []).map((row) => row.id);
  const joinedConversationIds = new Set<string>();
  if (conversationIds.length > 0) {
    const { data: myMemberships } = await admin
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", userId)
      .eq("status", "joined")
      .in("conversation_id", conversationIds);
    for (const row of myMemberships ?? []) joinedConversationIds.add(row.conversation_id);
  }
  const myConversationByPlan = new Map<string, string>();
  for (const row of planConversations ?? []) {
    if (row.context_id && joinedConversationIds.has(row.id)) {
      myConversationByPlan.set(row.context_id, row.id);
    }
  }

  const organiserIds = [...new Set((planRows ?? []).map((plan) => plan.creator_id))];
  const organiserPlans = await loadEffectivePlansForUsers(admin, organiserIds);
  const nameById = new Map<string, string>();
  if (organiserIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", organiserIds);
    for (const profile of profiles ?? []) {
      nameById.set(profile.user_id, profile.full_name?.trim() || "A Muddy");
    }
  }

  const countsByPlan = new Map<string, { going: number; total: number }>();
  for (const row of participantRows ?? []) {
    const counts = countsByPlan.get(row.plan_id) ?? { going: 0, total: 0 };
    counts.total += 1;
    if (row.rsvp_status === "going") counts.going += 1;
    countsByPlan.set(row.plan_id, counts);
  }

  const plans: PlanListItem[] = (planRows ?? []).map((plan) => {
    const myRow = myRowByPlan.get(plan.id);
    const isHost = plan.creator_id === userId || myRow?.role === "host" || myRow?.role === "co_host";
    const counts = countsByPlan.get(plan.id) ?? { going: 0, total: 0 };
    return {
      id: plan.id,
      title: plan.title,
      description: plan.description,
      planType: plan.plan_type,
      status: plan.status,
      startAt: plan.start_at,
      endAt: plan.end_at ?? null,
      createdAt: plan.created_at ?? null,
      placeText: plan.custom_place_text,
      // Cover inputs for the canonical resolver (lib/plans/plan-covers).
      category: plan.category ?? null,
      coverImageUrl: plan.cover_image_url ?? null,
      organiserName: plan.creator_id === userId ? "You" : nameById.get(plan.creator_id) ?? "A Muddy",
      organiserPlan: organiserPlans.get(plan.creator_id) ?? "free",
      isHost,
      myRsvp: isHost ? "going" : myRow?.rsvp_status ?? "invited",
      goingCount: counts.going,
      attendeeCount: counts.total,
      // Present only when this viewer is genuinely a joined member.
      myConversationId: myConversationByPlan.get(plan.id) ?? null
    };
  });

  return { ok: true, message: "ok", plans, invitees };
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

  const { data, error } = await admin.rpc("create_plan_lifecycle", {
    p_actor_id: userId,
    p_request_key: parsed.data.requestKey,
    p_title: parsed.data.title.trim(),
    p_description: parsed.data.description?.trim() || null,
    p_plan_type: parsed.data.planType,
    p_start_at: parsed.data.startAt ?? null,
    p_end_at: parsed.data.endAt ?? null,
    p_timezone: parsed.data.timezone || "UTC",
    p_rsvp_deadline: parsed.data.rsvpDeadline ?? null,
    p_place_type: parsed.data.placeType ?? "custom",
    p_custom_place_text: parsed.data.customPlaceText?.trim() || null,
    p_reminder_minutes: parsed.data.reminderMinutes ?? null,
    p_category: parsed.data.category ?? null,
    p_invitee_ids: [...new Set(parsed.data.participantIds ?? [])],
    p_initial_going_ids: [],
    p_source_hangout_id: null,
    p_effective_max_active_plans: toCanonicalPlanLimit(limits.maxActivePlans),
    p_effective_max_participants: toCanonicalParticipantLimit(limits.maxPlanParticipants)
  });

  if (error || !data?.[0]) {
    const identifier = canonicalPlanErrorIdentifier(error);
    const mapped = mapCanonicalPlanError(error, "Couldn't create the plan. Try again.");
    if (mapped.code === "limit_reached") {
      return {
        ...mapped,
        message:
          identifier === "PLAN_ACTIVE_LIMIT_REACHED"
            ? upgradePromptFor("max_active_plans", access.plan) ?? "You've reached your active plan limit."
            : `Plans can have up to ${limits.maxPlanParticipants} people.`
      };
    }
    return mapped;
  }

  const result = data[0];
  return {
    ok: true,
    message: "Plan created.",
    planId: result.plan_id,
    conversationId: result.conversation_id,
    created: result.created
  };
}

export async function rsvp(userId: string, planId: string, status: string): Promise<ServiceResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };
  if (!uuidSchema.safeParse(planId).success) return { ok: false, message: "Plan not found." };
  if (!isRsvpChoice(status)) return { ok: false, message: "Choose Going, Maybe, or Can't make it." };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("set_plan_participant_rsvp", {
    p_actor_id: userId,
    p_plan_id: planId,
    p_status: status
  });
  if (error || !data?.[0]) return mapCanonicalPlanError(error, "Couldn't save your RSVP.");

  const result = data[0];
  const message = result.rsvp_status === "waitlisted"
    ? "This plan is full, you're on the waitlist."
    : status === "going"
      ? "You're going."
      : status === "maybe"
        ? "You marked this as Maybe."
        : "You marked this as Can't make it.";
  return {
    ok: true,
    message,
    conversationId: result.conversation_id,
    rsvpStatus: result.rsvp_status
  };
}

export async function addPlanParticipants(
  userId: string,
  planId: string,
  participantIds: string[]
): Promise<ServiceResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, code: "server_unavailable", message: envMessage };

  const parsed = addParticipantsSchema.safeParse({ planId, participantIds });
  if (!parsed.success) return { ok: false, code: "validation", message: "Choose at least one Muddy." };

  const rateLimit = await consumeRateLimit({ action: "plans.invite", userId });
  if (!rateLimit.allowed) {
    return { ok: false, code: "rate_limited", message: rateLimitMessage(rateLimit.resetAt) };
  }

  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId, surface: "plans" });
  if (!guard.allowed) return { ok: false, code: "not_authorized", message: guard.message };

  const access = await getCurrentSubscriptionAccess(userId);
  const limits = planTierLimitsFor(access.plan);
  const { data, error } = await admin.rpc("add_plan_participants", {
    p_actor_id: userId,
    p_plan_id: parsed.data.planId,
    p_participant_ids: [...new Set(parsed.data.participantIds)],
    p_effective_max_participants: toCanonicalParticipantLimit(limits.maxPlanParticipants)
  });
  if (error || !data?.[0]) return mapCanonicalPlanError(error, "Couldn't add those people.");

  return {
    ok: true,
    message:
      data[0].added_count > 0
        ? `Invited ${data[0].added_count} to the plan.`
        : "Those Muddies are already on the plan.",
    conversationId: data[0].conversation_id,
    addedCount: data[0].added_count
  };
}

export async function convertHangoutToPlan(
  userId: string,
  hangoutId: string,
  title?: string
): Promise<ServiceResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, code: "server_unavailable", message: envMessage };
  if (!uuidSchema.safeParse(hangoutId).success) {
    return { ok: false, code: "not_found", message: "UpFor not found." };
  }

  const rateLimit = await consumeRateLimit({ action: "plans.create", userId });
  if (!rateLimit.allowed) {
    return { ok: false, code: "rate_limited", message: rateLimitMessage(rateLimit.resetAt) };
  }

  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId, surface: "plans" });
  if (!guard.allowed) return { ok: false, code: "not_authorized", message: guard.message };

  const { data: session } = await admin
    .from("hangout_sessions")
    .select("activity_type, message, starts_at, ends_at, timezone, status")
    .eq("id", hangoutId)
    .maybeSingle();
  if (!session) return { ok: false, code: "not_found", message: "UpFor not found." };

  const access = await getCurrentSubscriptionAccess(userId);
  const limits = planTierLimitsFor(access.plan);
  const planTitle = (title?.trim() || `${session.activity_type} hangout`).slice(0, 80);
  const { data, error } = await admin.rpc("create_plan_lifecycle", {
    p_actor_id: userId,
    // A source UpFor can become exactly one Plan, so its UUID is the stable
    // retry key across tabs, devices and lost responses.
    p_request_key: hangoutId,
    p_title: planTitle,
    p_description: session.message,
    p_plan_type: "quick",
    /* A SCHEDULED UpFor keeps the start it was created for.

       Converting an 18:30 UpFor at 16:00 must produce a Plan that starts at
       18:30, not at the moment somebody pressed the button. The value comes
       from the session row this function already read server-side -- never
       from the caller -- so a client cannot post a start of its choosing
       through the conversion path.

       An UpFor that has ALREADY STARTED keeps the previous behaviour and
       passes null: its start is in the past, and a Plan dated in the past
       would be worse than one with no date at all. Existing semantics for a
       running UpFor are deliberately unchanged. */
    p_start_at: Date.parse(session.starts_at) > Date.now() ? session.starts_at : null,
    p_end_at: Date.parse(session.starts_at) > Date.now() ? session.ends_at : null,
    p_timezone: session.timezone || "UTC",
    p_rsvp_deadline: null,
    p_place_type: "decide_in_chat",
    p_custom_place_text: null,
    p_reminder_minutes: null,
    p_category: null,
    p_invitee_ids: [],
    p_initial_going_ids: [],
    p_source_hangout_id: hangoutId,
    p_effective_max_active_plans: toCanonicalPlanLimit(limits.maxActivePlans),
    p_effective_max_participants: toCanonicalParticipantLimit(limits.maxPlanParticipants)
  });
  if (error || !data?.[0]) return mapCanonicalPlanError(error, "Couldn't create the plan.");

  return {
    ok: true,
    message: "Plan created from your hangout.",
    planId: data[0].plan_id,
    conversationId: data[0].conversation_id,
    created: data[0].created
  };
}
