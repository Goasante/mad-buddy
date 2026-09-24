import { NextResponse } from "next/server";

import { signMediaForAsset } from "@/lib/content/service";
import { eventMetadataMayDisclose, loadEventShareMetadata } from "@/lib/events/share-metadata";
import { absoluteUrl } from "@/lib/seo";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const event = await loadEventShareMetadata(eventId);
  const destination = absoluteUrl("/brand/mad-buddy-social-share.jpg");

  // A public or unlisted Event may disclose its moderated cover. Restricted
  // audiences deliberately receive the brand fallback, never private media.
  if (event && eventMetadataMayDisclose(event) && event.coverMediaId) {
    const signed = await signMediaForAsset(createSupabaseAdminClient(), event.coverMediaId, "feed");
    if (signed) {
      try {
        const upstream = await fetch(signed, { cache: "no-store" });
        const contentType = upstream.headers.get("content-type") ?? "";
        if (upstream.ok && upstream.body && contentType.startsWith("image/")) {
          return new Response(upstream.body, {
            status: 200,
            headers: {
              "Content-Type": contentType,
              "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
              "X-Content-Type-Options": "nosniff"
            }
          });
        }
      } catch {
        // Fall through to the branded image when storage is temporarily
        // unavailable. Social crawlers and share sheets still get artwork.
      }
    }
  }

  const response = NextResponse.redirect(destination, 307);
  response.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  return response;
}
