"use server";

import { z } from "zod";
import { recordProductEvent } from "@/lib/analytics/track";
import { upgradePromptFor } from "@/lib/billing/entitlements";
import { deliverNotification } from "@/lib/notifications/server";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  eligibleTrustedContacts,
  loadSafeArrivalJourneyById,
  recordSafeArrivalEvent,
  resolveSafeArrivalAccess
} from "@/lib/safety/safe-arrival-service";
import type { SafeArrivalJourney } from "@/lib/safety/safe-arrival-service";
import {
  canTransitionSafeArrival,
  canTravellerAct,
  extendedArrivalMs,
  isTerminalSafeArrivalStatus,
  safeArrivalLimitsFor,
  safeArrivalNotification,
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

/**
 * Times in notifications are rendered in the product's default recipient
 * timezone, not the server's. On Vercel the runtime is UTC, so
 * `toLocaleTimeString()` with no zone would quietly state the wrong arrival
 * time for anyone outside it.
 */
function arrivalTimeLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: DEFAULT_RECIPIENT_TIMEZONE
  });
}

/**
 * Fans a lifecycle notification out to every watcher who has not declined.
 *
 * In-app rows are written IN the response path on purpose: a Safe Arrival alert
 * is the promise the feature makes, so it must not depend on post-response work
 * surviving. (Push transport is separately deferred inside
 * `deliverNotification`.) Realtime is never involved — a watcher who reloads
 * still finds the notification and the journey.
 */
