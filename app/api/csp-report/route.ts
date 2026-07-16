import { NextResponse } from "next/server";
import { logBackendEvent } from "@/lib/observability/logger";

/**
 * CSP violation intake for the Report-Only rollout (audit §13, stage 2).
 * Anonymous by design (browsers post here without credentials). Reports are
 * sanitized before logging: only the violated directive and the ORIGIN of
 * the blocked URI are recorded — never full URLs, which can carry paths or
 * query strings. Payloads are size-capped to keep this from being a log-spam
 * vector.
 */

const MAX_REPORT_BYTES = 8_192;

type CspReportBody = {
  "csp-report"?: {
    "violated-directive"?: string;
    "effective-directive"?: string;
    "blocked-uri"?: string;
  };
};

function safeOrigin(value: string | undefined): string {
  if (!value) {
    return "unknown";
  }

  // Keyword-style values ("inline", "eval", "data") arrive without a scheme.
  if (!value.includes("://")) {
    return value.slice(0, 32);
  }

  try {
    return new URL(value).origin;
  } catch {
    return "unparseable";
  }
}

export async function POST(request: Request) {
  const raw = await request.text();

  if (raw.length > MAX_REPORT_BYTES) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const body = JSON.parse(raw) as CspReportBody;
    const report = body["csp-report"];
    const directive = (report?.["effective-directive"] ?? report?.["violated-directive"] ?? "unknown")
      .slice(0, 64);
    const blockedOrigin = safeOrigin(report?.["blocked-uri"]);

    logBackendEvent("warn", {
      route: "/api/csp-report",
      action: "csp.violation",
      errorType: `${directive} <- ${blockedOrigin}`
    });
  } catch {
    // Malformed report — drop silently; this endpoint must never error-loop.
  }

  return new NextResponse(null, { status: 204 });
}
