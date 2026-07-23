import "server-only";

import { z } from "zod";
import { deliverNotification } from "@/lib/notifications/server";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  activeSafeArrivalCount,
  eligibleTrustedContacts,
  recordSafeArrivalEvent
} from "@/lib/safety/safe-arrival-service";
import {
  arrivedMessage,
  canTransitionSafeArrival,
  canTravellerAct,
  safeArrivalLimitsFor,
  validateContactCount,
  validateDestinationLabel,
  validateExpectedArrival,
  validateGracePeriod
} from "@/lib/safety/safe-arrival";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import type { SafeArrivalStatus } from "@/lib/supabase/database.types";

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
  watchers: Array<{ id: string; name: string; avatarUrl: string | null }>;
  sharedCount: number;
};

export type SafeArrivalData = {
  mySessions: SafeArrivalSessionSummary[];
  watching: SafeArrivalSessionSummary[];
  contacts: SafeArrivalContactOption[];
};

export type SafeArrivalResult = { ok: boolean; message: string; sessionId?: string };

const uuidSchema = z.string().uuid();

const LIVE_STATUSES: SafeArrivalStatus[] = [
  "draft",
  "pending_acknowledgement",
  "active",
  "grace_period",
  "extended",
  "unconfirmed"
];

const createSchema = z.object({
  destinationLabel: z.string(),
  expectedArrivalAt: z.string().datetime({ offset: true }),
  gracePeriodMinutes: z.number().int(),
  note: z.string().max(200).optional(),
  contactIds: z.array(uuidSchema).min(1).max(5)
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

async function loadContacts(admin: Admin, userId: string): Promise<SafeArrivalContactOption[]> {
  const { data: friendships } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`);
  const friendIds = (friendships ?? []).map((friendship) =>
    friendship.user_one_id === userId ? friendship.user_two_id : friendship.user_one_id
  );
  if (friendIds.length === 0) return [];

  const [{ data: profiles }, { data: closeFriends }] = await Promise.all([
    admin.from("profiles").select("user_id, full_name").in("user_id", friendIds),
    admin.from("close_friend_relationships").select("friend_id").eq("owner_id", userId)
  ]);
  const closeIds = new Set((closeFriends ?? []).map((row) => row.friend_id));

  return (profiles ?? [])
    .map((profile) => ({
      id: profile.user_id,
      name: profile.full_name?.trim() || "A Muddy",
      isCloseFriend: closeIds.has(profile.user_id)
    }))
    .sort((a, b) => Number(b.isCloseFriend) - Number(a.isCloseFriend) || a.name.localeCompare(b.name));
}

export async function loadSafeArrival(userId: string): Promise<SafeArrivalData> {
  if (!hasServiceRoleEnv()) return { mySessions: [], watching: [], contacts: [] };
  const admin = createSupabaseAdminClient();

  const { data: ownRows } = await admin
    .from("safe_arrival_sessions")
    .select("id, destination_label, expected_arrival_at, grace_period_minutes, note, status, traveller_id, started_at")
    .eq("traveller_id", userId)
    .in("status", LIVE_STATUSES)
    .order("expected_arrival_at", { ascending: true });

  const ownSessionIds = (ownRows ?? []).map((row) => row.id);
  const watchersBySession = new Map<string, SafeArrivalSessionSummary["watchers"]>();
  const sharedCountBySession = new Map<string, number>();
  if (ownSessionIds.length > 0) {
    const { data: ownContactRows } = await admin
      .from("safe_arrival_contacts")
      .select("session_id, contact_user_id, acknowledgement_status")
      .in("session_id", ownSessionIds);
    const acceptedWatcherIds = [
      ...new Set(
        (ownContactRows ?? [])
          .filter((row) => row.acknowledgement_status === "watching")
          .map((row) => row.contact_user_id)
      )
    ];
    const watcherProfiles = new Map<string, { name: string; avatarUrl: string | null }>();
    if (acceptedWatcherIds.length > 0) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("user_id, full_name, avatar_url")
        .in("user_id", acceptedWatcherIds);
      for (const profile of profiles ?? []) {
        watcherProfiles.set(profile.user_id, {
          name: profile.full_name?.trim() || "A Muddy",
          avatarUrl: profile.avatar_url
        });
      }
    }
    for (const sessionId of ownSessionIds) {
      const sessionContacts = (ownContactRows ?? []).filter((row) => row.session_id === sessionId);
      sharedCountBySession.set(
        sessionId,
        sessionContacts.filter((row) => row.acknowledgement_status !== "declined").length
      );
      watchersBySession.set(
        sessionId,
        sessionContacts
          .filter((row) => row.acknowledgement_status === "watching")
          .map((row) => ({
            id: row.contact_user_id,
            name: watcherProfiles.get(row.contact_user_id)?.name ?? "A Muddy",
            avatarUrl: watcherProfiles.get(row.contact_user_id)?.avatarUrl ?? null
          }))
      );
    }
  }

  const mySessions: SafeArrivalSessionSummary[] = (ownRows ?? []).map((row) => ({
    id: row.id,
    destinationLabel: row.destination_label,
    expectedArrivalAt: row.expected_arrival_at,
    gracePeriodMinutes: row.grace_period_minutes,
    note: row.note,
    status: row.status,
    travellerName: "You",
    isTraveller: true,
    myAcknowledgement: null,
    startedAt: row.started_at,
    watchers: watchersBySession.get(row.id) ?? [],
    sharedCount: sharedCountBySession.get(row.id) ?? 0
  }));

  const { data: contactRows } = await admin
    .from("safe_arrival_contacts")
    .select("session_id, acknowledgement_status")
    .eq("contact_user_id", userId);
  const watchedIds = (contactRows ?? []).map((row) => row.session_id);
  const acknowledgementBySession = new Map(
    (contactRows ?? []).map((row) => [row.session_id, row.acknowledgement_status])
  );

  let watching: SafeArrivalSessionSummary[] = [];
  if (watchedIds.length > 0) {
    const { data: watchedRows } = await admin
      .from("safe_arrival_sessions")
      .select("id, destination_label, expected_arrival_at, grace_period_minutes, note, status, traveller_id, started_at")
      .in("id", watchedIds)
      .in("status", LIVE_STATUSES)
      .order("expected_arrival_at", { ascending: true });

    const travellerIds = [...new Set((watchedRows ?? []).map((row) => row.traveller_id))];
    const nameById = new Map<string, string>();
    if (travellerIds.length > 0) {
      const { data: profiles } = await admin.from("profiles").select("user_id, full_name").in("user_id", travellerIds);
      for (const profile of profiles ?? []) {
        nameById.set(profile.user_id, profile.full_name?.trim() || "A Muddy");
      }
    }

    watching = (watchedRows ?? []).map((row) => ({
      id: row.id,
      destinationLabel: row.destination_label,
      expectedArrivalAt: row.expected_arrival_at,
      gracePeriodMinutes: row.grace_period_minutes,
      note: row.note,
      status: row.status,
      travellerName: nameById.get(row.traveller_id) ?? "A Muddy",
      isTraveller: false,
      myAcknowledgement: acknowledgementBySession.get(row.id) ?? null,
      startedAt: row.started_at,
      watchers: [],
      sharedCount: 0
    }));
  }

  const contacts = await loadContacts(admin, userId);
  return { mySessions, watching, contacts };
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

  if ((await activeSafeArrivalCount(admin, userId)) >= limits.maxActiveSessions) {
    return { ok: false, message: `You can have up to ${limits.maxActiveSessions} Safe Arrival sessions at once.` };
  }

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

  return {
    ok: true,
    message: "Safe Arrival started. Your contacts have been asked to check on you.",
    sessionId: session.id
  };
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
  const name = await travellerName(admin, userId);
  await notifyContacts(admin, sessionId, {
    type: "safe_arrival:arrived",
    title: "Arrived safely",
    message: arrivedMessage(name)
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

  await admin
    .from("safe_arrival_sessions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("traveller_id", userId);

  await recordSafeArrivalEvent(admin, { sessionId, eventType: "cancelled", createdBy: userId });
  return { ok: true, message: "Safe Arrival cancelled." };
}
