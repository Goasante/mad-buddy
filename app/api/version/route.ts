import { NextResponse } from "next/server";
import { resolveBuildId } from "@/lib/pwa/update";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { buildId: resolveBuildId(process.env) },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff"
      }
    }
  );
}
