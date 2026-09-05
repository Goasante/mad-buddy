import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_FIELD_PRIVACY,
  resolveFieldVisibility,
  type FieldVisibility,
  type ProfileField
} from "@/lib/profile/rules";
import type { ViewerRelationship } from "@/lib/profile/rules";
import type { Database } from "@/lib/supabase/database.types";
import { dateKeyInTimeZone, deriveBirthProfile, projectDerivedBirthProfile } from "@/lib/profile/birth-date";
import { saveDateOfBirth } from "@/lib/profile/date-of-birth-service";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";
import { recordProductEvent } from "@/lib/analytics/track";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type VisibleProfileFields = {
  bio: string | null;
  institution: string | null;
  programme: string | null;
  graduationYear: number | null;
  generalArea: string | null;
  pronouns: string | null;
  interests: string[] | null;
  age: number | null;
  zodiacSign: string | null;
  birthdayToday: boolean;
  birthdayTomorrow: boolean;
  birthdayCountdownDays: number | null;
  nextBirthdayDate: string | null;
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
  const [{ data: profile }, { data: interests }, { data: birthDetails }, privacy] = await Promise.all([
    admin
      .from("profiles")
      .select("bio, institution, programme, graduation_year, general_area, pronouns")
      .eq("user_id", targetId)
      .maybeSingle(),
    admin.from("user_interests").select("interest").eq("user_id", targetId),
    admin.from("profile_birth_details").select("date_of_birth").eq("user_id", targetId).maybeSingle(),
    loadFieldPrivacy(admin, targetId)
  ]);

  const can = (field: ProfileField) => resolveFieldVisibility({ visibility: privacy[field], relationship });

  const derived = birthDetails?.date_of_birth
    ? deriveBirthProfile(
        birthDetails.date_of_birth,
        dateKeyInTimeZone(new Date(), DEFAULT_RECIPIENT_TIMEZONE)
      )
    : null;
  const projectedBirth = projectDerivedBirthProfile(derived, {
    birthday: can("birthday"),
    age: can("age"),
    zodiac: can("zodiac")
  });

  return {
    bio: can("bio") ? (profile?.bio ?? null) : null,
    institution: can("institution") ? (profile?.institution ?? null) : null,
    programme: can("programme") ? (profile?.programme ?? null) : null,
    graduationYear: can("graduation_year") ? (profile?.graduation_year ?? null) : null,
    generalArea: can("general_area") ? (profile?.general_area ?? null) : null,
    pronouns: can("pronouns") ? (profile?.pronouns ?? null) : null,
    interests: can("interests") ? (interests ?? []).map((row) => row.interest) : null,
    ...projectedBirth
  };
}

// ---------------------------------------------------------------------------
// Core profile edit (name / username / bio / mood)
// ---------------------------------------------------------------------------

