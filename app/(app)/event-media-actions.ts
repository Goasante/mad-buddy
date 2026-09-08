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
