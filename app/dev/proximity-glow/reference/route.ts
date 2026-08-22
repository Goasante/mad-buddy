import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

/**
 * Serves the approved prototype for side-by-side comparison, in development.
 *
 * WHY A ROUTE RATHER THAN public/. Anything in public/ is copied into the
 * deployed bundle and served forever at a stable URL. The prototype is an
 * internal design document, not a product asset, and it should not become a
 * page on mad-buddy.com because a harness once needed to iframe it.
 *
 * DEVELOPMENT ONLY, twice over: this returns 404 unless NODE_ENV is literally
 * "development" (Next compiles that to "production" in a real build, making the
 * read below statically unreachable), and /dev is excluded from the proxy's
 * auth exemption by the same check. It reads one fixed path with no
 * user-controlled segment, so there is no traversal surface.
 */
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const html = await readFile(
      join(process.cwd(), "design-reference", "proximity-glow-v1.html"),
      "utf8"
    );
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Never cached: the reference is the thing being compared against, and
        // a stale copy would silently invalidate the comparison.
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return new NextResponse("Reference prototype not found", { status: 404 });
  }
}
