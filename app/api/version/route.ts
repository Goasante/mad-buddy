import { NextResponse } from "next/server";
import { normalizeBuildId, resolveBuildId } from "@/lib/pwa/update";

export const dynamic = "force-dynamic";

/**
 * What this deployment ACTUALLY is, answerable from the live domain.
 *
 * `buildId` alone could not settle the question it was being asked. It
 * prefers `VERCEL_DEPLOYMENT_ID`, an opaque id with no relationship to a
 * commit, so "the deployed SHA matches" could only ever be checked through
 * the Vercel API -- never from the site itself, and never from the phone
 * actually showing the old behaviour. A release was called successful on the
 * strength of two numbers that were never compared to the running app.
 *
 * `commit` closes that: the git SHA this build was produced from, readable by
 * anyone with the URL. It is public information -- the repository is the
 * owner's, the SHA appears in every deployment log -- and it is the only way
 * to prove that mad-buddy.com is serving the build you think it is.
 *
 * `commit` is null in local development, where no Vercel git metadata exists.
 */
export function GET() {
  const commit =
    normalizeBuildId(process.env.VERCEL_GIT_COMMIT_SHA) ??
    normalizeBuildId(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA);

  return NextResponse.json(
    {
      buildId: resolveBuildId(process.env),
      commit,
      commitShort: commit ? commit.slice(0, 7) : null,
      ref: normalizeBuildId(process.env.VERCEL_GIT_COMMIT_REF),
      environment: normalizeBuildId(process.env.VERCEL_ENV) ?? "development"
    },
    {
      headers: {
        // Never cached anywhere: a stale answer here would defeat the entire
        // purpose of asking.
        "Cache-Control": "no-store, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff"
      }
    }
  );
}
