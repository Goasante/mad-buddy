"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { recordProductEvent } from "@/lib/analytics/track";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth";
import { TOUR_REPLAY_COOKIE, TOUR_REPLAY_MAX_AGE_SECONDS } from "@/lib/tours/replay";

// No type exports from a "use server" module.

const startSchema = z.object({ versionId: z.string().uuid() });

/**
 * Opens a manual replay session.
 *
 * The session is a cookie, not component state, because the tour's own
 * route-aware steps navigate away from whatever page started it. That is
 * precisely the bug this replaces: replay used to be mounted on
 * /settings/walkthrough, so step 1's push to /dashboard unmounted it.
 *
 * The cookie only names a version and grants nothing: the loader still requires
 * the version to be PUBLISHED, so this cannot be used to reach a draft.
 */
export async function startTourReplayAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Could not start the walkthrough." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Log in to replay the walkthrough." };

  const admin = createSupabaseAdminClient();
  // Published only. A replay must never become a way to view unpublished content.
  const { data: version } = await admin
    .from("tour_versions")
    .select("id")
    .eq("id", parsed.data.versionId)
    .eq("status", "published")
    .maybeSingle();
  if (!version) return { ok: false, message: "That walkthrough is not available." };

  const store = await cookies();
  store.set(TOUR_REPLAY_COOKIE, parsed.data.versionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TOUR_REPLAY_MAX_AGE_SECONDS
  });

  // Replay-specific event, so a revisit never inflates the first-time funnel.
  await recordProductEvent(admin, {
    eventName: "tour_replay_started",
    actorId: user.id,
    resourceType: "tour_version",
    resourceId: parsed.data.versionId,
    featureKey: "tours"
  });

  return { ok: true, message: "Walkthrough started." };
}

/**
 * Ends a replay session. Records completion as a REPLAY event and deliberately
 * writes no user_tour_progress, so the user's original first-time completion or
 * skip stays exactly as it was.
 */
export async function endTourReplayAction(input: unknown): Promise<{ ok: boolean }> {
  const parsed = z.object({ versionId: z.string().uuid(), completed: z.boolean() }).safeParse(input);
  const store = await cookies();
  store.delete(TOUR_REPLAY_COOKIE);

  if (!parsed.success || !parsed.data.completed) return { ok: true };

  const user = await getCurrentUser();
  if (!user) return { ok: true };

  await recordProductEvent(createSupabaseAdminClient(), {
    eventName: "tour_replay_completed",
    actorId: user.id,
    resourceType: "tour_version",
    resourceId: parsed.data.versionId,
    featureKey: "tours"
  });
  return { ok: true };
}
