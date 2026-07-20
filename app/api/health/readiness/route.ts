import { NextResponse } from "next/server";
import { getReadinessReport } from "@/lib/health/readiness";

export async function GET() {
  const report = await getReadinessReport();

  // Public load-balancer endpoint: expose only aggregate readiness. Detailed
  // configuration checks remain server-rendered inside the authorized admin UI.
  return NextResponse.json({ ok: report.ok, checkedAt: report.checkedAt }, {
    status: report.ok ? 200 : 503,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
