"use server";

import { z } from "zod";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { areApprovedMuddies, isBlockedEitherDirection } from "@/lib/social/permissions";
import { tierLimitsFor, validateCircleName } from "@/lib/social/visibility";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { VisibilityFeatureType, VisibilityMode } from "@/lib/supabase/database.types";

export type CircleActionState = {
  ok: boolean;
  message: string;
  circleId?: string;
};

const uuidSchema = z.string().uuid();

function missingEnvState(): CircleActionState | null {
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

// ---------------------------------------------------------------------------
// Circles (spec §5-§7, §14)
// ---------------------------------------------------------------------------

const createCircleSchema = z.object({
  name: z.string(),
  icon: z.string().max(40).optional(),
  theme: z.string().max(20).optional(),
  memberIds: z.array(uuidSchema).max(200).optional()
});

export async function createCircleAction(input: unknown): Promise<CircleActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = createCircleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the circle details and try again." };

  const nameError = validateCircleName(parsed.data.name);
  if (nameError) return { ok: false, message: nameError };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before creating a circle." };

  const admin = createSupabaseAdminClient();
  const access = await getCurrentSubscriptionAccess(userId);
  const limits = tierLimitsFor(access.plan);

  const { count: circleCount } = await admin
    .from("friend_circles")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("archived_at", null);

  if ((circleCount ?? 0) >= limits.maxPersonalCircles) {
    return {
      ok: false,
      message:
        access.plan === "free"
          ? "Free plan allows up to 3 circles. Upgrade for more."
          : "You've reached your circle limit."
    };
  }

  const requestedMembers = [...new Set(parsed.data.memberIds ?? [])].filter((id) => id !== userId);
  if (requestedMembers.length > limits.maxCircleMembers) {
    return { ok: false, message: `Circles can have up to ${limits.maxCircleMembers} Muddies on your plan.` };
  }

  // Only mutually approved, unblocked Muddies may be added (spec §7, §13).
  const eligibleMembers: string[] = [];
  for (const memberId of requestedMembers) {
    const [mutual, blocked] = await Promise.all([
      areApprovedMuddies(admin, userId, memberId),
      isBlockedEitherDirection(admin, userId, memberId)
    ]);
    if (mutual && !blocked) eligibleMembers.push(memberId);
  }

  const { data: circle, error } = await admin
    .from("friend_circles")
    .insert({
      user_id: userId,
      name: parsed.data.name.trim(),
      icon: parsed.data.icon ?? null,
      theme: parsed.data.theme ?? null
    })
    .select("id")
    .single();

  if (error || !circle) return { ok: false, message: "Couldn't create the circle. Try again." };

  if (eligibleMembers.length > 0) {
    await admin.from("circle_members").insert(
      eligibleMembers.map((memberId) => ({
        circle_id: circle.id,
        friend_id: memberId,
        added_by: userId
      }))
    );
  }

  return {
    ok: true,
    message: `${parsed.data.name.trim()} created with ${eligibleMembers.length} ${
      eligibleMembers.length === 1 ? "Muddy" : "Muddies"
    }.`,
    circleId: circle.id
  };
}

async function assertCircleOwner(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  circleId: string,
  userId: string
) {
  const { data } = await admin
    .from("friend_circles")
    .select("id, archived_at")
    .eq("id", circleId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

export async function renameCircleAction(circleId: string, name: string): Promise<CircleActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(circleId).success) return { ok: false, message: "Circle not found." };

  const nameError = validateCircleName(name);
  if (nameError) return { ok: false, message: nameError };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const circle = await assertCircleOwner(admin, circleId, userId);
  if (!circle) return { ok: false, message: "Circle not found." };

  const { error } = await admin
    .from("friend_circles")
    .update({ name: name.trim(), updated_at: new Date().toISOString() })
    .eq("id", circleId)
    .eq("user_id", userId);
  if (error) return { ok: false, message: "Couldn't rename the circle." };
  return { ok: true, message: "Circle renamed." };
}

