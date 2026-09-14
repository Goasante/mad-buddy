"use server";

import { revalidatePath } from "next/cache";

import {
  applyForTrustedMember,
  getTrustedMemberStanding,
  type TrustedMemberStanding
} from "@/lib/trust/application-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Applying to be a Trusted Member.
 *
 * The badge is APPLIED FOR, never granted automatically. Meeting the bar —
 * long premium tenure plus every journey — earns the right to ask; a human
 * still decides. That gap is what keeps it a mark of standing rather than
 * something a subscription buys.
 *
 * Eligibility is recomputed HERE at submit time rather than trusted from the
 * client. A page rendered an hour ago may have shown an Apply button that is
 * no longer honest.
 */

type ActionState = { ok: boolean; message: string };


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
 * The viewer's own standing: what they have, what is missing, where they are
 * in the queue. Read-only, and only ever about themselves.
 */
export async function getTrustedMemberStandingAction(): Promise<TrustedMemberStanding | null> {
  if (!serverReady()) return null;
  const userId = await getAuthedUserId();
  if (!userId) return null;

  /* The body of this read now lives in lib/trust/application-service.ts so
     that /api/trust/apply -- how the native app reaches this feature --
     computes standing the SAME way rather than through a copy. */
  return getTrustedMemberStanding(createSupabaseAdminClient(), userId);
}

/**
 * Submit an application.
 *
 * Upserts on the unique (user_id) constraint so re-applying after a decline
 * updates the existing row rather than queueing a second. The queue is a
 * queue, not a way to ask louder.
 */
export async function applyForTrustedMemberAction(input: unknown): Promise<ActionState> {
  if (!serverReady()) {
    return { ok: false, message: "This action needs the server database configuration." };
  }

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  /* Everything platform-specific stays here: resolving the session and
     revalidating the route, neither of which a Bearer-token API call has.
     The rate limit and the eligibility recomputation moved with the body. */
  const result = await applyForTrustedMember(createSupabaseAdminClient(), userId, input);
  if (result.ok) revalidatePath("/profile");
  return result;
}
