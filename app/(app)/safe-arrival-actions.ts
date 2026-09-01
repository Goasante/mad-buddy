"use server";

import { z } from "zod";
import { recordProductEvent } from "@/lib/analytics/track";
import { deliverNotification } from "@/lib/notifications/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  eligibleTrustedContacts,
  loadSafeArrivalJourneyById,
  recordSafeArrivalEvent,
  resolveSafeArrivalAccess
} from "@/lib/safety/safe-arrival-service";
import type { SafeArrivalJourney } from "@/lib/safety/safe-arrival-service";
import {
  isTerminalSafeArrivalStatus,
  safeArrivalLimitsFor,
  validateContactCount,
  validateDestinationLabel,
  validateExpectedArrival,
  validateExtension,
  validateGracePeriod,
  watcherAcceptedMessage
} from "@/lib/safety/safe-arrival";
import type { SafeArrivalStatus } from "@/lib/supabase/database.types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { transitionSafeArrival } from "@/lib/safety/safe-arrival-authority";

/**
 * Deliberately NOT exported: a `"use server"` module must never export a type.
 * Turbopack's action transform emits a runtime reference for an exported type,
 * which is `undefined` at runtime and throws `ReferenceError` on EVERY action in
 * the file. Consumers infer the shape from the action's return type instead, and
 * `SafeArrivalJourney` itself lives in the service module.
 */
type SafeArrivalActionState = {
  ok: boolean;
  message: string;
  sessionId?: string;
  /**
   * The canonical journey after the mutation. Returning it is what lets the
   * traveller's screen switch to ACTIVE (or ARRIVED) immediately, with no
   * refresh, no second round trip, and no dependence on a Realtime event.
   */
  journey?: SafeArrivalJourney | null;
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

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const createSchema = z.object({
  destinationLabel: z.string(),
  expectedArrivalAt: z.string().datetime({ offset: true }),
  gracePeriodMinutes: z.number().int(),
  note: z.string().max(200).optional(),
  // Technical request bound only; payment state never changes Safe Arrival capacity.
  contactIds: z.array(uuidSchema).min(1).max(50)
});

export async function createSafeArrivalAction(input: unknown): Promise<SafeArrivalActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the Safe Arrival details and try again." };

  const labelError = validateDestinationLabel(parsed.data.destinationLabel);
  if (labelError) return { ok: false, message: labelError };

  // The SERVER clock decides whether the arrival time is in the future. The
  // client's own check is only there to explain the disabled state early.
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
  const limits = safeArrivalLimitsFor("free");

  // Server-side technical capacity enforcement. The client check is presentation only.
  const countError = validateContactCount(parsed.data.contactIds.length, "free");
  if (countError) {
    // No upgrade prompt: Safe Arrival capacity is not a paid feature. Any
    // message here describes a system limit, never a plan.
    return { ok: false, message: countError };
  }

  // Server decides eligibility. A contact who silently opted out of this
  // traveller's requests is dropped without the traveller being told.
  const contacts = await eligibleTrustedContacts(admin, userId, parsed.data.contactIds);
  if (contacts.length === 0) {
    return { ok: false, message: "Choose approved Muddies to watch over your journey." };
  }

  // One transaction creates the journey, its watcher rows and the audit event.
  // A duplicate submit within two minutes replays the same journey id instead of
  // starting a second one, so a double tap or a retried request is harmless.
  const { data: started, error } = await admin.rpc("start_safe_arrival", {
    p_traveller_id: userId,
    p_destination_label: parsed.data.destinationLabel.trim(),
    p_expected_arrival_at: new Date(expectedMs).toISOString(),
    p_grace_period_minutes: parsed.data.gracePeriodMinutes,
    p_note: parsed.data.note?.trim() || null,
    p_contact_ids: contacts,
    p_max_active: limits.maxActiveSessions
  });

  const startResult = started?.[0];
  const sessionId = startResult?.session_id;
  if (error || !sessionId) {
    if (error?.message?.includes("safe_arrival_active_limit")) {
      return {
        ok: false,
        message: `You can have up to ${limits.maxActiveSessions} Safe Arrival journeys at once.`
      };
    }
    if (error?.message?.includes("safe_arrival_no_watchers")) {
      return { ok: false, message: "Choose approved Muddies to watch over your journey." };
    }
    return { ok: false, message: "Couldn't start Safe Arrival. Try again." };
  }

  if (!startResult.replayed) {
    const { grantAchievement } = await import("@/lib/engagement/achievements");
    await grantAchievement(admin, userId, "trusted_contact");

    // Privacy-safe analytics is a first-start side effect, never replayed.
    await recordProductEvent(admin, {
      eventName: "safe_arrival_started",
      actorId: userId,
      resourceType: "safe_arrival_session",
      resourceId: sessionId,
      featureKey: "safe_arrival"
    });
  }

  const journey = await loadSafeArrivalJourneyById(admin, userId, sessionId);
  return {
    ok: true,
    message: "Safe Arrival started.",
    sessionId,
    journey
  };
}