export async function addCircleMembersAction(
  circleId: string,
  memberIds: string[]
): Promise<CircleActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(circleId).success) return { ok: false, message: "Circle not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const circle = await assertCircleOwner(admin, circleId, userId);
  if (!circle) return { ok: false, message: "Circle not found." };
  if (circle.archived_at) return { ok: false, message: "This circle is archived." };

  const access = await getCurrentSubscriptionAccess(userId);
  const limits = tierLimitsFor(access.plan);

  const { count: currentMembers } = await admin
    .from("circle_members")
    .select("id", { count: "exact", head: true })
    .eq("circle_id", circleId);

  const wanted = [...new Set(memberIds)].filter((id) => id !== userId);
  const eligible: string[] = [];
  for (const memberId of wanted) {
    if (!uuidSchema.safeParse(memberId).success) continue;
    const [mutual, blocked] = await Promise.all([
      areApprovedMuddies(admin, userId, memberId),
      isBlockedEitherDirection(admin, userId, memberId)
    ]);
    if (mutual && !blocked) eligible.push(memberId);
  }

  if ((currentMembers ?? 0) + eligible.length > limits.maxCircleMembers) {
    return { ok: false, message: `Circles can have up to ${limits.maxCircleMembers} Muddies on your plan.` };
  }
  if (eligible.length === 0) return { ok: false, message: "Add approved Muddies only." };

  const { error } = await admin.from("circle_members").upsert(
    eligible.map((memberId) => ({ circle_id: circleId, friend_id: memberId, added_by: userId })),
    { onConflict: "circle_id,friend_id" }
  );
  if (error) return { ok: false, message: "Couldn't add those Muddies." };
  return { ok: true, message: `Added ${eligible.length} to the circle.` };
}

export async function removeCircleMemberAction(
  circleId: string,
  memberId: string
): Promise<CircleActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(circleId).success || !uuidSchema.safeParse(memberId).success) {
    return { ok: false, message: "Not found." };
  }

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const circle = await assertCircleOwner(admin, circleId, userId);
  if (!circle) return { ok: false, message: "Circle not found." };

  // Removing from a circle never affects the underlying friendship (spec §7).
  const { error } = await admin
    .from("circle_members")
    .delete()
    .eq("circle_id", circleId)
    .eq("friend_id", memberId);
  if (error) return { ok: false, message: "Couldn't remove that Muddy." };
  return { ok: true, message: "Removed from the circle. You're still Muddies." };
}

export async function archiveCircleAction(circleId: string): Promise<CircleActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(circleId).success) return { ok: false, message: "Circle not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const circle = await assertCircleOwner(admin, circleId, userId);
  if (!circle) return { ok: false, message: "Circle not found." };

  // Archive rather than hard-delete (spec §14); friendships remain.
  const { error } = await admin
    .from("friend_circles")
    .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", circleId)
    .eq("user_id", userId);
  if (error) return { ok: false, message: "Couldn't archive the circle." };
  return { ok: true, message: "Circle archived. Your Muddies remain connected." };
}

// ---------------------------------------------------------------------------
// Close Friends (spec §39-§46)
// ---------------------------------------------------------------------------

export async function addCloseFriendAction(friendId: string): Promise<CircleActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(friendId).success) return { ok: false, message: "Choose a Muddy." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  if (userId === friendId) return { ok: false, message: "You can't add yourself." };

  const admin = createSupabaseAdminClient();
  const [mutual, blocked] = await Promise.all([
    areApprovedMuddies(admin, userId, friendId),
    isBlockedEitherDirection(admin, userId, friendId)
  ]);
  if (!mutual || blocked) return { ok: false, message: "You can only add approved Muddies." };

  const access = await getCurrentSubscriptionAccess(userId);
  const limits = tierLimitsFor(access.plan);
  const { count } = await admin
    .from("close_friend_relationships")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);

  if ((count ?? 0) >= limits.maxCloseFriends) {
    return {
      ok: false,
      message:
        access.plan === "free"
          ? "Free plan allows up to 8 Close Friends. Upgrade for more."
          : "You've reached your Close Friends limit."
    };
  }

  // Private and one-sided: the friend is never notified (spec §37, §39).
  const { error } = await admin
    .from("close_friend_relationships")
    .upsert({ owner_id: userId, friend_id: friendId }, { onConflict: "owner_id,friend_id" });
  if (error) return { ok: false, message: "Couldn't update Close Friends." };
  return { ok: true, message: "Added to Close Friends. This stays private." };
}

