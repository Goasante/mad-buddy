import "server-only";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_FIELD_PRIVACY,
  resolveFieldVisibility,
  type FieldVisibility,
  type ProfileField
} from "@/lib/profile/rules";
import type { ViewerRelationship } from "@/lib/profile/rules";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type VisibleProfileFields = {
  bio: string | null;
  institution: string | null;
  programme: string | null;
  graduationYear: number | null;
  generalArea: string | null;
  pronouns: string | null;
  interests: string[] | null;
};

export async function loadFieldPrivacy(admin: Admin, userId: string): Promise<Record<ProfileField, FieldVisibility>> {
  const { data } = await admin
    .from("profile_field_privacy")
    .select("field_name, visibility")
    .eq("user_id", userId);
  const privacy = { ...DEFAULT_FIELD_PRIVACY };
  for (const row of data ?? []) {
    if (row.field_name in privacy) {
      privacy[row.field_name as ProfileField] = row.visibility as FieldVisibility;
    }
  }
  return privacy;
}

/** Resolves the viewer's relationship to a target for field visibility. */
export async function resolveViewerRelationship(
  admin: Admin,
  viewerId: string,
  targetId: string
): Promise<ViewerRelationship> {
  if (viewerId === targetId) return "self";

  const { data: closeFriend } = await admin
    .from("close_friend_relationships")
    .select("id")
    .eq("owner_id", targetId)
    .eq("friend_id", viewerId)
    .maybeSingle();
  if (closeFriend) return "close_friend";

  const [a, b] = viewerId < targetId ? [viewerId, targetId] : [targetId, viewerId];
  const { data: friendship } = await admin
    .from("friendships")
    .select("id")
    .eq("user_one_id", a)
    .eq("user_two_id", b)
    .is("ended_at", null)
    .maybeSingle();
  if (friendship) return "approved_muddy";

  const [{ data: viewerProfile }, { data: targetProfile }] = await Promise.all([
    admin.from("profiles").select("institution").eq("user_id", viewerId).maybeSingle(),
    admin.from("profiles").select("institution").eq("user_id", targetId).maybeSingle()
  ]);
  if (
    viewerProfile?.institution &&
    targetProfile?.institution &&
    viewerProfile.institution.trim().toLowerCase() === targetProfile.institution.trim().toLowerCase()
  ) {
    return "shared_community";
  }

  return "stranger";
}

/**
 * The batch-9 fields of `targetId` that a viewer with `relationship` may see
 * (spec §12). Hidden fields come back null, they never leave the server.
 */
export async function getVisibleProfileFields(
  admin: Admin,
  targetId: string,
  relationship: ViewerRelationship
): Promise<VisibleProfileFields> {
  const [{ data: profile }, { data: interests }, privacy] = await Promise.all([
    admin
      .from("profiles")
      .select("bio, institution, programme, graduation_year, general_area, pronouns")
      .eq("user_id", targetId)
      .maybeSingle(),
    admin.from("user_interests").select("interest").eq("user_id", targetId),
    loadFieldPrivacy(admin, targetId)
  ]);

  const can = (field: ProfileField) => resolveFieldVisibility({ visibility: privacy[field], relationship });

  return {
    bio: can("bio") ? (profile?.bio ?? null) : null,
    institution: can("institution") ? (profile?.institution ?? null) : null,
    programme: can("programme") ? (profile?.programme ?? null) : null,
    graduationYear: can("graduation_year") ? (profile?.graduation_year ?? null) : null,
    generalArea: can("general_area") ? (profile?.general_area ?? null) : null,
    pronouns: can("pronouns") ? (profile?.pronouns ?? null) : null,
    interests: can("interests") ? (interests ?? []).map((row) => row.interest) : null
  };
}

// ---------------------------------------------------------------------------
// Core profile edit (name / username / bio / mood)
// ---------------------------------------------------------------------------

export type ProfileUpdateResult = { ok: boolean; message: string };

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Display name is too short.").max(80),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_]+$/),
  bio: z.string().trim().max(160).optional(),
  moodStatus: z.string().trim().max(80).optional()
});

/**
 * Update the core profile fields. Takes an already-authenticated `userId` and
 * the caller's RLS-scoped client (cookie for web, bearer for mobile) so the
 * profile row is self-owned. Shared by `updateProfileAction` and `/api/profile`;
 * `revalidatePath` stays in the web wrapper.
 */
export async function updateProfile(
  rlsClient: SupabaseClient<Database>,
  userId: string,
  input: unknown
): Promise<ProfileUpdateResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check your profile fields and try again." };
  }

  const { data: savedProfile, error } = await rlsClient
    .from("profiles")
    .upsert(
      {
        user_id: userId,
        full_name: parsed.data.fullName,
        username: parsed.data.username,
        username_normalized: parsed.data.username,
        bio: parsed.data.bio ?? null,
        mood_status: parsed.data.moodStatus ?? null
      },
      { onConflict: "user_id" }
    )
    .select("user_id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "That username is already in use." };
    }
    return { ok: false, message: "Couldn't update your profile. Try again." };
  }

  if (!savedProfile) {
    return { ok: false, message: "Couldn't update your profile. Try again." };
  }

  return { ok: true, message: "Profile updated." };
}
