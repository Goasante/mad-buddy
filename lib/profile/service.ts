import "server-only";

import {
  DEFAULT_FIELD_PRIVACY,
  resolveFieldVisibility,
  type FieldVisibility,
  type ProfileField
} from "@/lib/profile/rules";
import type { ViewerRelationship } from "@/lib/profile/rules";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
 * (spec §12). Hidden fields come back null — they never leave the server.
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
