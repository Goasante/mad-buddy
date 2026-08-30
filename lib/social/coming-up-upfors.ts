import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isComingUpUpFor } from "@/lib/social/upfor-lifecycle";
import { upForTitle } from "@/lib/social/upfor";
import type { ComingUpUpForSource } from "@/lib/social/coming-up";
import type { Database, HangoutActivityType } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

/**
 * The viewer's OWN scheduled UpFors, for Home's Coming Up.
 *
 * DELIBERATELY NOT A DISCOVERY READ. This answers "what have I got coming up",
 * so it is scoped to `owner_id = viewerId` and nothing else. It does not reuse
 * the discovery readers, does not consider audience or friendship, and can
 * never surface another person's scheduled intent -- which matters because a
 * scheduled UpFor is deliberately invisible to everyone else until it starts.
 *
 * The query narrows the candidates; `isComingUpUpFor` decides. That second
 * pass is not redundant: SQL alone would keep working if a new status were
 * added to the CHECK constraint, or if `paused` were ever written with a future
 * start, and Home would silently start listing things nobody is waiting for.
 * The canonical predicate is the authority, and the database is the index.
 */
export async function loadComingUpUpFors(
  admin: Admin,
  viewerId: string,
  nowMs: number = Date.now(),
  limit = 6
): Promise<ComingUpUpForSource[]> {
  const { data, error } = await admin
    .from("hangout_sessions")
    .select("id, activity_type, status, starts_at, ends_at")
    .eq("owner_id", viewerId)
    .eq("status", "active")
    .gt("starts_at", new Date(nowMs).toISOString())
    .order("starts_at", { ascending: true })
    .limit(limit);

  // A failed read must not blank the rest of Home. Coming Up simply shows the
  // Plans and Events it does have.
  if (error || !data) return [];

  return data
    .map((row) => ({
      id: row.id,
      title: upForTitle(row.activity_type as HangoutActivityType),
      status: row.status,
      startsAt: row.starts_at,
      endsAt: row.ends_at
    }))
    .filter((row) => isComingUpUpFor(row, nowMs));
}
