import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

export type EventShareMetadata = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  visibility: string;
  coverMediaId: string | null;
};

export function eventMetadataMayDisclose(event: Pick<EventShareMetadata, "status" | "visibility">): boolean {
  return event.status !== "draft" && (event.visibility === "public" || event.visibility === "link");
}

export async function loadEventShareMetadata(eventId: string): Promise<EventShareMetadata | null> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey || !/^[0-9a-f-]{36}$/i.test(eventId)) return null;
  const { data } = await createSupabaseAdminClient()
    .from("events")
    .select("id, name, description, status, visibility, cover_media_id")
    .eq("id", eventId)
    .maybeSingle();
  return data
    ? {
        id: data.id,
        name: data.name,
        description: data.description,
        status: data.status,
        visibility: data.visibility,
        coverMediaId: data.cover_media_id
      }
    : null;
}
