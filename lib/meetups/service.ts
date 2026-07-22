import "server-only";

import { z } from "zod";
import { deliverNotification } from "@/lib/notifications/server";
import { requirePremiumPlan } from "@/lib/premium/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

/**
 * Transport-agnostic Meeting Pings service. Takes an already-authenticated
 * `userId`; shared by the web Server Actions (`premium-actions.ts`) and the
 * mobile routes under `/api/pings`. Listing is open; creating/replying is
 * gated to Buddy Plus, exactly as the web enforces — no bypass.
 */

export type MeetingPingItem = {
  id: string;
  direction: "received" | "sent";
  counterpartyName: string;
  message: string;
  status: "pending" | "accepted" | "declined" | "expired";
  createdAt: string;
};

export type MeetupResult = { ok: boolean; message: string };

const createSchema = z.object({
  receiverId: z.string().uuid(),
  message: z.string().trim().max(180).optional()
});

const respondSchema = z.object({
  requestId: z.string().uuid(),
  message: z.string().trim().min(2).max(180)
});

const uuidSchema = z.string().uuid();
type Admin = ReturnType<typeof createSupabaseAdminClient>;

function serviceRoleEnvMessage(): string | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return "This action needs the server database configuration.";
  return null;
}

function orderedPair(userId: string, friendId: string) {
  return userId < friendId
    ? { user_one_id: userId, user_two_id: friendId }
    : { user_one_id: friendId, user_two_id: userId };
}

async function areFriends(admin: Admin, userId: string, friendId: string): Promise<boolean> {
  const { data } = await admin.from("friendships").select("id").match(orderedPair(userId, friendId)).maybeSingle();
  return Boolean(data);
}

async function requirePlus(userId: string): Promise<MeetupResult | null> {
  try {
    await requirePremiumPlan(userId, "buddy_plus");
    return null;
  } catch {
    return { ok: false, message: "An active Buddy Plus plan is required." };
  }
}

async function displayName(admin: Admin, userId: string): Promise<string> {
  const { data } = await admin.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
  return data?.full_name?.trim() || "A Muddy";
}

/** All of the user's pings (sent + received), newest first, with expiry applied. */
export async function listMeetingPings(userId: string): Promise<MeetingPingItem[]> {
  if (serviceRoleEnvMessage()) return [];
  const admin = createSupabaseAdminClient();
  const { data: rows } = await admin
    .from("meetup_requests")
    .select("id, sender_id, receiver_id, message, status, expires_at, created_at")
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(100);

  const counterpartIds = [...new Set((rows ?? []).map((row) => (row.sender_id === userId ? row.receiver_id : row.sender_id)))];
  const { data: profiles } = counterpartIds.length
    ? await admin.from("profiles").select("user_id, full_name").in("user_id", counterpartIds)
    : { data: [] };
  const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.full_name?.trim() || "A Muddy"]));
  const now = Date.now();

  return (rows ?? []).map((row) => {
    const otherId = row.sender_id === userId ? row.receiver_id : row.sender_id;
    return {
      id: row.id,
      direction: row.sender_id === userId ? ("sent" as const) : ("received" as const),
      counterpartyName: names.get(otherId) ?? "A Muddy",
      message: row.message?.trim() || "Wants to connect",
      status: row.status === "pending" && Date.parse(row.expires_at) <= now ? ("expired" as const) : row.status,
      createdAt: row.created_at
    };
  });
}

/** Send a meeting ping to an approved Muddy (Buddy Plus). */
export async function createMeetupRequest(userId: string, input: unknown): Promise<MeetupResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a Muddy and keep the message short." };

  const gate = await requirePlus(userId);
  if (gate) return gate;

  const admin = createSupabaseAdminClient();
  if (!(await areFriends(admin, userId, parsed.data.receiverId))) {
    return { ok: false, message: "Choose an approved Muddy first." };
  }

  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const { data: request, error } = await admin
    .from("meetup_requests")
    .insert({ sender_id: userId, receiver_id: parsed.data.receiverId, message: parsed.data.message || null, expires_at: expiresAt })
    .select("id")
    .single();
  if (error || !request) return { ok: false, message: "The meeting ping could not be sent." };

  const name = await displayName(admin, userId);
  await deliverNotification(admin, {
    userId: parsed.data.receiverId,
    senderId: userId,
    category: "pings",
    priority: "high",
    type: `meetup_request:${request.id}`,
    title: `${name} sent you a connection prompt`,
    message: parsed.data.message || `${name} wants to meet nearby.`
  });
  return { ok: true, message: "Meeting ping sent." };
}

/** Reply to a received ping (Buddy Plus). Marks the original accepted. */
export async function respondToMeetupRequest(userId: string, input: unknown): Promise<MeetupResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };
  const parsed = respondSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Use 2 to 180 characters for your reply." };

  const gate = await requirePlus(userId);
  if (gate) return gate;

  const admin = createSupabaseAdminClient();
  const { data: original } = await admin
    .from("meetup_requests")
    .select("sender_id, receiver_id, status")
    .eq("id", parsed.data.requestId)
    .eq("receiver_id", userId)
    .maybeSingle();
  if (!original) return { ok: false, message: "This meeting ping is no longer available." };

  if (!(await areFriends(admin, userId, original.sender_id))) {
    return { ok: false, message: "You're no longer connected with this Muddy." };
  }

  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const { data: reply, error } = await admin
    .from("meetup_requests")
    .insert({ sender_id: userId, receiver_id: original.sender_id, message: parsed.data.message, expires_at: expiresAt })
    .select("id")
    .single();
  if (error || !reply) return { ok: false, message: "Your reply could not be sent." };

  await admin.from("meetup_requests").update({ status: "accepted" }).eq("id", parsed.data.requestId);

  const name = await displayName(admin, userId);
  await deliverNotification(admin, {
    userId: original.sender_id,
    senderId: userId,
    category: "pings",
    priority: "high",
    type: `meetup_request:${reply.id}`,
    title: `${name} replied`,
    message: parsed.data.message
  });
  return { ok: true, message: "Reply sent." };
}

/** Decline a pending received ping (Buddy Plus). */
export async function dismissMeetupRequest(userId: string, requestId: string): Promise<MeetupResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };
  if (!uuidSchema.safeParse(requestId).success) return { ok: false, message: "Meeting ping not found." };

  const gate = await requirePlus(userId);
  if (gate) return gate;

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("meetup_requests")
    .update({ status: "declined" })
    .eq("id", requestId)
    .eq("receiver_id", userId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!data) return { ok: false, message: "This meeting ping is no longer available." };
  return { ok: true, message: "Meeting ping declined." };
}
