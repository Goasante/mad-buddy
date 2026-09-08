"use server";

import { z } from "zod";

import { getEventForViewer } from "@/lib/events/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserRecord } from "@/lib/supabase/auth";

const uuidSchema = z.string().uuid();

type RefreshEventCoverResult = {
  ok: boolean;
  coverUrl: string | null;
};

/**
 * Renews one Event cover after its short-lived Storage URL expires.
 *
 * This is deliberately authoritative rather than claims-only: the action is
 * rare (only on expiry/error), so paying one current-user check is preferable
 * to letting a deleted or globally-signed-out account mint fresh credentials
 * for a restricted Event. Event visibility is re-evaluated through the same
 * getEventForViewer authority used by direct Event opening.
 */
export async function refreshEventCoverUrlAction(eventId: string): Promise<RefreshEventCoverResult> {
  if (!uuidSchema.safeParse(eventId).success) return { ok: false, coverUrl: null };

  const user = await getCurrentUserRecord();
  if (!user) return { ok: false, coverUrl: null };

  const access = await getEventForViewer(eventId, user.id);
  if (!access.ok) return { ok: false, coverUrl: null };

  const admin = createSupabaseAdminClient();

  /*
   * Credential minting gets one additional fail-closed block read.
   *
   * getEventForViewer is the canonical Event-access authority, but its shared
   * block helper currently returns a boolean and cannot distinguish "no block"
   * from "the block table could not be read". That is acceptable for ordinary
   * presentation fallback, but not for minting a fresh signed Storage URL: if
   * the block authority is temporarily unavailable, the safe result is no new
   * credential. This rare renewal path can afford the extra read.
   */
  if (!access.isHost) {
    const { data: blocks, error: blockError } = await admin
      .from("blocked_users")
      .select("blocker_id")
      .or(
        `and(blocker_id.eq.${user.id},blocked_id.eq.${access.event.host_id}),and(blocker_id.eq.${access.event.host_id},blocked_id.eq.${user.id})`
      )
      .limit(1);
    if (blockError || blocks?.length) return { ok: false, coverUrl: null };
  }

  const { data: event, error } = await admin
    .from("events")
    .select("cover_media_id")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !event?.cover_media_id) return { ok: true, coverUrl: null };

  const { signMediaForAsset } = await import("@/lib/content/service");
  const coverUrl = await signMediaForAsset(admin, event.cover_media_id, "feed");
  return coverUrl ? { ok: true, coverUrl } : { ok: false, coverUrl: null };
}
