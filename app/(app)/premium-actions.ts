"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deliverNotification } from "@/lib/notifications/server";
import { requirePremiumPlan } from "@/lib/premium/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseBrowserEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PremiumActionState = {
  ok: boolean;
  message: string;
};

export type MeetingPingListItem = {
  id: string;
  direction: "received" | "sent";
  counterpartyName: string;
  message: string;
  status: "pending" | "accepted" | "declined" | "expired";
  createdAt: string;
};

const uuidSchema = z.string().uuid();

const glowThemeSchema = z.object({
  theme: z.enum(["aurora", "ember", "lagoon", "pulse", "monochrome"])
});

const moodSchema = z.object({
  moodStatus: z.string().trim().min(1).max(80)
});

const meetupSchema = z.object({
  receiverId: z.string().uuid(),
  message: z.string().trim().max(180).optional()
});

const meetupResponseSchema = z.object({
  requestId: z.string().uuid(),
  message: z.string().trim().min(2).max(180)
});

const circleSchema = z.object({
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(120).optional()
});

const circleMemberSchema = z.object({
  circleId: z.string().uuid(),
  friendId: z.string().uuid()
});

const privacyZoneSchema = z.object({
  name: z.string().trim().min(2).max(50),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(25).max(5000)
});

const ghostModeSchema = z.object({
  type: z.enum(["timer", "schedule", "event", "always_on"]),
  quietHours: z.string().trim().max(80).optional()
});

const eventModeSchema = z
  .object({
    name: z.string().trim().min(2).max(50),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    visibilityRule: z.enum(["friends_only", "circles_only", "hidden"])
  })
  .refine((data) => new Date(data.startsAt) < new Date(data.endsAt), {
    message: "Event Mode must end after it starts."
  });

function missingSupabaseState(): PremiumActionState | null {
  const env = getSupabaseBrowserEnv();

  if (!env.url || !env.anonKey) {
    return {
      ok: false,
      message: "Supabase is not configured yet. Add .env.local values and restart the dev server."
    };
  }

  return null;
}

async function getAuthedUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user.id;
}

function orderedPair(userId: string, friendId: string) {
  return userId < friendId
    ? { user_one_id: userId, user_two_id: friendId }
    : { user_one_id: friendId, user_two_id: userId };
}

async function requireFriendship(userId: string, friendId: string) {
  const supabase = await createSupabaseServerClient();
  const pair = orderedPair(userId, friendId);
  const { data, error } = await supabase
    .from("friendships")
    .select("id")
    .match(pair)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Choose an accepted Muddy before using this premium feature.");
  }
}

async function withPremiumAccess(
  requiredPlan: "buddy_plus" | "buddy_pro",
  work: (userId: string) => Promise<PremiumActionState>
): Promise<PremiumActionState> {
  const missingEnv = missingSupabaseState();

  if (missingEnv) {
    return missingEnv;
  }

  const userId = await getAuthedUserId();

  if (!userId) {
    return { ok: false, message: "Log in before changing premium settings." };
  }

  try {
    await requirePremiumPlan(userId, requiredPlan);
    return await work(userId);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Premium access could not be verified."
    };
  }
}

export async function updateGlowThemeAction(input: unknown): Promise<PremiumActionState> {
  const parsed = glowThemeSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Choose a valid glow theme." };
  }

  return withPremiumAccess("buddy_plus", async (userId) => {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("user_preferences").upsert({
      user_id: userId,
      glow_theme: parsed.data.theme
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    revalidatePath("/billing");
    return { ok: true, message: "Advanced glow theme saved." };
  });
}

export async function updateMoodStatusAction(input: unknown): Promise<PremiumActionState> {
  const parsed = moodSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Add a short mood status." };
  }

  return withPremiumAccess("buddy_plus", async (userId) => {
    const supabase = await createSupabaseServerClient();
    const [preferencesResult, profileResult] = await Promise.all([
      supabase.from("user_preferences").upsert({
        user_id: userId,
        mood_status: parsed.data.moodStatus
      }),
      supabase.from("profiles").update({ mood_status: parsed.data.moodStatus }).eq("user_id", userId)
    ]);

    if (preferencesResult.error || profileResult.error) {
      return {
        ok: false,
        message: preferencesResult.error?.message ?? profileResult.error?.message ?? "Mood was not saved."
      };
    }

    revalidatePath("/profile");
    return { ok: true, message: "Mood status saved." };
  });
}

