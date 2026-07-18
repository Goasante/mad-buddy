"use server";

import { z } from "zod";
import { deliverNotification } from "@/lib/notifications/server";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  activeSafeArrivalCount,
  eligibleTrustedContacts,
  recordSafeArrivalEvent,
  resolveSafeArrivalAccess
} from "@/lib/safety/safe-arrival-service";
import {
  arrivedMessage,
  canTransitionSafeArrival,
  canTravellerAct,
  extendedArrivalMs,
  extendedMessage,
  safeArrivalLimitsFor,
  validateContactCount,
  validateDestinationLabel,
  validateExpectedArrival,
  validateExtension,
  validateGracePeriod
} from "@/lib/safety/safe-arrival";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SafeArrivalActionState = {
  ok: boolean;
  message: string;
  sessionId?: string;
};

const uuidSchema = z.string().uuid();
type Admin = ReturnType<typeof createSupabaseAdminClient>;

function missingEnvState(): SafeArrivalActionState | null {
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

async function travellerName(admin: Admin, userId: string) {
  const { data } = await admin.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
  return data?.full_name?.trim() || "A Muddy";
}

async function notifyContacts(
  admin: Admin,
  sessionId: string,
  notification: { title: string; message: string; type: `safe_arrival:${string}` }
) {
  const { data: contacts } = await admin
    .from("safe_arrival_contacts")
    .select("contact_user_id")
    .eq("session_id", sessionId)
    .neq("acknowledgement_status", "declined");
  await Promise.all(
    (contacts ?? []).map((contact) =>
      // Safety notifications are critical: they bypass category prefs, quiet
      // hours, Exam Mode, and the daily budget by design.
      deliverNotification(admin, {
        userId: contact.contact_user_id,
        priority: "critical",
        type: notification.type,
        title: notification.title,
        message: notification.message
      })
    )
  );
}

// ---------------------------------------------------------------------------
// Create (spec §5, §14)
// ---------------------------------------------------------------------------

const createSchema = z.object({
  destinationLabel: z.string(),
  expectedArrivalAt: z.string().datetime({ offset: true }),
  gracePeriodMinutes: z.number().int(),
  note: z.string().max(200).optional(),
  contactIds: z.array(uuidSchema).min(1).max(5)
});

export async function createSafeArrivalAction(input: unknown): Promise<SafeArrivalActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

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

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before starting Safe Arrival." };

  const rateLimit = await consumeRateLimit({ action: "safe_arrival.create", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const access = await getCurrentSubscriptionAccess(userId);
  const limits = safeArrivalLimitsFor(access.plan);

  const countError = validateContactCount(parsed.data.contactIds.length, access.plan);
  if (countError) return { ok: false, message: countError };

  if ((await activeSafeArrivalCount(admin, userId)) >= limits.maxActiveSessions) {
    return { ok: false, message: `You can have up to ${limits.maxActiveSessions} Safe Arrival sessions at once.` };
  }

  // Server decides eligibility; a silently opted-out contact is just dropped.
  const contacts = await eligibleTrustedContacts(admin, userId, parsed.data.contactIds);
  if (contacts.length === 0) {
    return { ok: false, message: "Choose approved Muddies as your trusted contacts." };
  }

  const { data: session, error } = await admin
    .from("safe_arrival_sessions")
    .insert({
      traveller_id: userId,
      destination_type: "custom",
      destination_label: parsed.data.destinationLabel.trim(),
      expected_arrival_at: parsed.data.expectedArrivalAt,
      grace_period_minutes: parsed.data.gracePeriodMinutes,
      note: parsed.data.note?.trim() || null,
      status: "active"
    })
    .select("id")
    .single();
  if (error || !session) return { ok: false, message: "Couldn't start Safe Arrival. Try again." };

  await admin.from("safe_arrival_contacts").insert(
    contacts.map((contactId) => ({
      session_id: session.id,
      contact_user_id: contactId,
      notified_at: new Date().toISOString()
    }))
  );

  await recordSafeArrivalEvent(admin, { sessionId: session.id, eventType: "created", createdBy: userId });
  {
    const { grantAchievement } = await import("@/lib/engagement/achievements");
    await grantAchievement(admin, userId, "trusted_contact");
  }

  const name = await travellerName(admin, userId);
  const arrivalLabel = new Date(expectedMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  await Promise.all(
    contacts.map((contactId) =>
      deliverNotification(admin, {
        userId: contactId,
        priority: "critical",
        type: "safe_arrival:request",
        title: "Safe Arrival request",
        message: `${name} is heading to ${parsed.data.destinationLabel.trim()} and expects to arrive by ${arrivalLabel}.`
      })
    )
  );

  return { ok: true, message: "Safe Arrival started. Your contacts have been asked to check on you.", sessionId: session.id };
}

// ---------------------------------------------------------------------------
// Contact acknowledgement (spec §5)
// ---------------------------------------------------------------------------

export async function acknowledgeSafeArrivalAction(
  sessionId: string,
  response: string
): Promise<SafeArrivalActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(sessionId).success) return { ok: false, message: "Session not found." };
  const parsed = z.enum(["watching", "declined"]).safeParse(response);
  if (!parsed.success) return { ok: false, message: "Choose a valid response." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const access = await resolveSafeArrivalAccess(admin, userId, sessionId);
  if (!access.exists) return { ok: false, message: "Session not found." };
  if (!access.isContact) return { ok: false, message: "You're not a contact on this session." };

  const { error } = await admin
    .from("safe_arrival_contacts")
    .update({ acknowledgement_status: parsed.data, acknowledged_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .eq("contact_user_id", userId);
  if (error) return { ok: false, message: "Couldn't save your response." };

  await recordSafeArrivalEvent(admin, {
    sessionId,
    eventType: parsed.data === "watching" ? "acknowledged" : "declined",
    createdBy: userId
  });

  return {
    ok: true,
    message: parsed.data === "watching" ? "You'll be notified about this journey." : "Okay, you won't be asked about this one."
  };
}

// ---------------------------------------------------------------------------
// Confirm arrival (spec §8)
// ---------------------------------------------------------------------------

export async function confirmSafeArrivalAction(sessionId: string): Promise<SafeArrivalActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(sessionId).success) return { ok: false, message: "Session not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: session } = await admin
    .from("safe_arrival_sessions")
    .select("id, traveller_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { ok: false, message: "Session not found." };
  if (session.traveller_id !== userId) {
    return { ok: false, message: "Only the traveller can confirm arrival." };
  }
  if (!canTravellerAct(session.status)) return { ok: false, message: "This session is already closed." };
  if (!canTransitionSafeArrival(session.status, "completed")) {
    return { ok: false, message: "This session can't be confirmed." };
  }

  // Guarded update: a duplicate confirm from another device is a no-op, not a
  // second round of notifications (spec §16).
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
    const { grantAchievement } = await import("@/lib/engagement/achievements");
    await grantAchievement(admin, userId, "good_check_in");
  }
  const name = await travellerName(admin, userId);
  await notifyContacts(admin, sessionId, {
    type: "safe_arrival:arrived",
    title: "Arrived safely",
    message: arrivedMessage(name)
  });

  return { ok: true, message: "You're marked as arrived. Your contacts know." };
}

// ---------------------------------------------------------------------------
// Extend (spec §9)
// ---------------------------------------------------------------------------

export async function extendSafeArrivalAction(
  sessionId: string,
  extraMinutes: number
): Promise<SafeArrivalActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(sessionId).success) return { ok: false, message: "Session not found." };

  const extensionError = validateExtension(extraMinutes);
  if (extensionError) return { ok: false, message: extensionError };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: session } = await admin
    .from("safe_arrival_sessions")
    .select("id, traveller_id, status, expected_arrival_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { ok: false, message: "Session not found." };
  if (session.traveller_id !== userId) return { ok: false, message: "Only the traveller can extend." };
  if (!canTravellerAct(session.status)) return { ok: false, message: "This session is already closed." };

  const nextArrivalMs = extendedArrivalMs(Date.parse(session.expected_arrival_at), extraMinutes, Date.now());
  const { error } = await admin
    .from("safe_arrival_sessions")
    .update({
      expected_arrival_at: new Date(nextArrivalMs).toISOString(),
      status: "extended",
      // Clear the alert latch so a later overdue can alert again (spec §9).
      unconfirmed_notified_at: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", sessionId)
    .eq("traveller_id", userId);
  if (error) return { ok: false, message: "Couldn't extend the session." };

  await recordSafeArrivalEvent(admin, {
    sessionId,
    eventType: "extended",
    createdBy: userId,
    metadata: { extraMinutes }
  });

  const name = await travellerName(admin, userId);
  await notifyContacts(admin, sessionId, {
    type: "safe_arrival:extended",
    title: "Safe Arrival extended",
    message: extendedMessage(name, extraMinutes)
  });

  return { ok: true, message: `Extended by ${extraMinutes} minutes.` };
}

// ---------------------------------------------------------------------------
// Cancel (spec §14)
// ---------------------------------------------------------------------------

export async function cancelSafeArrivalAction(sessionId: string): Promise<SafeArrivalActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(sessionId).success) return { ok: false, message: "Session not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

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

  await admin
    .from("safe_arrival_sessions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("traveller_id", userId);

  await recordSafeArrivalEvent(admin, { sessionId, eventType: "cancelled", createdBy: userId });
  return { ok: true, message: "Safe Arrival cancelled." };
}

// ---------------------------------------------------------------------------
// Contact opt-out (spec §17), silent, never disclosed to the traveller.
// ---------------------------------------------------------------------------

export async function muteSafeArrivalFromAction(travellerId: string): Promise<SafeArrivalActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(travellerId).success) return { ok: false, message: "Not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  if (userId === travellerId) return { ok: false, message: "You can't mute yourself." };

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("safe_arrival_blocks")
    .upsert({ user_id: userId, blocked_traveller_id: travellerId }, { onConflict: "user_id,blocked_traveller_id" });
  if (error) return { ok: false, message: "Couldn't update that setting." };
  return { ok: true, message: "You won't get Safe Arrival requests from them. They aren't told." };
}
