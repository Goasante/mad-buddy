"use server";

import { z } from "zod";
import { type FieldVisibility, type ProfileField } from "@/lib/profile/rules";
import { loadFieldPrivacy } from "@/lib/profile/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ProfileActionState = { ok: boolean; message: string };

export type ProfileDetails = {
  bio: string;
  institution: string;
  programme: string;
  graduationYear: number | null;
  generalArea: string;
  pronouns: string;
  interests: string[];
  privacy: Record<ProfileField, FieldVisibility>;
};

async function getAuthedUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

export async function getProfileDetailsAction(): Promise<ProfileDetails | null> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return null;
  const userId = await getAuthedUserId();
  if (!userId) return null;

  const admin = createSupabaseAdminClient();
  const [{ data: profile }, { data: interests }, privacy] = await Promise.all([
    admin
      .from("profiles")
      .select("bio, institution, programme, graduation_year, general_area, pronouns")
      .eq("user_id", userId)
      .maybeSingle(),
    admin.from("user_interests").select("interest").eq("user_id", userId),
    loadFieldPrivacy(admin, userId)
  ]);

  return {
    bio: profile?.bio ?? "",
    institution: profile?.institution ?? "",
    programme: profile?.programme ?? "",
    graduationYear: profile?.graduation_year ?? null,
    generalArea: profile?.general_area ?? "",
    pronouns: profile?.pronouns ?? "",
    interests: (interests ?? []).map((row) => row.interest),
    privacy
  };
}

const detailsSchema = z.object({
  bio: z.string().max(300).optional(),
  institution: z.string().max(120).optional(),
  programme: z.string().max(120).optional(),
  graduationYear: z.number().int().min(1980).max(2100).nullable().optional(),
  generalArea: z.string().max(80).optional(),
  pronouns: z.string().max(40).optional(),
  interests: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  privacy: z
    .record(
      z.enum(["bio", "institution", "programme", "graduation_year", "general_area", "interests", "pronouns"]),
      z.enum(["only_me", "approved_muddies", "close_friends", "shared_communities"])
    )
    .optional()
});

/** Saves batch-9 profile fields plus their per-field audience (spec §12). */
export async function updateProfileDetailsAction(input: unknown): Promise<ProfileActionState> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return { ok: false, message: "This action needs the server database configuration." };
  }

  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check your profile details and try again." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const profileUpdates: {
    bio?: string | null;
    institution: string | null;
    programme: string | null;
    graduation_year: number | null;
    general_area: string | null;
    pronouns: string | null;
  } = {
    institution: parsed.data.institution?.trim() || null,
    programme: parsed.data.programme?.trim() || null,
    graduation_year: parsed.data.graduationYear ?? null,
    general_area: parsed.data.generalArea?.trim() || null,
    pronouns: parsed.data.pronouns?.trim() || null
  };

  // Bio is edited in the main profile form. Do not erase it when this
  // optional-details form submits without a bio field.
  if (parsed.data.bio !== undefined) {
    profileUpdates.bio = parsed.data.bio.trim() || null;
  }

  const { error } = await admin
    .from("profiles")
    .update(profileUpdates)
    .eq("user_id", userId);
  if (error) return { ok: false, message: "Couldn't save your profile." };

  if (parsed.data.interests) {
    const unique = [...new Set(parsed.data.interests.map((interest) => interest.trim()))].filter(Boolean);
    await admin.from("user_interests").delete().eq("user_id", userId);
    if (unique.length > 0) {
      await admin.from("user_interests").insert(unique.map((interest) => ({ user_id: userId, interest })));
    }
  }

  if (parsed.data.privacy) {
    const rows = Object.entries(parsed.data.privacy).map(([field, visibility]) => ({
      user_id: userId,
      field_name: field as ProfileField,
      visibility,
      updated_at: nowIso
    }));
    if (rows.length > 0) {
      await admin.from("profile_field_privacy").upsert(rows, { onConflict: "user_id,field_name" });
    }
  }

  return { ok: true, message: "Profile saved." };
}
