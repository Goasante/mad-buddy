import "server-only";

import { z } from "zod";

import { MAX_INTERESTS, diffInterests, validateInterestSelection } from "@/lib/profile/interests";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Profile interests, as a transport-agnostic service.
 *
 * Extracted from app/(app)/profile-interests-actions.ts so the native app can
 * reach the same behaviour through /api/profile/interests. The web Server
 * Action and the route handler both call this, so the taxonomy check and the
 * add-before-remove ordering are one implementation rather than two that
 * resemble each other.
 *
 * Authentication stays with the caller (a Server Action resolves the session,
 * a route uses resolveApiUser); this is handed the userId the caller proved
 * and does its own scoping against it.
 */
export type ProfileInterestsResult = { ok: boolean; message: string };

/* Moved verbatim. The per-string cap and the generous array bound are a cheap
   first gate before validateInterestSelection does the real taxonomy check:
   they stop an oversized payload being parsed at all, without second-guessing
   what counts as a valid interest. */
const selectionSchema = z.object({
  interests: z.array(z.string().max(60)).max(MAX_INTERESTS * 4)
});

export async function setProfileInterests(
  admin: Admin,
  userId: string,
  input: unknown
): Promise<ProfileInterestsResult> {
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Not available." };

  /* Validated against the closed taxonomy, on the server. The picker only
   * offers canonical values, but the picker is not what protects this: an
   * arbitrary string here would become display text on a profile. */
  const selection = validateInterestSelection(parsed.data.interests);
  if (!selection.ok) return { ok: false, message: selection.error.message };

  /* No `guardAction` here. The enforcement gate covers surfaces where a
   * restricted account can reach other people — messaging, plans, Linkr,
   * media uploads. Choosing from a fixed list of sixteen words on your own
   * profile reaches nobody, and there is no "profile" surface in
   * `GuardedSurface` to guard it with. Inventing one to look thorough would
   * add a moderation concept the product does not have. */

  const { data: existing, error: readError } = await admin
    .from("user_interests")
    .select("interest")
    .eq("user_id", userId);

  if (readError) return { ok: false, message: "Couldn't save your interests. Try again." };

  const current = (existing ?? []).map((row) => row.interest);
  const { add, remove } = diffInterests(current, selection.interests);

  if (add.length === 0 && remove.length === 0) return { ok: true, message: "Saved." };

  /* Additions first. If this fails the profile still has everything it had,
   * which is the safer half-applied state than having deleted first.
   *
   * Deliberately NOT one transaction, unlike the photo reorder: there is no
   * constraint forcing a parking value here, and the two orderings differ only
   * in which half-applied state a failure leaves behind. Adding first leaves a
   * superset of what the person chose, which is recoverable by saving again;
   * deleting first could lose interests they still wanted. */
  if (add.length > 0) {
    const { error } = await admin
      .from("user_interests")
      .insert(add.map((interest) => ({ user_id: userId, interest })));
    if (error) return { ok: false, message: "Couldn't save your interests. Try again." };
  }

  if (remove.length > 0) {
    const { error } = await admin
      .from("user_interests")
      .delete()
      .eq("user_id", userId)
      .in("interest", remove);
    if (error) return { ok: false, message: "Couldn't save your interests. Try again." };
  }

  return { ok: true, message: "Saved." };
}