export type ProfileUpdateResult = {
  ok: boolean;
  message: string;
  dateOfBirthCanCorrect?: boolean;
};

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
  moodStatus: z.string().trim().max(80).optional(),
  dateOfBirth: z.string().trim().optional(),
  birthdayVisibility: z.enum(["only_me", "approved_muddies"]).optional(),
  ageVisibility: z.enum(["only_me", "approved_muddies"]).optional(),
  zodiacVisibility: z.enum(["only_me", "approved_muddies"]).optional()
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
  const birthSettingsWereSubmitted = parsed.data.dateOfBirth !== undefined;
  const [previousBirthResult, previousPrivacyResult] = birthSettingsWereSubmitted
    ? await Promise.all([
        rlsClient.from("profile_birth_details").select("date_of_birth").eq("user_id", userId).maybeSingle(),
        rlsClient
          .from("profile_field_privacy")
          .select("field_name, visibility")
          .eq("user_id", userId)
          .in("field_name", ["birthday", "age", "zodiac"])
      ])
    : [{ data: null }, { data: [] }];
  const previousDateOfBirth = previousBirthResult.data?.date_of_birth ?? "";
  const previousVisibility = new Map(
    (previousPrivacyResult.data ?? []).map((row) => [row.field_name, row.visibility])
  );

  /* UPDATE, not UPSERT.
   *
   * Editing a profile is not creating one. The upsert this replaced needed
   * table-level INSERT on `profiles` -- PostgreSQL requires it for ON CONFLICT
   * DO UPDATE even when every written column is granted individually -- so a
   * browser-role save failed 42501 and the bio silently never changed. Buying
   * that back with a table-wide INSERT grant would hand every signed-in person
   * authority over columns the owner policy does not scope (trusted_member_since
   * is granted by staff review; is_onboarded and deleted_at are written only by
   * the admin client), which is exactly what the column grants exist to prevent.
   *
   * Creating a missing profile is already somebody else's job:
   * ensureProfileForUser() does it through the admin client on dashboard load,
   * OAuth sign-in and the friend paths. Bootstrap creates, edit updates.
   *
   * user_id is deliberately absent from the payload -- it is the row's identity
   * and the owner filter, never an editable field. */
  const { data: savedProfile, error } = await rlsClient
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      username: parsed.data.username,
      username_normalized: parsed.data.username,
      bio: parsed.data.bio ?? null,
      mood_status: parsed.data.moodStatus ?? null
    })
    .eq("user_id", userId)
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

  let dateOfBirthCanCorrect: boolean | undefined;
  if (parsed.data.dateOfBirth !== undefined) {
    const dateOfBirth = parsed.data.dateOfBirth.trim();
    if (!dateOfBirth && previousDateOfBirth) {
      return { ok: false, message: "A saved date of birth can't be removed. Contact support if it is wrong." };
    }
    if (dateOfBirth) {
      const birthResult = await saveDateOfBirth(rlsClient, userId, dateOfBirth);
      if (!birthResult.ok) return { ok: false, message: birthResult.message };
      dateOfBirthCanCorrect = birthResult.canCorrect;
    }

    const visibilityRows = [
      { field_name: "birthday" as const, visibility: parsed.data.birthdayVisibility ?? "only_me" as const },
      { field_name: "age" as const, visibility: parsed.data.ageVisibility ?? "only_me" as const },
      { field_name: "zodiac" as const, visibility: parsed.data.zodiacVisibility ?? "only_me" as const }
    ].map((row) => ({ ...row, user_id: userId, updated_at: new Date().toISOString() }));
    const { error: privacyError } = await rlsClient
      .from("profile_field_privacy")
      .upsert(visibilityRows, { onConflict: "user_id,field_name" });
    if (privacyError) return { ok: false, message: "Couldn't save your birthday privacy choices. Try again." };

    const analytics: Array<{
      eventName:
        | "birth_date_added"
        | "birth_date_updated"
        | "birthday_visibility_changed"
        | "age_visibility_changed"
        | "zodiac_visibility_changed";
      resourceId: string;
    }> = [];
    if (!previousDateOfBirth && dateOfBirth) {
      analytics.push({ eventName: "birth_date_added", resourceId: userId });
    } else if (previousDateOfBirth && dateOfBirth && previousDateOfBirth !== dateOfBirth) {
      analytics.push({ eventName: "birth_date_updated", resourceId: randomUUID() });
    }
    const visibilityEvents = [
      ["birthday", parsed.data.birthdayVisibility, "birthday_visibility_changed"],
      ["age", parsed.data.ageVisibility, "age_visibility_changed"],
      ["zodiac", parsed.data.zodiacVisibility, "zodiac_visibility_changed"]
    ] as const;
    for (const [field, nextVisibility, eventName] of visibilityEvents) {
      if (nextVisibility && (previousVisibility.get(field) ?? "only_me") !== nextVisibility) {
        analytics.push({ eventName, resourceId: randomUUID() });
      }
    }
    if (analytics.length) {
      const admin = createSupabaseAdminClient();
      try {
        await Promise.all(
          analytics.map((event) =>
            recordProductEvent(admin, {
              eventName: event.eventName,
              actorId: userId,
              resourceType: "profile_birth_settings",
              resourceId: event.resourceId,
              featureKey: "profile"
            })
          )
        );
      } catch {
        // Analytics is compensating work. The profile, DOB and privacy rows
        // above are authoritative and a telemetry outage must not turn their
        // successful commit into an apparent save failure or correction retry.
      }
    }
  }

  return { ok: true, message: "Profile updated.", dateOfBirthCanCorrect };
}
