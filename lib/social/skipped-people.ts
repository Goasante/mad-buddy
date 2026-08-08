import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import type { SkippedPerson } from "@/lib/social/skipped-people-shared";

/**
 * People this viewer skipped in Linkr discovery, so a mistaken swipe is
 * recoverable.
 *
 * The in-deck undo only ever held the LAST pass, in React state: reloading the
 * page, navigating away or skipping someone else lost it, and the person was
 * then unreachable for the full 30 days. The rows were always there; there was
 * simply no way to look at them.
 *
 * STRICTLY THE VIEWER'S OWN ROWS. `user_id = viewer` is the only way in, which
 * is the same asymmetry the RLS policies enforce: there is no query here, or
 * anywhere, that answers "who skipped me".
 *
 * Returns the same public profile fields discovery already shows — name,
 * username, avatar. Deliberately NOT presence, proximity or activity: those
 * describe where someone is right now, and a skipped person is not someone the
 * viewer is currently being shown. Recovering a card must not become a way to
 * watch somebody.
 */


export async function loadSkippedPeople(viewerId: string, limit = 30): Promise<SkippedPerson[]> {
  const admin = createSupabaseAdminClient();

  const { data: passes } = await admin
    .from("discovery_passes")
    .select("passed_user_id, expires_at")
    .eq("user_id", viewerId)
    // Expired skips are already gone from the feed's point of view, so listing
    // them would offer to undo something that no longer applies.
    .gt("expires_at", new Date().toISOString())
    // Most recent first: a mistake is almost always the last thing you did.
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!passes?.length) return [];

  const passedIds = passes.map((pass) => pass.passed_user_id);
  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, full_name, username, avatar_url")
    .in("user_id", passedIds);

  const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));

  const people: SkippedPerson[] = [];
  for (const pass of passes) {
    const profile = profileById.get(pass.passed_user_id);
    // A deleted account leaves the pass row behind briefly; skip it rather
    // than rendering a nameless entry.
    if (!profile) continue;
    people.push({
      userId: pass.passed_user_id,
      displayName: profile.full_name?.trim() || profile.username,
      username: profile.username,
      avatarUrl: profile.avatar_url,
      expiresAt: pass.expires_at
    });
  }

  return people;
}