export async function setBestBuddyAction(friendId: string): Promise<PremiumActionState> {
  const parsed = uuidSchema.safeParse(friendId);

  if (!parsed.success) {
    return { ok: false, message: "Choose a real Muddy first." };
  }

  return withPremiumAccess("buddy_plus", async (userId) => {
    if (userId === parsed.data) {
      return { ok: false, message: "You cannot make yourself a Best Buddy." };
    }

    await requireFriendship(userId, parsed.data);

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("best_buddies").upsert({
      user_id: userId,
      friend_id: parsed.data
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: "Best Buddy saved." };
  });
}

export async function createMeetupRequestAction(input: unknown): Promise<PremiumActionState> {
  const parsed = meetupSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Choose a Muddy and keep the message short." };
  }

  return withPremiumAccess("buddy_plus", async (userId) => {
    await requireFriendship(userId, parsed.data.receiverId);

    const supabase = await createSupabaseServerClient();
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const { data: meetupRequest, error } = await supabase
      .from("meetup_requests")
      .insert({
        sender_id: userId,
        receiver_id: parsed.data.receiverId,
        message: parsed.data.message || null,
        expires_at: expiresAt
      })
      .select("id")
      .single();

    if (error) {
      return { ok: false, message: error.message };
    }

    const admin = createSupabaseAdminClient();
    const { data: senderProfile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("user_id", userId)
      .maybeSingle();
    const senderName = senderProfile?.full_name ?? "A Muddy";
    await deliverNotification(admin, {
      userId: parsed.data.receiverId,
      senderId: userId,
      category: "pings",
      priority: "high",
      type: `meetup_request:${meetupRequest.id}`,
      title: `${senderName} sent you a connection prompt`,
      message:
        parsed.data.message === "Quick hello"
          ? `${senderName} sent you a quick hello.`
          : parsed.data.message || `${senderName} wants to meet nearby.`
    });

    revalidatePath("/notifications");
    return { ok: true, message: "Hello sent." };
  });
}

export async function respondToMeetupRequestAction(input: unknown): Promise<PremiumActionState> {
  const parsed = meetupResponseSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Use 2 to 180 characters for your reply." };
  }

  return withPremiumAccess("buddy_plus", async (userId) => {
    const admin = createSupabaseAdminClient();
    const { data: originalRequest, error: requestError } = await admin
      .from("meetup_requests")
      .select("sender_id, receiver_id, status")
      .eq("id", parsed.data.requestId)
      .eq("receiver_id", userId)
      .maybeSingle();

    if (requestError || !originalRequest) {
      return { ok: false, message: "This connection request is no longer available." };
    }

    await requireFriendship(userId, originalRequest.sender_id);
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const { data: reply, error: replyError } = await admin
      .from("meetup_requests")
      .insert({
        sender_id: userId,
        receiver_id: originalRequest.sender_id,
        message: parsed.data.message,
        expires_at: expiresAt
      })
      .select("id")
      .single();

    if (replyError) {
      return { ok: false, message: replyError.message };
    }

    await admin.from("meetup_requests").update({ status: "accepted" }).eq("id", parsed.data.requestId);
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("user_id", userId)
      .maybeSingle();
    const senderName = profile?.full_name ?? "A Muddy";
    await deliverNotification(admin, {
      userId: originalRequest.sender_id,
      senderId: userId,
      category: "pings",
      priority: "high",
      type: `meetup_request:${reply.id}`,
      title: `${senderName} replied`,
      message: parsed.data.message
    });

    revalidatePath("/notifications");
    return { ok: true, message: "Response sent." };
  });
}

