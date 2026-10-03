import { NextResponse } from "next/server";

import { ADSENSE_VERIFICATION_CLIENT_ID } from "@/content/site-verification";

export const dynamic = "force-dynamic";

/**
 * AdSense seller declaration. Site verification only needs the publisher/client
 * id confirmed in the owner's account; it must not wait for serving configuration.
 * Full ad serving still fails closed elsewhere until the complete client + slot
 * configuration is valid.
 */
export function GET() {
  const publisherId = ADSENSE_VERIFICATION_CLIENT_ID.replace(/^ca-/, "");
  return new NextResponse(`google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600"
    }
  });
}