// ---------------------------------------------------------------------------
// Watcher acknowledgement
// ---------------------------------------------------------------------------

export async function acknowledgeSafeArrivalAction(
  sessionId: string,
  response: string
): Promise<SafeArrivalActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(sessionId).success) return { ok: false, message: "Journey not found." };
  const parsed = z.enum(["watching", "declined"]).safeParse(response);
  if (!parsed.success) return { ok: false, message: "Choose a valid response." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const access = await resolveSafeArrivalAccess(admin, userId, sessionId);
  if (!access.exists) return { ok: false, message: "Journey not found." };
  if (!access.isContact) return { ok: false, message: "You're not watching this journey." };

  // Guard on a real change so re-accepting (a duplicate tap, or a second
  // device) never fires a second "watcher accepted" notification.
  const { data: changed, error } = await admin
    .from("safe_arrival_contacts")
    .update({ acknowledgement_status: parsed.data, acknowledged_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .eq("contact_user_id", userId)
    .neq("acknowledgement_status", parsed.data)
    .select("id");
  if (error) return { ok: false, message: "Couldn't save your response." };

  await recordSafeArrivalEvent(admin, {
    sessionId,
    eventType: parsed.data === "watching" ? "acknowledged" : "declined",
    createdBy: userId
  });

  if (parsed.data === "watching" && changed?.length) {
    const { grantReliableWatcherAchievement } = await import("@/lib/engagement/achievements");
    await grantReliableWatcherAchievement(admin, userId);

    // Tell the TRAVELLER (never the actor) that a watcher accepted. Server-side
    // and only on a genuine transition, so it works with the traveller's app
    // closed. Informational priority: this one respects their preferences.
    const { data: session } = await admin
      .from("safe_arrival_sessions")
      .select("traveller_id, status")
      .eq("id", sessionId)
      .maybeSingle();
    if (session && !isTerminalSafeArrivalStatus(session.status as SafeArrivalStatus)) {
      const watcher = await travellerName(admin, userId);
      await deliverNotification(admin, {
        userId: session.traveller_id,
        priority: "normal",
        type: `safe_arrival:${sessionId}`,
        title: "Watching your journey",
        message: watcherAcceptedMessage(watcher)
      });
    }
  }

  return {
    ok: true,
    message:
      parsed.data === "watching"
        ? "You'll be notified about this journey."
        : "Okay, you won't be asked about this one.",
    sessionId,
    journey: await loadSafeArrivalJourneyById(admin, userId, sessionId)
  };
}

// ---------------------------------------------------------------------------
// Confirm arrival
// ---------------------------------------------------------------------------

export async function confirmSafeArrivalAction(sessionId: string): Promise<SafeArrivalActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(sessionId).success) return { ok: false, message: "Journey not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  try {
    const result = await transitionSafeArrival(admin, { sessionId, actorId: userId, action: "arrive" });
    const journey = await loadSafeArrivalJourneyById(admin, userId, sessionId);
    if (result.status !== "completed") return { ok: false, message: "This journey is already closed.", sessionId, journey };
    return { ok: true, message: "You're marked as arrived.", sessionId, journey };
  } catch {
    return { ok: false, message: "Couldn't confirm arrival. Try again." };
  }

}

// ---------------------------------------------------------------------------
// Extend
// ---------------------------------------------------------------------------

export async function extendSafeArrivalAction(
  sessionId: string,
  extraMinutes: number
): Promise<SafeArrivalActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(sessionId).success) return { ok: false, message: "Journey not found." };

  const extensionError = validateExtension(extraMinutes);
  if (extensionError) return { ok: false, message: extensionError };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  try {
    const result = await transitionSafeArrival(admin, { sessionId, actorId: userId, action: "extend", extraMinutes });
    const journey = await loadSafeArrivalJourneyById(admin, userId, sessionId);
    if (!result.changed) return { ok: false, message: "This journey is already closed.", sessionId, journey };
    return { ok: true, message: `Extended by ${extraMinutes} minutes.`, sessionId, journey };
  } catch {
    return { ok: false, message: "Couldn't extend the journey." };
  }

}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelSafeArrivalAction(sessionId: string): Promise<SafeArrivalActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(sessionId).success) return { ok: false, message: "Journey not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  try {
    const result = await transitionSafeArrival(admin, { sessionId, actorId: userId, action: "cancel" });
    const journey = await loadSafeArrivalJourneyById(admin, userId, sessionId);
    if (result.status !== "cancelled") return { ok: false, message: "This journey is already closed.", sessionId, journey };
    return { ok: true, message: "Safe Arrival ended.", sessionId, journey };
  } catch {
    return { ok: false, message: "Couldn't end Safe Arrival." };
  }

}

// ---------------------------------------------------------------------------
// Watcher opt-out, silent and never disclosed to the traveller.
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
    .upsert(
      { user_id: userId, blocked_traveller_id: travellerId },
      { onConflict: "user_id,blocked_traveller_id" }
    );
  if (error) return { ok: false, message: "Couldn't update that setting." };
  return { ok: true, message: "You won't get Safe Arrival requests from them. They aren't told." };
}
