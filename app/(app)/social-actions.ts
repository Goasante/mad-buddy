"use server";

import { z } from "zod";
import { guardAction } from "@/lib/admin/enforcement";
import { createNotification } from "@/lib/notifications/server";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  ACTIVITY_TYPES,
  AVAILABILITY_TYPES,
  PING_MAX_MESSAGE_LENGTH,
  PING_MAX_PLACE_LENGTH,
  PING_TYPES,
  STATUS_MAX_TEXT_LENGTH,
  canTransitionPing,
  pingActorAllowed,
  pingExpiryMs,
  pingTypeLabels,
  responseTypeToStatus,
  validateStatusExpiry,
  wavePairCooldownRemaining
} from "@/lib/social/rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PingResponseType, PingStatus, WaveSource } from "@/lib/supabase/database.types";

export type SocialActionState = {
  ok: boolean;
  message: string;
};

const uuidSchema = z.string().uuid();

function missingEnvState(): SocialActionState | null {
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

/**
 * Shared relationship gate for every social interaction (spec: privacy
 * first). Confirms mutual friendship and the absence of blocks in either
 * direction — the client never decides eligibility.
 */
async function verifyMuddyRelationship(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  otherId: string
): Promise<"ok" | "not_muddies" | "error"> {
  const [friendshipResult, blockResult] = await Promise.all([
    admin
      .from("friendships")
      .select("user_one_id")
      .or(
        `and(user_one_id.eq.${userId},user_two_id.eq.${otherId}),and(user_one_id.eq.${otherId},user_two_id.eq.${userId})`
      )
      .limit(1),
    admin
      .from("blocked_users")
      .select("blocker_id")
      .or(
        `and(blocker_id.eq.${userId},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${userId})`
      )
      .limit(1)
  ]);

  if (friendshipResult.error || blockResult.error) return "error";
  if (!friendshipResult.data?.length || blockResult.data?.length) return "not_muddies";
  return "ok";
}

async function senderDisplayName(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
) {
  const { data } = await admin.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
  return data?.full_name?.trim() || "A Muddy";
}

// ---------------------------------------------------------------------------
// FEATURE 1: Muddy Status
// ---------------------------------------------------------------------------

const statusSchema = z.object({
  availabilityType: z.enum(AVAILABILITY_TYPES as [string, ...string[]]),
  activityType: z.enum(ACTIVITY_TYPES as [string, ...string[]]).nullable().optional(),
  customText: z.string().trim().max(STATUS_MAX_TEXT_LENGTH).optional(),
  expiresAt: z.string().datetime({ offset: true })
});

export async function setStatusAction(input: unknown): Promise<SocialActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check your status details and try again." };
  }

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before setting a status." };

  // Server time is the source of truth (spec §13).
  const now = Date.now();
  const expiresAtMs = Date.parse(parsed.data.expiresAt);
  const expiryError = validateStatusExpiry(expiresAtMs, now);
  if (expiryError) return { ok: false, message: expiryError };

  const rate = await consumeRateLimit({ action: "status.update", userId });
  if (!rate.allowed) return { ok: false, message: rateLimitMessage(rate.resetAt) };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("user_statuses").upsert(
    {
      user_id: userId,
      availability_type: parsed.data.availabilityType as never,
      activity_type: (parsed.data.activityType ?? null) as never,
      custom_text: parsed.data.customText || null,
      visibility_type: "all_muddies",
      starts_at: new Date(now).toISOString(),
      expires_at: new Date(expiresAtMs).toISOString(),
      updated_at: new Date(now).toISOString()
    },
    { onConflict: "user_id" }
  );

  if (error) {
    logBackendEvent("warn", { action: "status.set", userId, errorType: errorType(error) });
    return { ok: false, message: "Couldn't save your status. Try again." };
  }

  const until = new Date(expiresAtMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return { ok: true, message: `Status updated. Your Muddies can see it until ${until}.` };
}

