"use server";

import { revalidatePath } from "next/cache";

import { setProfileInterests } from "@/lib/profile/interests-service";
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

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  /* The body of this action now lives in lib/profile/interests-service.ts so
     that /api/profile/interests -- how the native app reaches this feature --
     runs the SAME code rather than a copy that looks alike. Everything
     platform-specific stays here: resolving the session and revalidating the
     route, neither of which a Bearer-token API call has. */
  const result = await setProfileInterests(createSupabaseAdminClient(), userId, input);
  if (result.ok) revalidatePath("/profile");
  return result;
}
