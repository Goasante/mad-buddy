import "server-only";

import { z } from "zod";
import { recordProductEvent } from "@/lib/analytics/track";
import { deliverNotification } from "@/lib/notifications/server";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  eligibleTrustedContacts,
  loadSafeArrivalJourneys,
  loadSafeArrivalWatcherOptions,
  recordSafeArrivalEvent,
  type SafeArrivalJourney
} from "@/lib/safety/safe-arrival-service";
import {
  canTransitionSafeArrival,
  canTravellerAct,
  safeArrivalLimitsFor,
  safeArrivalNotification,
  validateContactCount,
  validateDestinationLabel,
  validateExpectedArrival,
  validateGracePeriod
} from "@/lib/safety/safe-arrival";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

/**
 * Mobile Safe Arrival v1: list active journeys (mine + ones I watch), start a
 * journey, confirm arrival, cancel. Isolated from the web safe-arrival-actions
 * (extend / acknowledge / mute stay web-only) so the tested feature is
 * untouched; all rules/limits come from the shared lib.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type SafeArrivalContactOption = { id: string; name: string; isCloseFriend: boolean };

export type SafeArrivalSessionSummary = {
  id: string;
  destinationLabel: string;
  expectedArrivalAt: string;
  gracePeriodMinutes: number;
  note: string | null;
  status: string;
  travellerName: string;
  isTraveller: boolean;
  myAcknowledgement: "pending" | "watching" | "declined" | null;
  startedAt: string;
  /** Contacts who ACCEPTED, and are therefore actually checking in. */
  watchers: Array<{ id: string; name: string; avatarUrl: string | null }>;
  /** Accepted count. Never the invite count: an invite is not cover. */
  sharedCount: number;
  /** Invited but unanswered, so a client can show "2 confirmed · 1 awaiting". */
  invitedCount: number;
};

export type SafeArrivalData = {
  mySessions: SafeArrivalSessionSummary[];
  watching: SafeArrivalSessionSummary[];
  contacts: SafeArrivalContactOption[];
};

export type SafeArrivalResult = { ok: boolean; message: string; sessionId?: string };

const uuidSchema = z.string().uuid();

const createSchema = z.object({
  destinationLabel: z.string(),
  expectedArrivalAt: z.string().datetime({ offset: true }),
  gracePeriodMinutes: z.number().int(),
  note: z.string().max(200).optional(),
  // Highest any plan allows; the caller's real plan limit is enforced below. A
  // hardcoded 5 here silently capped Buddy Pro at the Plus allowance.
  contactIds: z.array(uuidSchema).min(1).max(50)
});

function serviceRoleEnvMessage(): string | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return "This action needs the server database configuration.";
  }
  return null;
}

function hasServiceRoleEnv(): boolean {
  return serviceRoleEnvMessage() === null;
}

async function travellerName(admin: Admin, userId: string) {
  const { data } = await admin.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
  return data?.full_name?.trim() || "A Muddy";
}

/**
 * `type` is always `safe_arrival:<sessionId>` — that is what the notification
 * destination resolver turns into /safe-arrival?session=<id>. It is derived here
 * rather than passed in, because callers previously supplied labels like
 * "safe_arrival:arrived" that would have resolved only to the feature root.
 */
async function notifyContacts(admin: Admin, sessionId: string, notification: { title: string; message: string }) {
  const { data: contacts } = await admin
    .from("safe_arrival_contacts")
    .select("contact_user_id")
    .eq("session_id", sessionId)
    .neq("acknowledgement_status", "declined");
  await Promise.all(
    (contacts ?? []).map((contact) =>
      deliverNotification(admin, {
        userId: contact.contact_user_id,
        priority: "critical",
        type: `safe_arrival:${sessionId}`,
        title: notification.title,
        message: notification.message
      })
    )
  );
}

/**
 * Maps the canonical journey onto the wire shape the bundled mobile SPA already
 * consumes (`mySessions` / `watching` / `contacts`). The shape is preserved
 * deliberately — changing it would break the shipped client — but the DATA now
 * comes from the same loader the web route uses, so the two surfaces can no
 * longer disagree about who is watching a journey.
 */