export async function clearStatusAction(): Promise<SocialActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("user_statuses").delete().eq("user_id", userId);

  if (error) {
    return { ok: false, message: "Couldn't clear your status. Try again." };
  }
  return { ok: true, message: "Status cleared." };
}

// ---------------------------------------------------------------------------
// FEATURE 2: Wave (upgraded from notification-only to table-backed)
// ---------------------------------------------------------------------------

export async function sendWaveV2Action(
  targetUserId: string,
  source: WaveSource = "proximity_card"
): Promise<SocialActionState> {
  const requestId = createRequestId();
  const missing = missingEnvState();
  if (missing) return missing;

  const parsedTarget = uuidSchema.safeParse(targetUserId);
  if (!parsedTarget.success) return { ok: false, message: "Choose a Muddy before waving." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before waving." };
  if (userId === parsedTarget.data) return { ok: false, message: "You cannot wave at yourself." };

  const admin = createSupabaseAdminClient();
  const recipientId = parsedTarget.data;

  // A suspension blocks every outbound social surface (batch 13 §19).
  const guard = await guardAction(admin, { userId, surface: "waves" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  const relationship = await verifyMuddyRelationship(admin, userId, recipientId);
  if (relationship === "error") return { ok: false, message: "Couldn't send your wave. Try again." };
  if (relationship === "not_muddies") {
    return { ok: false, message: "You can only wave at approved Muddies." };
  }

  // Per-pair cooldown from the waves table (spec §20: 30 minutes).
  const { data: lastWave } = await admin
    .from("waves")
    .select("sent_at")
    .eq("sender_id", userId)
    .eq("recipient_id", recipientId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const cooldownRemaining = wavePairCooldownRemaining(
    lastWave ? Date.parse(lastWave.sent_at) : null,
    Date.now()
  );
  if (cooldownRemaining > 0) {
    return { ok: true, message: "You already waved recently. Give them a little time." };
  }

  // Global anti-spam windows (spec §20: 20/hour, 50/day).
  for (const action of ["waves.send", "waves.send.daily"] as const) {
    const rate = await consumeRateLimit({ action, userId, requestId });
    if (!rate.allowed) return { ok: false, message: rateLimitMessage(rate.resetAt) };
  }

  const { data: wave, error: waveError } = await admin
    .from("waves")
    .insert({ sender_id: userId, recipient_id: recipientId, source })
    .select("id")
    .single();

  if (waveError || !wave) {
    logBackendEvent("warn", { requestId, action: "wave.send", userId, errorType: errorType(waveError) });
    return { ok: false, message: "Your wave was not sent. Try again." };
  }

  // Mute silences notifications without telling the sender (spec §20):
  // the wave record exists either way; a muted recipient just isn't pinged.
  const { data: mute } = await admin
    .from("wave_mutes")
    .select("id")
    .eq("user_id", recipientId)
    .eq("muted_user_id", userId)
    .maybeSingle();

  if (!mute) {
    const name = await senderDisplayName(admin, userId);
    await createNotification(admin, {
      userId: recipientId,
      type: `wave:${userId}`,
      title: `${name} waved at you`,
      message: `${name} waved at you 👋 Wave back or send a Meet Ping.`
    });
  }

  logBackendEvent("info", { requestId, action: "wave.send", userId, statusCode: 200 });
  return { ok: true, message: "Wave sent 👋" };
}

export async function muteWavesFromAction(targetUserId: string, muted: boolean): Promise<SocialActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsedTarget = uuidSchema.safeParse(targetUserId);
  if (!parsedTarget.success) return { ok: false, message: "Choose a Muddy first." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();

  if (muted) {
    const { error } = await admin
      .from("wave_mutes")
      .upsert({ user_id: userId, muted_user_id: parsedTarget.data }, { onConflict: "user_id,muted_user_id" });
    if (error) return { ok: false, message: "Couldn't update wave settings." };
    return { ok: true, message: "You won't get wave notifications from this Muddy." };
  }

  const { error } = await admin
    .from("wave_mutes")
    .delete()
    .eq("user_id", userId)
    .eq("muted_user_id", parsedTarget.data);
  if (error) return { ok: false, message: "Couldn't update wave settings." };
  return { ok: true, message: "Wave notifications from this Muddy are back on." };
}

// ---------------------------------------------------------------------------
// FEATURE 3: Meeting Ping
// ---------------------------------------------------------------------------

const createPingSchema = z.object({
  recipientId: uuidSchema,
  pingType: z.enum(PING_TYPES as [string, ...string[]]),
  customMessage: z.string().trim().max(PING_MAX_MESSAGE_LENGTH).optional(),
  proposedTime: z.string().datetime({ offset: true }),
  placeType: z.enum(["custom", "chat"]).default("chat"),
  customPlaceText: z.string().trim().max(PING_MAX_PLACE_LENGTH).optional()
});

const MAX_ACTIVE_PINGS_PER_PAIR = 3;
const OPEN_PING_STATUSES: PingStatus[] = ["pending", "seen", "maybe", "counter_proposed"];

export async function createMeetingPingAction(input: unknown): Promise<SocialActionState> {
  const requestId = createRequestId();
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = createPingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check your ping details and try again." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before sending a Meet Ping." };
  if (userId === parsed.data.recipientId) {
    return { ok: false, message: "You cannot send a ping to yourself." };
  }

  const now = Date.now();
  const proposedMs = Date.parse(parsed.data.proposedTime);
  if (!Number.isFinite(proposedMs) || proposedMs < now - 60_000) {
    return { ok: false, message: "Choose a time that hasn't passed yet." };
  }
  if (proposedMs > now + 7 * 24 * 60 * 60 * 1000) {
    return { ok: false, message: "Pings can be at most a week ahead. For later, make a Plan." };
  }

  const admin = createSupabaseAdminClient();
  const recipientId = parsed.data.recipientId;

  const guard = await guardAction(admin, { userId, surface: "pings" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  const relationship = await verifyMuddyRelationship(admin, userId, recipientId);
  if (relationship === "error") return { ok: false, message: "Couldn't send your ping. Try again." };
  if (relationship === "not_muddies") {
    // Neutral wording — never reveals blocks or mutes (spec §41).
    return { ok: false, message: "You cannot send a Ping to this Muddy right now." };
  }

  const { count: activeCount } = await admin
    .from("meeting_pings")
    .select("id", { count: "exact", head: true })
    .eq("sender_id", userId)
    .eq("recipient_id", recipientId)
    .in("status", OPEN_PING_STATUSES);

  if ((activeCount ?? 0) >= MAX_ACTIVE_PINGS_PER_PAIR) {
    return { ok: false, message: "You already have open pings with this Muddy. Wait for a reply." };
  }

  for (const action of ["pings.create", "pings.create.daily"] as const) {
    const rate = await consumeRateLimit({ action, userId, requestId });
    if (!rate.allowed) return { ok: false, message: rateLimitMessage(rate.resetAt) };
  }

  const expiresAt = new Date(pingExpiryMs(proposedMs, now)).toISOString();
  const { error: insertError } = await admin.from("meeting_pings").insert({
    sender_id: userId,
    recipient_id: recipientId,
    ping_type: parsed.data.pingType as never,
    custom_message: parsed.data.customMessage || null,
    proposed_time: new Date(proposedMs).toISOString(),
    expires_at: expiresAt,
    place_type: parsed.data.placeType,
    custom_place_text: parsed.data.placeType === "custom" ? parsed.data.customPlaceText || null : null
  });

  if (insertError) {
    logBackendEvent("warn", { requestId, action: "ping.create", userId, errorType: errorType(insertError) });
    return { ok: false, message: "Couldn't send your ping. Try again." };
  }

  const name = await senderDisplayName(admin, userId);
  const label = pingTypeLabels[parsed.data.pingType as keyof typeof pingTypeLabels] ?? "Want to meet?";
  await createNotification(admin, {
    userId: recipientId,
    type: `meeting_ping:${userId}`,
    title: `${name} wants to meet`,
    message: `${name} sent a Meet Ping: ${label} Open Meeting Pings to reply.`
  });

  logBackendEvent("info", { requestId, action: "ping.create", userId, statusCode: 200 });
  return { ok: true, message: "Meet Ping sent. It expires automatically if there's no reply." };
}

const respondSchema = z.object({
  pingId: uuidSchema,
  responseType: z.enum(["accept", "maybe", "decline", "counter_propose"]),
  suggestedTime: z.string().datetime({ offset: true }).optional(),
  message: z.string().trim().max(PING_MAX_MESSAGE_LENGTH).optional()
});

export async function respondToPingAction(input: unknown): Promise<SocialActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = respondSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check your reply and try again." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: ping, error: pingError } = await admin
    .from("meeting_pings")
    .select("*")
    .eq("id", parsed.data.pingId)
    .maybeSingle();

  if (pingError || !ping) return { ok: false, message: "This ping is no longer available." };

  const actorIsSender = ping.sender_id === userId;
  const actorIsRecipient = ping.recipient_id === userId;
  if (!actorIsSender && !actorIsRecipient) {
    return { ok: false, message: "This ping is no longer available." };
  }

  // Lazy expiry — server time is the source of truth (spec §35).
  const now = Date.now();
  if (OPEN_PING_STATUSES.includes(ping.status) && Date.parse(ping.expires_at) <= now) {
    await admin
      .from("meeting_pings")
      .update({ status: "expired", updated_at: new Date(now).toISOString() })
      .eq("id", ping.id)
      .in("status", OPEN_PING_STATUSES);
    return { ok: false, message: "This ping has expired. You can send a new one." };
  }

  const nextStatus = responseTypeToStatus(parsed.data.responseType as PingResponseType);
  if (!nextStatus) return { ok: false, message: "Choose a valid reply." };

  // Actor authorization + accept-direction split (spec §36, §40):
  // recipient accepts an offer; only the sender accepts a counter-proposal.
  if (!pingActorAllowed({ transition: nextStatus, actorIsSender, actorIsRecipient })) {
    return { ok: false, message: "You can't do that on this ping." };
  }
  if (nextStatus === "accepted") {
    const senderMayAccept = ping.status === "counter_proposed" && actorIsSender;
    const recipientMayAccept = ping.status !== "counter_proposed" && actorIsRecipient;
    if (!senderMayAccept && !recipientMayAccept) {
      return { ok: false, message: "Waiting on the other person for this one." };
    }
  }
  if (!canTransitionPing(ping.status, nextStatus)) {
    return { ok: false, message: "This ping was already answered." };
  }
  if (nextStatus === "counter_proposed" && !parsed.data.suggestedTime) {
    return { ok: false, message: "Suggest a time with your counter-proposal." };
  }

  // Atomic guarded transition: the .in() filter means a concurrent duplicate
  // response finds zero rows and fails cleanly (spec §45).
  const { data: updated } = await admin
    .from("meeting_pings")
    .update({
      status: nextStatus,
      responded_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
      ...(nextStatus === "counter_proposed" && parsed.data.suggestedTime
        ? { proposed_time: parsed.data.suggestedTime }
        : {})
    })
    .eq("id", ping.id)
    .in("status", OPEN_PING_STATUSES)
    .select("id")
    .maybeSingle();

  if (!updated) {
    return { ok: false, message: "This ping was already answered." };
  }

  await admin.from("meeting_ping_responses").insert({
    ping_id: ping.id,
    responder_id: userId,
    response_type: parsed.data.responseType as never,
    suggested_time: parsed.data.suggestedTime ?? null,
    message: parsed.data.message || null
  });

  const otherUserId = actorIsSender ? ping.recipient_id : ping.sender_id;
  const name = await senderDisplayName(admin, userId);

  if (nextStatus === "accepted") {
    // temporary_plans.source_ping_id is UNIQUE: a duplicate accept can never
    // create a second plan even if two requests race past the state guard.
    const meetingTime = parsed.data.suggestedTime ?? ping.proposed_time;
    const title = pingTypeLabels[ping.ping_type] ?? "Meet up";
    await admin.from("temporary_plans").insert({
      source_ping_id: ping.id,
      creator_id: ping.sender_id,
      participant_id: ping.recipient_id,
      title,
      meeting_time: meetingTime,
      place_text: ping.custom_place_text,
      expires_at: new Date(Date.parse(meetingTime) + 6 * 60 * 60 * 1000).toISOString()
    });
    await createNotification(admin, {
      userId: otherUserId,
      type: `meeting_ping:${userId}`,
      title: `${name} accepted your Meet Ping`,
      message: `You're on! Check Meeting Pings for the plan details.`
    });
    return { ok: true, message: "Accepted! A plan card has been created for both of you." };
  }

  if (nextStatus === "maybe") {
    await createNotification(admin, {
      userId: otherUserId,
      type: `meeting_ping:${userId}`,
      title: `${name} may be available`,
      message: `${name} said maybe. You can suggest a time or wait.`
    });
    return { ok: true, message: "Reply sent — they'll know you might make it." };
  }

  if (nextStatus === "counter_proposed") {
    await createNotification(admin, {
      userId: otherUserId,
      type: `meeting_ping:${userId}`,
      title: `${name} suggested another time`,
      message: `${name} proposed a different time. Open Meeting Pings to accept or decline.`
    });
    return { ok: true, message: "Suggestion sent." };
  }

  // Declines stay gentle and reason-free (spec §34).
  await createNotification(admin, {
    userId: otherUserId,
    type: `meeting_ping:${userId}`,
    title: `${name} can't meet right now`,
    message: `No worries — maybe another time.`
  });
  return { ok: true, message: "No pressure — they've been let know politely." };
}

export async function cancelPingAction(pingId: string): Promise<SocialActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsedId = uuidSchema.safeParse(pingId);
  if (!parsedId.success) return { ok: false, message: "This ping is no longer available." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: ping } = await admin
    .from("meeting_pings")
    .select("id, sender_id, recipient_id, status, seen_at")
    .eq("id", parsedId.data)
    .maybeSingle();

  // Only the sender may cancel (spec §37).
  if (!ping || ping.sender_id !== userId) {
    return { ok: false, message: "This ping is no longer available." };
  }
  if (!canTransitionPing(ping.status, "cancelled")) {
    return { ok: false, message: "This ping was already answered." };
  }

  const { data: updated } = await admin
    .from("meeting_pings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", ping.id)
    .in("status", OPEN_PING_STATUSES)
    .select("id")
    .maybeSingle();

  if (!updated) return { ok: false, message: "This ping was already answered." };

  // Notify only if the recipient had already seen it (spec §37).
  if (ping.seen_at) {
    await createNotification(admin, {
      userId: ping.recipient_id,
      type: `meeting_ping:${userId}`,
      title: "A Meet Ping was cancelled",
      message: "That Meet Ping is no longer active."
    });
  }

  return { ok: true, message: "Ping cancelled." };
}

export async function markPingSeenAction(pingId: string): Promise<SocialActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsedId = uuidSchema.safeParse(pingId);
  if (!parsedId.success) return { ok: false, message: "Not available." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  // Best-effort; recipient only; pending -> seen only.
  await admin
    .from("meeting_pings")
    .update({ status: "seen", seen_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", parsedId.data)
    .eq("recipient_id", userId)
    .eq("status", "pending");

  return { ok: true, message: "" };
}
