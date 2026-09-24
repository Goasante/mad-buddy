import { redirect } from "next/navigation";
import { BadgeCheck } from "lucide-react";

import { AdminEmptyState, AdminPageHeader, formatAdminDate } from "@/components/admin/admin-ui";
import { VerificationControls } from "@/components/admin/verification-controls";
import { VerificationApplicationControls } from "@/components/admin/verification-application-controls";
import { VerifiedAccountMark } from "@/components/trust/verified-account-mark";
import { Card } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/user-avatar";
import { getAdminAccess } from "@/lib/admin/access";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadVerificationQueue } from "@/lib/trust/verified-account-admin";
import { loadVerificationApplications } from "@/lib/trust/verification-review";
import type { VerificationStatus } from "@/lib/trust/verified-account";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Account verification.
 *
 * DELIBERATELY SEPARATE from Trusted Members, which sits one page over.
 * Trusted Member is standing earned in the product; this is Mad Buddy stating
 * that it checked who someone is. Merging the two queues would be the first
 * step towards one implying the other, which every part of this feature has
 * been built to prevent.
 *
 * User applications appear first. Search also permits owner/admin grants
 * and corrections to existing verification records.
 */

export default async function AdminVerificationsPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const query = (params.q ?? "").trim();

  const admin = createSupabaseAdminClient();
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");

  const access = await getAdminAccess(admin, context);
  // Checked at the page as well as in the action, so the queue is not even
  // rendered to someone who could not act on it.
  if (!access.permissions.has("admin.verification.review")) redirect("/admin");
  const allowDiscretionaryGrant = access.role === "owner" || access.role === "admin";

  const [applications, reviewed] = await Promise.all([
    loadVerificationApplications(admin),
    loadVerificationQueue(admin)
  ]);

  // Search is a separate read, and only when asked for: the page's default job
  // is showing what has already been decided.
  let searchResults: Array<{
    userId: string;
    displayName: string;
    username: string;
    avatarUrl: string | null;
    status: VerificationStatus | null;
  }> = [];

  if (query.length >= 2) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name, username, avatar_url")
      .or(`username.ilike.%${query}%,full_name.ilike.%${query}%`)
      .is("deleted_at", null)
      .limit(10);

    const reviewedByUserId = new Map(reviewed.map((entry) => [entry.userId, entry.status]));
    searchResults = (profiles ?? []).map((profile) => ({
      userId: profile.user_id,
      displayName: profile.full_name?.trim() || "A Muddy",
      username: profile.username ?? "muddy",
      avatarUrl: profile.avatar_url ?? null,
      status: reviewedByUserId.get(profile.user_id) ?? null
    }));
  }

  const verifiedCount = reviewed.filter((entry) => entry.status === "verified").length;

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Account verification"
        description="Review applications by comparing the profile photo, ID and selfie. Owners and admins can also grant verification directly from account search, with an audited reason."
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Applications · {applications.length}</h2>
        {applications.length === 0 ? (
          <AdminEmptyState icon={BadgeCheck} title="No verification applications" description="New user applications will appear here for review." />
        ) : applications.map((application) => (
          <Card key={application.requestId} className="p-4">
            <div className="flex items-center gap-3">
              <UserAvatar src={application.avatarUrl} name={application.displayName} size="sm" decorative />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{application.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">@{application.username} · Legal name: {application.legalName}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {application.documentType.replaceAll("_", " ")} · {application.countryCode}
                  {application.submittedAt ? ` · Submitted ${formatAdminDate(application.submittedAt)}` : ""}
                </p>
              </div>
              <span className="rounded-full border border-border/70 px-2.5 py-1 text-xs font-medium">{application.status.replaceAll("_", " ")}</span>
            </div>
            <VerificationApplicationControls application={application} />
          </Card>
        ))}
      </section>

      {/* Search also exposes discretionary grants only to owners and admins. */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Find an account by name or username"
          aria-label="Find an account"
          className="focus-ring h-10 min-w-0 flex-1 rounded-lg border border-border/70 bg-background px-3 text-sm sm:max-w-sm"
        />
        <button
          type="submit"
          className="focus-ring inline-flex h-10 items-center rounded-lg border border-border/70 px-4 text-sm font-medium hover:bg-secondary/40"
        >
          Search
        </button>
      </form>

      {query.length >= 2 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {searchResults.length} {searchResults.length === 1 ? "result" : "results"} for &ldquo;{query}&rdquo;
          </h2>
          {searchResults.length === 0 ? (
            <AdminEmptyState
              icon={BadgeCheck}
              title="No accounts found"
              description="Try a different name or username."
            />
          ) : (
            searchResults.map((result) => (
              <Card key={result.userId} className="flex flex-wrap items-center gap-3 p-4">
                <UserAvatar src={result.avatarUrl} name={result.displayName} size="sm" decorative />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <p className="truncate text-sm font-semibold">{result.displayName}</p>
                    <VerifiedAccountMark isVerifiedAccount={result.status === "verified"} compact />
                  </div>
                  <p className="truncate text-xs text-muted-foreground">@{result.username}</p>
                </div>
                <StatusPill status={result.status} />
                <VerificationControls userId={result.userId} status={result.status} allowDiscretionaryGrant={allowDiscretionaryGrant} />
              </Card>
            ))
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Reviewed accounts{verifiedCount > 0 ? ` · ${verifiedCount} verified` : ""}
        </h2>

        {reviewed.length === 0 ? (
          <AdminEmptyState
            icon={BadgeCheck}
            title="No accounts reviewed yet"
            description="Search for an account above to verify it. The badge appears wherever that person's name is shown."
          />
        ) : (
          reviewed.map((entry) => (
            <Card key={entry.userId} className="flex flex-wrap items-center gap-3 p-4">
              <UserAvatar src={entry.avatarUrl} name={entry.displayName} size="sm" decorative />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-sm font-semibold">{entry.displayName}</p>
                  <VerifiedAccountMark isVerifiedAccount={entry.status === "verified"} compact />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  @{entry.username}
                  {entry.evidenceLabel ? ` · ${entry.evidenceLabel}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {entry.status === "verified" && entry.verifiedAt
                    ? `Verified ${formatAdminDate(entry.verifiedAt)}`
                    : `Updated ${formatAdminDate(entry.updatedAt)}`}
                </p>
              </div>
              <StatusPill status={entry.status} />
              <VerificationControls userId={entry.userId} status={entry.status} allowDiscretionaryGrant={allowDiscretionaryGrant} />
            </Card>
          ))
        )}
      </section>
    </div>
  );
}

/** The current state, in words rather than colour alone. */
function StatusPill({ status }: { status: VerificationStatus | null }) {
  if (!status) {
    return (
      <span className="rounded-full border border-border/70 px-2.5 py-1 text-xs text-muted-foreground">
        Not reviewed
      </span>
    );
  }

  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-semibold",
        status === "verified"
          ? "border-[#F97316]/40 bg-[#F97316]/10 text-[#C2410C] dark:text-[#FDBA74]"
          : "border-border/70 text-muted-foreground"
      )}
    >
      {status === "verified" ? "Verified" : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