export async function removeCloseFriendAction(friendId: string): Promise<CircleActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(friendId).success) return { ok: false, message: "Not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("close_friend_relationships")
    .delete()
    .eq("owner_id", userId)
    .eq("friend_id", friendId);
  if (error) return { ok: false, message: "Couldn't update Close Friends." };
  return { ok: true, message: "Removed from Close Friends." };
}

// ---------------------------------------------------------------------------
// Circle Visibility sessions (spec §22, §28)
// ---------------------------------------------------------------------------

const startSessionSchema = z.object({
  featureType: z.enum(["glow", "status", "wave", "meeting_ping"]).default("glow"),
  visibilityMode: z.enum(["all_muddies", "selected_circles", "close_friends", "hidden"]),
  circleIds: z.array(uuidSchema).max(100).optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional()
});

export async function startVisibilitySessionAction(input: unknown): Promise<CircleActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = startSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the visibility options and try again." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  if (parsed.data.endsAt) {
    const endsMs = Date.parse(parsed.data.endsAt);
    if (!Number.isFinite(endsMs) || endsMs <= Date.now()) {
      return { ok: false, message: "Choose an end time in the future." };
    }
    if (endsMs - Date.now() > 7 * 24 * 60 * 60 * 1000) {
      return { ok: false, message: "Visibility sessions can last at most a week." };
    }
  }

  const admin = createSupabaseAdminClient();
  const featureType = parsed.data.featureType as VisibilityFeatureType;

  // End any existing active session for this feature (one active per feature).
  await admin
    .from("visibility_sessions")
    .update({ status: "ended", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("feature_type", featureType)
    .eq("status", "active");

  const { data: session, error } = await admin
    .from("visibility_sessions")
    .insert({
      user_id: userId,
      feature_type: featureType,
      visibility_mode: parsed.data.visibilityMode as VisibilityMode,
      ends_at: parsed.data.endsAt ?? null,
      source: "manual",
      status: "active"
    })
    .select("id")
    .single();

  if (error || !session) return { ok: false, message: "Couldn't update visibility." };

  if (parsed.data.visibilityMode === "selected_circles" && parsed.data.circleIds?.length) {
    // Only the user's own, non-archived circles can be an audience.
    const { data: ownedCircles } = await admin
      .from("friend_circles")
      .select("id")
      .eq("user_id", userId)
      .is("archived_at", null)
      .in("id", parsed.data.circleIds);
    const validIds = (ownedCircles ?? []).map((circle) => circle.id);
    if (validIds.length > 0) {
      await admin.from("visibility_targets").insert(
        validIds.map((circleId) => ({
          session_id: session.id,
          target_type: "circle" as const,
          target_id: circleId,
          access_type: "include" as const
        }))
      );
    }
  }

  const message =
    parsed.data.visibilityMode === "hidden"
      ? "You're hidden now."
      : parsed.data.endsAt
        ? `Visibility updated until ${new Date(parsed.data.endsAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit"
          })}.`
        : "Visibility updated.";
  return { ok: true, message };
}

export async function endVisibilitySessionAction(
  featureType: VisibilityFeatureType = "glow"
): Promise<CircleActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  await admin
    .from("visibility_sessions")
    .update({ status: "ended", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("feature_type", featureType)
    .eq("status", "active");
  return { ok: true, message: "Back to your default visibility." };
}
