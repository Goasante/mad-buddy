import { NextResponse } from "next/server";

import { readAdsenseClientId } from "@/lib/ads/config";

export const dynamic = "force-dynamic";

/**
 * AdSense seller declaration. Site verification only needs the publisher/client
 * id; it must not wait for a display ad slot to exist. Full ad serving still
 * fails closed elsewhere until the complete client + slot configuration is valid.
 */
export function GET() {
  const clientId = readAdsenseClientId(process.env);
  if (!clientId) {
    return new NextResponse("Not configured\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  const publisherId = clientId.replace(/^ca-/, "");
  return new NextResponse(`google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600"
    }
  });
}
