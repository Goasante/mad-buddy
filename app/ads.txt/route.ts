import { NextResponse } from "next/server";

import { readWebAdsConfiguration } from "@/lib/ads/config";

export const dynamic = "force-dynamic";

/**
 * AdSense seller declaration, derived from the same validated client id used by
 * the PWA provider. No placeholder publisher record is ever exposed.
 */
export function GET() {
  const config = readWebAdsConfiguration(process.env);
  if (!config.ok) {
    return new NextResponse("Not configured\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  const publisherId = config.value.clientId.replace(/^ca-/, "");
  return new NextResponse(`google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600"
    }
  });
}
