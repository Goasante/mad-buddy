"use server";

import { z } from "zod";
import { upgradePromptFor } from "@/lib/billing/entitlements";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { deliverNotification } from "@/lib/notifications/server";
import {
  areApprovedMuddies,
  isBlockedEitherDirection,
  isCloseFriend,
  viewerCircleIds
} from "@/lib/social/permissions";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  canTransitionHangout,
  isHangoutJoinable,
  planTierLimitsFor,
  validateHangoutDuration
} from "@/lib/social/plans";
import { activeHangoutCount } from "@/lib/social/planning";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { HangoutActivityType, HangoutAudienceType } from "@/lib/supabase/database.types";

export type HangoutActionState = {
  ok: boolean;
  message: string;
  hangoutId?: string;
  planId?: string;
};

const uuidSchema = z.string().uuid();
type Admin = ReturnType<typeof createSupabaseAdminClient>;

function missingEnvState(): HangoutActionState | null {
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

async function displayName(admin: Admin, userId: string) {
  const { data } = await admin.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
  return data?.full_name?.trim() || "A Muddy";
}

/**
 * Server-side eligibility for viewing/joining a hangout session (spec §52).
 * Privacy-critical: block > not-muddies > Ghost Mode > audience narrowing.
 * Ghost Mode ends hangout visibility (recommended default), regardless of
 * audience. Never trusts the client's claim of eligibility.
 */
async function canViewHangout(
  admin: Admin,
  viewerId: string,
  session: {
    id: string;
    owner_id: string;
    audience_type: HangoutAudienceType;
  }
): Promise<boolean> {
  if (viewerId === session.owner_id) return true;

  const [mutual, blocked] = await Promise.all([
    areApprovedMuddies(admin, session.owner_id, viewerId),
    isBlockedEitherDirection(admin, session.owner_id, viewerId)
  ]);
  if (!mutual || blocked) return false;

  const { data: profile } = await admin
    .from("profiles")
    .select("visibility_status")
    .eq("user_id", session.owner_id)
    .maybeSingle();
  if (profile?.visibility_status === "ghost") return false;

  switch (session.audience_type) {
    case "all_muddies":
      return true;
    case "close_friends":
      return isCloseFriend(admin, session.owner_id, viewerId);
    case "selected_circles": {
      const circles = await viewerCircleIds(admin, session.owner_id, viewerId);
      if (circles.size === 0) return false;
      const { data: targets } = await admin
        .from("hangout_audience_targets")
        .select("target_id")
        .eq("hangout_session_id", session.id)
        .eq("target_type", "circle");
      return (targets ?? []).some((target) => circles.has(target.target_id));
    }
    case "selected_muddies": {
      const { data: target } = await admin
        .from("hangout_audience_targets")
        .select("id")
        .eq("hangout_session_id", session.id)
        .eq("target_type", "user")
        .eq("target_id", viewerId)
        .maybeSingle();
      return Boolean(target);
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Start / end a session (spec §47, §51, §55)
// ---------------------------------------------------------------------------

const startHangoutSchema = z.object({
  activityType: z.enum(["food", "study", "sports", "gym", "walk", "gaming", "chill", "anything"]),
  message: z.string().max(140).optional(),
  audienceType: z.enum(["all_muddies", "close_friends", "selected_circles", "selected_muddies"]),
  broadAreaText: z.string().max(80).optional(),
  endsAt: z.string().datetime({ offset: true }),
  maxParticipants: z.number().int().min(1).max(50).optional(),
  allowPings: z.boolean().optional(),
  allowFriendInvites: z.boolean().optional(),
  circleIds: z.array(uuidSchema).max(50).optional(),
  muddyIds: z.array(uuidSchema).max(50).optional()
});

export async function startHangoutAction(input: unknown): Promise<HangoutActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = startHangoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the hangout details and try again." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const nowMs = Date.now();
  const endsMs = Date.parse(parsed.data.endsAt);
  const durationError = validateHangoutDuration(nowMs, endsMs);
  if (durationError) return { ok: false, message: durationError };

  const rateLimit = await consumeRateLimit({ action: "hangouts.start", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const access = await getCurrentSubscriptionAccess(userId);
  const limits = planTierLimitsFor(access.plan);

  if ((await activeHangoutCount(admin, userId)) >= limits.maxActiveHangouts) {
    return { ok: false, message: `You can have up to ${limits.maxActiveHangouts} active hangouts at once.` };
  }

  const requestedCapacity = parsed.data.maxParticipants ?? Math.min(5, limits.maxHangoutCapacity);
  if (requestedCapacity > limits.maxHangoutCapacity) {
    return {
      ok: false,
      message:
        upgradePromptFor("max_hangout_capacity", access.plan) ??
        `Hangouts allow up to ${limits.maxHangoutCapacity} people on your plan.`
    };
  }

  const { data: session, error } = await admin
    .from("hangout_sessions")
    .insert({
      owner_id: userId,
      activity_type: parsed.data.activityType as HangoutActivityType,
      message: parsed.data.message?.trim() || null,
      audience_type: parsed.data.audienceType as HangoutAudienceType,
      broad_area_text: parsed.data.broadAreaText?.trim() || null,
      ends_at: parsed.data.endsAt,
      max_participants: requestedCapacity,
      allow_pings: parsed.data.allowPings ?? true,
      allow_friend_invites: parsed.data.allowFriendInvites ?? false,
      status: "active"
    })
    .select("id")
    .single();
  if (error || !session) return { ok: false, message: "Couldn't start Hangout Mode." };

  // Audience targets for narrowed audiences (owned circles / eligible muddies).
  if (parsed.data.audienceType === "selected_circles" && parsed.data.circleIds?.length) {
    const { data: ownedCircles } = await admin
      .from("friend_circles")
      .select("id")
      .eq("user_id", userId)
      .is("archived_at", null)
      .in("id", parsed.data.circleIds);
    const rows = (ownedCircles ?? []).map((circle) => ({
      hangout_session_id: session.id,
      target_type: "circle" as const,
      target_id: circle.id
    }));
    if (rows.length > 0) await admin.from("hangout_audience_targets").insert(rows);
  } else if (parsed.data.audienceType === "selected_muddies" && parsed.data.muddyIds?.length) {
    const eligible: string[] = [];
    for (const muddyId of [...new Set(parsed.data.muddyIds)]) {
      const [mutual, blocked] = await Promise.all([
        areApprovedMuddies(admin, userId, muddyId),
        isBlockedEitherDirection(admin, userId, muddyId)
      ]);
      if (mutual && !blocked) eligible.push(muddyId);
    }
    if (eligible.length > 0) {
      await admin.from("hangout_audience_targets").insert(
        eligible.map((muddyId) => ({
          hangout_session_id: session.id,
          target_type: "user" as const,
          target_id: muddyId
        }))
      );
    }
  }

  return { ok: true, message: "You're open to hang out.", hangoutId: session.id };
}

export async function endHangoutAction(hangoutId: string): Promise<HangoutActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(hangoutId).success) return { ok: false, message: "Hangout not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: session } = await admin
    .from("hangout_sessions")
    .select("status, owner_id")
    .eq("id", hangoutId)
    .maybeSingle();
  if (!session) return { ok: false, message: "Hangout not found." };
  if (session.owner_id !== userId) return { ok: false, message: "This isn't your hangout." };
  if (!canTransitionHangout(session.status, "cancelled")) {
    return { ok: false, message: "This hangout is already over." };
  }

  await admin
    .from("hangout_sessions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", hangoutId)
    .eq("owner_id", userId);
  return { ok: true, message: "Hangout ended." };
}

// ---------------------------------------------------------------------------
// Discovery feed (spec §49) — hangouts the viewer may see and ask to join.
// ---------------------------------------------------------------------------

export type VisibleHangout = {
  id: string;
  ownerName: string;
  activityType: HangoutActivityType;
  message: string | null;
  broadAreaText: string | null;
  endsAt: string;
  allowPings: boolean;
  myRequestStatus: string | null;
};

/**
 * Active hangouts from the viewer's Muddies, filtered through the same
 * server-side eligibility as everything else (block > not-muddies > Ghost
 * Mode > audience narrowing). Broad area text only — never location.
 */
export async function getVisibleHangoutsAction(): Promise<VisibleHangout[]> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return [];
  const userId = await getAuthedUserId();
  if (!userId) return [];

  const admin = createSupabaseAdminClient();
  const { data: friendships } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    .is("ended_at", null);
  const friendIds = (friendships ?? []).map((row) =>
    row.user_one_id === userId ? row.user_two_id : row.user_one_id
  );
  if (friendIds.length === 0) return [];

  const { data: sessions } = await admin
    .from("hangout_sessions")
    .select("id, owner_id, activity_type, message, broad_area_text, ends_at, allow_pings, audience_type, status")
    .in("owner_id", friendIds)
    .eq("status", "active")
    .gt("ends_at", new Date().toISOString())
    .order("ends_at", { ascending: true })
    .limit(50);
  if (!sessions?.length) return [];

  const visible: typeof sessions = [];
  for (const session of sessions) {
    if (await canViewHangout(admin, userId, session)) visible.push(session);
  }
  if (visible.length === 0) return [];

  const [{ data: owners }, { data: myRequests }] = await Promise.all([
    admin
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", [...new Set(visible.map((session) => session.owner_id))]),
    admin
      .from("hangout_requests")
      .select("hangout_session_id, status")
      .eq("requester_id", userId)
      .in(
        "hangout_session_id",
        visible.map((session) => session.id)
      )
  ]);
  const nameById = new Map((owners ?? []).map((row) => [row.user_id, row.full_name]));
  const requestBySession = new Map((myRequests ?? []).map((row) => [row.hangout_session_id, row.status]));

  return visible.map((session) => ({
    id: session.id,
    ownerName: nameById.get(session.owner_id)?.trim() || "A Muddy",
    activityType: session.activity_type,
    message: session.message,
    broadAreaText: session.broad_area_text,
    endsAt: session.ends_at,
    allowPings: session.allow_pings,
    myRequestStatus: requestBySession.get(session.id) ?? null
  }));
}

// ---------------------------------------------------------------------------
// Join requests (spec §49, §55, §56)
// ---------------------------------------------------------------------------

export async function requestHangoutAction(
  hangoutId: string,
  message?: string
): Promise<HangoutActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(hangoutId).success) return { ok: false, message: "Hangout not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: session } = await admin
    .from("hangout_sessions")
    .select("id, owner_id, audience_type, status, ends_at, max_participants, allow_pings")
    .eq("id", hangoutId)
    .maybeSingle();
  if (!session) return { ok: false, message: "Hangout not found." };
  if (session.owner_id === userId) return { ok: false, message: "This is your own hangout." };
  if (!isHangoutJoinable(session.status, Date.parse(session.ends_at), Date.now())) {
    return { ok: false, message: "This hangout is no longer open." };
  }
  if (!session.allow_pings) return { ok: false, message: "The host isn't taking requests right now." };

  // Privacy gate — server decides, never the client.
  if (!(await canViewHangout(admin, userId, session))) {
    return { ok: false, message: "This hangout isn't open to you." };
  }

  const rateLimit = await consumeRateLimit({ action: "hangouts.request", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  // Capacity: accepted requests must be below the cap (spec §51).
  const { count: acceptedCount } = await admin
    .from("hangout_requests")
    .select("id", { count: "exact", head: true })
    .eq("hangout_session_id", hangoutId)
    .eq("status", "accepted");
  if ((acceptedCount ?? 0) >= session.max_participants) {
    return { ok: false, message: "This hangout is full." };
  }

  const { error } = await admin.from("hangout_requests").upsert(
    {
      hangout_session_id: hangoutId,
      requester_id: userId,
      status: "pending",
      message: message?.trim() || null
    },
    { onConflict: "hangout_session_id,requester_id" }
  );
  if (error) return { ok: false, message: "Couldn't send your request." };

  const name = await displayName(admin, userId);
  await deliverNotification(admin, {
    userId: session.owner_id,
    senderId: userId,
    category: "plans",
    type: `hangout:request`,
    title: "Someone wants to join",
    message: `${name} is interested in your hangout.`
  });
  return { ok: true, message: "Request sent." };
}

const respondSchema = z.enum(["accepted", "maybe", "declined"]);

export async function respondHangoutRequestAction(
  requestId: string,
  response: string
): Promise<HangoutActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(requestId).success) return { ok: false, message: "Request not found." };

  const parsedResponse = respondSchema.safeParse(response);
  if (!parsedResponse.success) return { ok: false, message: "Choose accept, maybe, or decline." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: request } = await admin
    .from("hangout_requests")
    .select("id, hangout_session_id, requester_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { ok: false, message: "Request not found." };

  const { data: session } = await admin
    .from("hangout_sessions")
    .select("owner_id, max_participants")
    .eq("id", request.hangout_session_id)
    .maybeSingle();
  if (!session) return { ok: false, message: "Hangout not found." };
  if (session.owner_id !== userId) return { ok: false, message: "Only the host can respond." };

  // Enforce capacity at the moment of acceptance (spec §56 concurrency).
  if (parsedResponse.data === "accepted") {
    const { count: acceptedCount } = await admin
      .from("hangout_requests")
      .select("id", { count: "exact", head: true })
      .eq("hangout_session_id", request.hangout_session_id)
      .eq("status", "accepted");
    if ((acceptedCount ?? 0) >= session.max_participants) {
      return { ok: false, message: "This hangout is already full." };
    }
  }

  const { error } = await admin
    .from("hangout_requests")
    .update({ status: parsedResponse.data, responded_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending");
  if (error) return { ok: false, message: "Couldn't respond to the request." };

  await deliverNotification(admin, {
    userId: request.requester_id,
    senderId: userId,
    category: "plans",
    type: `hangout:response`,
    title: "Hangout update",
    message:
      parsedResponse.data === "accepted"
        ? "You're in — the host accepted your request."
        : parsedResponse.data === "maybe"
          ? "The host marked your request as Maybe."
          : "The host can't make this one."
  });
  return { ok: true, message: "Response sent." };
}

// ---------------------------------------------------------------------------
// Convert to plan (spec §49 accept → §54 convert-to-plan)
// ---------------------------------------------------------------------------

export async function convertHangoutToPlanAction(
  hangoutId: string,
  title?: string
): Promise<HangoutActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(hangoutId).success) return { ok: false, message: "Hangout not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: session } = await admin
    .from("hangout_sessions")
    .select("id, owner_id, status, activity_type, message, converted_plan_id")
    .eq("id", hangoutId)
    .maybeSingle();
  if (!session) return { ok: false, message: "Hangout not found." };
  if (session.owner_id !== userId) return { ok: false, message: "This isn't your hangout." };
  if (session.converted_plan_id) {
    return { ok: false, message: "This hangout already became a plan." };
  }
  if (!canTransitionHangout(session.status, "converted_to_plan")) {
    return { ok: false, message: "This hangout can't be turned into a plan." };
  }

  const { data: accepted } = await admin
    .from("hangout_requests")
    .select("requester_id")
    .eq("hangout_session_id", hangoutId)
    .eq("status", "accepted");
  const participantIds = (accepted ?? []).map((request) => request.requester_id);

  const planTitle = (title?.trim() || `${session.activity_type} hangout`).slice(0, 80);
  const { data: plan, error } = await admin
    .from("plans")
    .insert({
      creator_id: userId,
      title: planTitle,
      description: session.message,
      plan_type: "quick",
      status: "inviting",
      place_type: "decide_in_chat",
      max_participants: 10,
      source_hangout_id: hangoutId
    })
    .select("id")
    .single();
  if (error || !plan) return { ok: false, message: "Couldn't create the plan." };

  const rows = [
    { plan_id: plan.id, user_id: userId, role: "host" as const, rsvp_status: "going" as const },
    ...participantIds.map((participantId) => ({
      plan_id: plan.id,
      user_id: participantId,
      role: "participant" as const,
      rsvp_status: "going" as const,
      invited_by: userId
    }))
  ];
  await admin.from("plan_participants").insert(rows);

  await admin
    .from("hangout_sessions")
    .update({
      status: "converted_to_plan",
      converted_plan_id: plan.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", hangoutId)
    .eq("owner_id", userId);

  const name = await displayName(admin, userId);
  await Promise.all(
    participantIds.map((participantId) =>
      deliverNotification(admin, {
        userId: participantId,
        senderId: userId,
        category: "plans",
        type: `plan:created`,
        title: "Your hangout became a plan",
        message: `${name} created "${planTitle}".`
      })
    )
  );

  return { ok: true, message: "Plan created from your hangout.", planId: plan.id };
}