export async function dismissMeetupRequestAction(requestId: string): Promise<PremiumActionState> {
  if (!uuidSchema.safeParse(requestId).success) return { ok: false, message: "Meeting ping not found." };
  return withPremiumAccess("buddy_plus", async (userId) => {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("meetup_requests")
      .update({ status: "declined" })
      .eq("id", requestId)
      .eq("receiver_id", userId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error || !data) return { ok: false, message: "This meeting ping is no longer available." };
    revalidatePath("/meeting-pings");
    return { ok: true, message: "Meeting ping declined." };
  });
}

export async function loadMeetingPingsAction(): Promise<MeetingPingListItem[]> {
  const userId = await getAuthedUserId();
  if (!userId || missingSupabaseState()) return [];
  const admin = createSupabaseAdminClient();
  const { data: rows } = await admin
    .from("meetup_requests")
    .select("id, sender_id, receiver_id, message, status, expires_at, created_at")
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(100);
  const counterpartIds = [...new Set((rows ?? []).map((row) => row.sender_id === userId ? row.receiver_id : row.sender_id))];
  const { data: profiles } = counterpartIds.length
    ? await admin.from("profiles").select("user_id, full_name").in("user_id", counterpartIds)
    : { data: [] };
  const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.full_name?.trim() || "A Muddy"]));
  const now = Date.now();
  return (rows ?? []).map((row) => {
    const otherId = row.sender_id === userId ? row.receiver_id : row.sender_id;
    return {
      id: row.id,
      direction: row.sender_id === userId ? "sent" as const : "received" as const,
      counterpartyName: names.get(otherId) ?? "A Muddy",
      message: row.message?.trim() || "Wants to connect",
      status: row.status === "pending" && Date.parse(row.expires_at) <= now ? "expired" as const : row.status,
      createdAt: row.created_at
    };
  });
}

export async function createFriendCircleAction(input: unknown): Promise<PremiumActionState> {
  const parsed = circleSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Give the circle a short name." };
  }

  return withPremiumAccess("buddy_pro", async (userId) => {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("friend_circles").insert({
      user_id: userId,
      name: parsed.data.name,
      description: parsed.data.description || null,
      visibility_rule: "circle_only"
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: "Muddy Circle created." };
  });
}

export async function addCircleMemberAction(input: unknown): Promise<PremiumActionState> {
  const parsed = circleMemberSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Choose a circle and accepted Muddy." };
  }

  return withPremiumAccess("buddy_pro", async (userId) => {
    await requireFriendship(userId, parsed.data.friendId);

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("circle_members").insert({
      circle_id: parsed.data.circleId,
      friend_id: parsed.data.friendId
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: "Muddy added to circle." };
  });
}

export async function createPrivacyZoneAction(input: unknown): Promise<PremiumActionState> {
  const parsed = privacyZoneSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Check the zone name, radius, and coordinates." };
  }

  return withPremiumAccess("buddy_pro", async (userId) => {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("privacy_zones").insert({
      user_id: userId,
      name: parsed.data.name,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      radius: parsed.data.radius,
      is_active: true
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: "Privacy Zone created." };
  });
}

export async function updateGhostModeProAction(input: unknown): Promise<PremiumActionState> {
  const parsed = ghostModeSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Choose a valid Ghost Mode Pro setting." };
  }

  return withPremiumAccess("buddy_pro", async (userId) => {
    const supabase = await createSupabaseServerClient();
    const scheduledVisibility = {
      type: parsed.data.type,
      quietHours: parsed.data.quietHours || null,
      updatedAt: new Date().toISOString()
    };
    const { error } = await supabase.from("user_preferences").upsert({
      user_id: userId,
      ghost_mode_type: parsed.data.type,
      scheduled_visibility: scheduledVisibility
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: "Ghost Mode Pro schedule saved." };
  });
}

export async function createEventModeAction(input: unknown): Promise<PremiumActionState> {
  const parsed = eventModeSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Check the Event Mode name and time window." };
  }

  return withPremiumAccess("buddy_pro", async (userId) => {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("event_modes").insert({
      user_id: userId,
      name: parsed.data.name,
      starts_at: parsed.data.startsAt,
      ends_at: parsed.data.endsAt,
      visibility_rule: parsed.data.visibilityRule,
      is_active: true
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: "Event Mode saved." };
  });
}
