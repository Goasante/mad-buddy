import { NextResponse } from "next/server";
import { getReadinessReport } from "@/lib/health/readiness";

export async function GET() {
  const report = await getReadinessReport();

  return NextResponse.json(report, {
    status: report.ok ? 200 : 503,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
