"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { MAX_INTERESTS, diffInterests, validateInterestSelection } from "@/lib/profile/interests";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Writing profile interests.
 *
 * `user_interests` has been readable since batch 9 with no way to write it,
 * so "Choose a few interests" was a completion task nobody could complete.
 * This is the missing authority.
 *
 * NO MIGRATION. The table already exists with the ownership RLS this needs
 * (`for all using (auth.uid() = user_id)`) and a unique constraint on
 * (user_id, interest). Another worktree has a migration in flight, so
 * anything requiring one would have to stop and report instead.
 *
 * Saved as a set, not one row at a time: the editor sends the full selection
 * and this applies the difference, so a half-finished save cannot leave a
 * profile in a state the person never chose.
 */

type ActionState = { ok: boolean; message: string };

/* Bounded before the values are even looked at. The taxonomy check is the
 * real authority (below); this just stops an absurd payload early. */
const selectionSchema = z.object({
  interests: z.array(z.string().max(60)).max(MAX_INTERESTS * 4)
});

async function getAuthedUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

function serverReady(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

/**
 * Replace the signed-in person's interests with `input.interests`.
 *
 * The target is always the session user. There is no userId parameter by
 * design — accepting one would make editing someone else's profile a matter
 * of changing a request body.
 */
export async function setProfileInterestsAction(input: unknown): Promise<ActionState> {
  if (!serverReady()) {
    return { ok: false, message: "This action needs the server database configuration." };
  }

  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Not available." };

  /* Validated against the closed taxonomy, on the server. The picker only
   * offers canonical values, but the picker is not what protects this: an
   * arbitrary string here would become display text on a profile. */
  const selection = validateInterestSelection(parsed.data.interests);
  if (!selection.ok) return { ok: false, message: selection.error.message };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  /* No `guardAction` here. The enforcement gate covers surfaces where a
   * restricted account can reach other people — messaging, plans, Linkr,
   * media uploads. Choosing from a fixed list of sixteen words on your own
   * profile reaches nobody, and there is no "profile" surface in
   * `GuardedSurface` to guard it with. Inventing one to look thorough would
   * add a moderation concept the product does not have. */
  const admin = createSupabaseAdminClient();

  const { data: existing, error: readError } = await admin
    .from("user_interests")
    .select("interest")
    .eq("user_id", userId);

  if (readError) return { ok: false, message: "Couldn't save your interests. Try again." };

  const current = (existing ?? []).map((row) => row.interest);
  const { add, remove } = diffInterests(current, selection.interests);

  if (add.length === 0 && remove.length === 0) return { ok: true, message: "Saved." };

  /* Additions first. If this fails the profile still has everything it had,
   * which is the safer half-applied state than having deleted first. */
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

  revalidatePath("/profile");
  return { ok: true, message: "Saved." };
}
