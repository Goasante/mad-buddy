import { NextResponse } from "next/server";

import { signMediaForAsset } from "@/lib/content/service";
import { eventMetadataMayDisclose, loadEventShareMetadata } from "@/lib/events/share-metadata";
import { absoluteUrl } from "@/lib/seo";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const event = await loadEventShareMetadata(eventId);
  let destination = absoluteUrl("/brand/mad-buddy-social-share.jpg");

  // A public or unlisted Event may disclose its moderated cover. Restricted
  // audiences deliberately receive the brand fallback, never private media.
  if (event && eventMetadataMayDisclose(event) && event.coverMediaId) {
    const signed = await signMediaForAsset(createSupabaseAdminClient(), event.coverMediaId, "feed");
    if (signed) destination = signed;
  }

  const response = NextResponse.redirect(destination, 307);
  response.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  return response;
}