async function notifyWatchers(
  admin: Admin,
  sessionId: string,
  notification: { title: string; message: string }
) {
  const { data: contacts } = await admin
    .from("safe_arrival_contacts")
    .select("contact_user_id")
    .eq("session_id", sessionId)
    .neq("acknowledgement_status", "declined");

  await Promise.all(
    (contacts ?? []).map((contact) =>
      // Safety notifications are critical: they intentionally bypass category
      // preferences, quiet hours, Exam Mode and the daily budget.
      deliverNotification(admin, {
        userId: contact.contact_user_id,
        priority: "critical",
        // `safe_arrival:<sessionId>` is what the notification destination
        // resolver turns into /safe-arrival?session=<id>, so a tap opens THIS
        // journey rather than the feature root.
        type: `safe_arrival:${sessionId}`,
        title: notification.title,
        message: notification.message
      })
    )
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const createSchema = z.object({
  destinationLabel: z.string(),
  expectedArrivalAt: z.string().datetime({ offset: true }),
  gracePeriodMinutes: z.number().int(),
  note: z.string().max(200).optional(),
  // Upper bound is the highest any plan allows; the caller's ACTUAL plan limit
  // is enforced below. This was previously a hardcoded 5, which silently capped
  // a Buddy Pro traveller at the Plus allowance before plan logic ever ran.
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
  const access = await getCurrentSubscriptionAccess(userId);
  const limits = safeArrivalLimitsFor(access.plan);

  // Server-side tier enforcement. The client hides over-limit selection, but
  // that is presentation: this is the check that actually holds.
  const countError = validateContactCount(parsed.data.contactIds.length, access.plan);
  if (countError) {
    return { ok: false, message: upgradePromptFor("max_safe_arrival_contacts", access.plan) ?? countError };
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
    if (error?.message?.includes("safe_arrival_no_watchers")) {
      return { ok: false, message: "Choose approved Muddies to watch over your journey." };
    }
    return { ok: false, message: "Couldn't start Safe Arrival. Try again." };
  }

  {
    const { grantAchievement } = await import("@/lib/engagement/achievements");
    await grantAchievement(admin, userId, "trusted_contact");
  }

  const name = await travellerName(admin, userId);
  const notification = safeArrivalNotification("started", {
    travellerName: name,
    destinationLabel: parsed.data.destinationLabel.trim(),
    timeLabel: arrivalTimeLabel(new Date(expectedMs).toISOString())
  });
  await notifyWatchers(admin, sessionId, notification);

  // Privacy-safe analytics: the journey id and the watcher count, never the
  // destination text, the note, or anything derived from location.
  await recordProductEvent(admin, {
    eventName: "safe_arrival_started",
    actorId: userId,
    resourceType: "safe_arrival_session",
    resourceId: sessionId,
    featureKey: "safe_arrival"
  });

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
  const { data: session } = await admin
    .from("safe_arrival_sessions")
    .select("id, traveller_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { ok: false, message: "Journey not found." };
  if (session.traveller_id !== userId) {
    return { ok: false, message: "Only the traveller can confirm arrival." };
  }
  if (!canTravellerAct(session.status)) return { ok: false, message: "This journey is already closed." };
  if (!canTransitionSafeArrival(session.status, "completed")) {
    return { ok: false, message: "This journey can't be confirmed." };
  }

  // Guarded update: a duplicate confirm from another device updates no row and
  // therefore sends no second round of notifications.
  const { data: updated } = await admin
    .from("safe_arrival_sessions")
    .update({ status: "completed", confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("traveller_id", userId)
    .in("status", ["active", "grace_period", "extended", "unconfirmed"])
    .select("id");

  if (!updated?.length) {
    return {
      ok: true,
      message: "You're marked as arrived.",
      sessionId,
      journey: await loadSafeArrivalJourneyById(admin, userId, sessionId)
    };
  }

  await recordSafeArrivalEvent(admin, { sessionId, eventType: "confirmed", createdBy: userId });
  {
    const { grantSafeTravellerAchievements } = await import("@/lib/engagement/achievements");
    await grantSafeTravellerAchievements(admin, userId);
  }

  const name = await travellerName(admin, userId);
  await notifyWatchers(admin, sessionId, safeArrivalNotification("arrived", { travellerName: name }));

  await recordProductEvent(admin, {
    eventName: "safe_arrival_completed",
    actorId: userId,
    resourceType: "safe_arrival_session",
    resourceId: sessionId,
    featureKey: "safe_arrival"
  });

  return {
    ok: true,
    message: "You're marked as arrived.",
    sessionId,
    journey: await loadSafeArrivalJourneyById(admin, userId, sessionId)
  };
}

// ---------------------------------------------------------------------------
// Extend
// ---------------------------------------------------------------------------

/** Repeated small extensions must not spam watchers with a push each time. */
const EXTENSION_NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000;

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
  const { data: session } = await admin
    .from("safe_arrival_sessions")
    .select("id, traveller_id, status, expected_arrival_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { ok: false, message: "Journey not found." };
  if (session.traveller_id !== userId) return { ok: false, message: "Only the traveller can extend." };
  if (!canTravellerAct(session.status)) return { ok: false, message: "This journey is already closed." };

  const nextArrivalMs = extendedArrivalMs(Date.parse(session.expected_arrival_at), extraMinutes, Date.now());
  const nextArrivalIso = new Date(nextArrivalMs).toISOString();

  const { error } = await admin
    .from("safe_arrival_sessions")
    .update({
      expected_arrival_at: nextArrivalIso,
      status: "extended",
      // Clear the alert latch so a LATER overdue can still alert. Without this,
      // extending a journey that had already alerted would silence it forever.
      unconfirmed_notified_at: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", sessionId)
    .eq("traveller_id", userId);
  if (error) return { ok: false, message: "Couldn't extend the journey." };

  // Read the previous extension BEFORE writing this one, so the cooldown
  // compares against the last notified extension rather than itself.
  const { data: priorExtensions } = await admin
    .from("safe_arrival_events")
    .select("created_at")
    .eq("session_id", sessionId)
    .eq("event_type", "extended")
    .order("created_at", { ascending: false })
    .limit(1);
  const lastExtendedMs = priorExtensions?.[0]?.created_at ? Date.parse(priorExtensions[0].created_at) : null;

  await recordSafeArrivalEvent(admin, {
    sessionId,
    eventType: "extended",
    createdBy: userId,
    metadata: { extraMinutes }
  });

  // The new time is always persisted and always visible on the watcher's
  // screen; only the notification is rate limited.
  const withinCooldown =
    lastExtendedMs !== null && Date.now() - lastExtendedMs < EXTENSION_NOTIFICATION_COOLDOWN_MS;
  if (!withinCooldown) {
    const name = await travellerName(admin, userId);
    await notifyWatchers(
      admin,
      sessionId,
      safeArrivalNotification("extended", { travellerName: name, timeLabel: arrivalTimeLabel(nextArrivalIso) })
    );
  }

  return {
    ok: true,
    message: `Extended by ${extraMinutes} minutes.`,
    sessionId,
    journey: await loadSafeArrivalJourneyById(admin, userId, sessionId)
  };
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
  const { data: session } = await admin
    .from("safe_arrival_sessions")
    .select("id, traveller_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { ok: false, message: "Journey not found." };
  if (session.traveller_id !== userId) return { ok: false, message: "Only the traveller can cancel." };
  if (!canTransitionSafeArrival(session.status, "cancelled")) {
    return { ok: false, message: "This journey is already closed." };
  }

  // Guarded so a duplicate cancel updates no row and sends no second round.
  const { data: cancelled } = await admin
    .from("safe_arrival_sessions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("traveller_id", userId)
    .in("status", ["draft", "pending_acknowledgement", "active", "grace_period", "extended", "unconfirmed"])
    .select("id");

  await recordSafeArrivalEvent(admin, { sessionId, eventType: "cancelled", createdBy: userId });

  // Watchers must know they can stand down.
  if (cancelled?.length) {
    const name = await travellerName(admin, userId);
    await notifyWatchers(admin, sessionId, safeArrivalNotification("cancelled", { travellerName: name }));
  }

  return { ok: true, message: "Safe Arrival ended.", sessionId, journey: null };
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