function toSummary(journey: SafeArrivalJourney): SafeArrivalSessionSummary {
  return {
    id: journey.id,
    destinationLabel: journey.destinationLabel,
    expectedArrivalAt: journey.expectedArrivalAt,
    gracePeriodMinutes: journey.gracePeriodMinutes,
    note: journey.note,
    status: journey.status,
    travellerName: journey.travellerName,
    isTraveller: journey.isTraveller,
    // The wire contract predates the product vocabulary: it calls an unanswered
    // invite "pending" and an acceptance "watching". Mapped here so the shipped
    // client keeps working while the rest of the app uses invited/accepted.
    myAcknowledgement:
      journey.myAcknowledgement === "invited"
        ? "pending"
        : journey.myAcknowledgement === "accepted"
          ? "watching"
          : journey.myAcknowledgement,
    startedAt: journey.startedAt,
    // ACCEPTED only. An invitation is not somebody checking in on you, and
    // counting one as the other is what made three invites with two acceptances
    // report three people. Anonymous contacts are excluded: they carry no
    // identity to send, and the counts below already describe them.
    watchers: journey.contacts
      .filter((contact) => contact.state === "accepted" && contact.id !== null)
      .map((contact) => ({ id: contact.id as string, name: contact.name ?? "A Muddy", avatarUrl: contact.avatarUrl })),
    sharedCount: journey.acceptedCount,
    invitedCount: journey.invitedCount
  };
}

export async function loadSafeArrival(userId: string): Promise<SafeArrivalData> {
  if (!hasServiceRoleEnv()) return { mySessions: [], watching: [], contacts: [] };
  const admin = createSupabaseAdminClient();

  const [journeys, options] = await Promise.all([
    loadSafeArrivalJourneys(admin, userId),
    loadSafeArrivalWatcherOptions(admin, userId)
  ]);

  return {
    mySessions: journeys.travelling.map(toSummary),
    watching: journeys.checkingOn.map(toSummary),
    contacts: options.map((option) => ({
      id: option.id,
      name: option.name,
      isCloseFriend: option.isCloseFriend
    }))
  };
}


export async function createSafeArrival(userId: string, input: unknown): Promise<SafeArrivalResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the Safe Arrival details and try again." };

  const labelError = validateDestinationLabel(parsed.data.destinationLabel);
  if (labelError) return { ok: false, message: labelError };

  const nowMs = Date.now();
  const expectedMs = Date.parse(parsed.data.expectedArrivalAt);
  const timeError = validateExpectedArrival(expectedMs, nowMs);
  if (timeError) return { ok: false, message: timeError };

  const graceError = validateGracePeriod(parsed.data.gracePeriodMinutes);
  if (graceError) return { ok: false, message: graceError };

  const rateLimit = await consumeRateLimit({ action: "safe_arrival.create", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const access = await getCurrentSubscriptionAccess(userId);
  const limits = safeArrivalLimitsFor(access.plan);

  const countError = validateContactCount(parsed.data.contactIds.length, access.plan);
  if (countError) return { ok: false, message: countError };

  const contacts = await eligibleTrustedContacts(admin, userId, parsed.data.contactIds);
  if (contacts.length === 0) {
    return { ok: false, message: "Choose approved Muddies to watch over your journey." };
  }

  // Same atomic RPC the web action uses: journey + watchers + audit event in one
  // transaction, with a replayed id for a duplicate submit. The active-journey
  // cap is checked inside that transaction rather than read-then-written.
  const { data: sessionId, error } = await admin.rpc("start_safe_arrival", {
    p_traveller_id: userId,
    p_destination_label: parsed.data.destinationLabel.trim(),
    p_expected_arrival_at: new Date(expectedMs).toISOString(),
    p_grace_period_minutes: parsed.data.gracePeriodMinutes,
    p_note: parsed.data.note?.trim() || null,
    p_contact_ids: contacts,
    p_max_active: limits.maxActiveSessions
  });

  if (error || !sessionId) {
    if (error?.message?.includes("safe_arrival_active_limit")) {
      return {
        ok: false,
        message: `You can have up to ${limits.maxActiveSessions} Safe Arrival journeys at once.`
      };
    }
    return { ok: false, message: "Couldn't start Safe Arrival. Try again." };
  }

  const name = await travellerName(admin, userId);
  await notifyContacts(
    admin,
    sessionId,
    safeArrivalNotification("started", {
      travellerName: name,
      destinationLabel: parsed.data.destinationLabel.trim(),
      timeLabel: new Date(expectedMs).toLocaleTimeString("en-GB", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: DEFAULT_RECIPIENT_TIMEZONE
      })
    })
  );

  await recordProductEvent(admin, {
    eventName: "safe_arrival_started",
    actorId: userId,
    resourceType: "safe_arrival_session",
    resourceId: sessionId,
    featureKey: "safe_arrival"
  });

  return { ok: true, message: "Safe Arrival started.", sessionId };
}

export async function confirmSafeArrival(userId: string, sessionId: string): Promise<SafeArrivalResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };
  if (!uuidSchema.safeParse(sessionId).success) return { ok: false, message: "Session not found." };

  const admin = createSupabaseAdminClient();
  const { data: session } = await admin
    .from("safe_arrival_sessions")
    .select("id, traveller_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { ok: false, message: "Session not found." };
  if (session.traveller_id !== userId) return { ok: false, message: "Only the traveller can confirm arrival." };
  if (!canTravellerAct(session.status)) return { ok: false, message: "This session is already closed." };
  if (!canTransitionSafeArrival(session.status, "completed")) {
    return { ok: false, message: "This session can't be confirmed." };
  }

  const { data: updated } = await admin
    .from("safe_arrival_sessions")
    .update({ status: "completed", confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("traveller_id", userId)
    .in("status", ["active", "grace_period", "extended", "unconfirmed"])
    .select("id");

  if (!updated?.length) return { ok: true, message: "You're marked as arrived." };

  await recordSafeArrivalEvent(admin, { sessionId, eventType: "confirmed", createdBy: userId });
  {
    const { grantSafeTravellerAchievements } = await import("@/lib/engagement/achievements");
    await grantSafeTravellerAchievements(admin, userId);
  }
  const name = await travellerName(admin, userId);
  await notifyContacts(admin, sessionId, safeArrivalNotification("arrived", { travellerName: name }));

  await recordProductEvent(admin, {
    eventName: "safe_arrival_completed",
    actorId: userId,
    resourceType: "safe_arrival_session",
    resourceId: sessionId,
    featureKey: "safe_arrival"
  });

  return { ok: true, message: "You're marked as arrived. Your contacts know." };
}

export async function cancelSafeArrival(userId: string, sessionId: string): Promise<SafeArrivalResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };
  if (!uuidSchema.safeParse(sessionId).success) return { ok: false, message: "Session not found." };

  const admin = createSupabaseAdminClient();
  const { data: session } = await admin
    .from("safe_arrival_sessions")
    .select("id, traveller_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { ok: false, message: "Session not found." };
  if (session.traveller_id !== userId) return { ok: false, message: "Only the traveller can cancel." };
  if (!canTransitionSafeArrival(session.status, "cancelled")) {
    return { ok: false, message: "This session is already closed." };
  }

  const { data: cancelled } = await admin
    .from("safe_arrival_sessions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("traveller_id", userId)
    .in("status", ["draft", "pending_acknowledgement", "active", "grace_period", "extended", "unconfirmed"])
    .select("id");

  await recordSafeArrivalEvent(admin, { sessionId, eventType: "cancelled", createdBy: userId });

  // Watchers must know they can stand down (idempotent — a duplicate cancel
  // updates no row and sends nothing).
  if (cancelled?.length) {
    const name = await travellerName(admin, userId);
    await notifyContacts(admin, sessionId, safeArrivalNotification("cancelled", { travellerName: name }));
  }

  return { ok: true, message: "Safe Arrival cancelled." };
}
