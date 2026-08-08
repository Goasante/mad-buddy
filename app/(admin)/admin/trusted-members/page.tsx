import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { AdminEmptyState, AdminPageHeader, formatAdminDate } from "@/components/admin/admin-ui";
import { TrustedMemberControls } from "@/components/admin/trusted-member-controls";
import { Card } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/user-avatar";
import { getAdminAccess } from "@/lib/admin/access";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadTrustedMemberQueue } from "@/lib/trust/trusted-member-admin";
import {
  TRUSTED_MEMBER_MIN_PREMIUM_DAYS,
  TRUSTED_MEMBER_REQUIRED_JOURNEYS
} from "@/lib/trust/trusted-member";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The Trusted Member review queue.
 *
 * Its own page rather than a section of Users, because this workflow has a
 * lifecycle of its own — apply, approve, decline, revoke, re-apply — with
 * history a general user table has no room for.
 *
 * Pending first and oldest first within it, so the longest wait is reviewed
 * next. Decided applications stay visible under "All": seeing that somebody
 * was declined twice before is exactly the context a fresh queue would hide.
 */

type QueueFilter = "pending" | "all";

const filters: Array<{ id: QueueFilter; label: string }> = [
  { id: "pending", label: "Pending" },
  { id: "all", label: "All" }
];

export default async function AdminTrustedMembersPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const filter: QueueFilter = params.status === "all" ? "all" : "pending";

  const admin = createSupabaseAdminClient();
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");

  const access = await getAdminAccess(admin, context);
  // The same permission that governs every other judgement about an account's
  // standing. A page-level check as well as the action's, so the queue is not
  // even rendered to someone who could not act on it.
  if (!access.permissions.has("admin.verification.review")) redirect("/admin");

  const applications = await loadTrustedMemberQueue(admin, filter);
  const pendingCount = applications.filter((application) => application.status === "pending").length;

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Trusted Members"
        description={`Applications from members with ${TRUSTED_MEMBER_MIN_PREMIUM_DAYS}+ days of Premium and all ${TRUSTED_MEMBER_REQUIRED_JOURNEYS} journeys complete. Approval recognises standing — it is not an identity check.`}
      />

      <div className="flex flex-wrap items-center gap-2">
        {filters.map((option) => (
          <Link
            key={option.id}
            href={`/admin/trusted-members?status=${option.id}` as Route}
            className={cn(
              "focus-ring inline-flex min-h-[36px] items-center rounded-full border px-3.5 text-sm font-medium transition-colors",
              filter === option.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/70 text-muted-foreground hover:bg-secondary/40"
            )}
          >
            {option.label}
            {option.id === "pending" && pendingCount > 0 ? (
              <span className="ml-1.5 text-xs font-semibold">({pendingCount})</span>
            ) : null}
          </Link>
        ))}
      </div>

      {applications.length === 0 ? (
        <AdminEmptyState
          icon={ShieldCheck}
          title={filter === "pending" ? "Nothing waiting" : "No applications yet"}
          description={
            filter === "pending"
              ? "Every application has been reviewed."
              : "Applications appear here once eligible members apply."
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {applications.map((application) => (
            <li key={application.id}>
              <Card className="flex flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <UserAvatar
                    src={application.avatarUrl}
                    name={application.displayName}
                    size="sm"
                    decorative
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/friends/${application.username}` as Route}
                        className="focus-ring truncate text-[0.9375rem] font-semibold hover:underline"
                      >
                        {application.displayName}
                      </Link>
                      <StatusPill status={application.status} hasBadge={Boolean(application.trustedSince)} />
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Applied {formatAdminDate(application.createdAt)}
                    </p>
                  </div>
                </div>

                {/* What they qualified on AT THE TIME, not a fresh reading.
                    A reviewer weeks later must see the case as it was made. */}
                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">Premium</dt>
                    <dd className="font-medium">
                      {application.premiumDaysAtApply ?? "—"} days
                    </dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">Journeys</dt>
                    <dd className="font-medium">
                      {application.journeysCompleteAtApply ?? "—"} of {TRUSTED_MEMBER_REQUIRED_JOURNEYS}
                    </dd>
                  </div>
                </dl>

                {application.note ? (
                  <p className="rounded-xl bg-secondary/40 p-3 text-sm leading-relaxed">
                    &ldquo;{application.note}&rdquo;
                  </p>
                ) : null}

                {/* The previous decision, so a re-application is reviewed with
                    its history rather than as a first request. */}
                {application.reviewedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Reviewed {formatAdminDate(application.reviewedAt)}
                    {application.reviewNote ? ` — ${application.reviewNote}` : ""}
                  </p>
                ) : null}

                <TrustedMemberControls
                  applicationId={application.id}
                  status={application.status}
                  hasBadge={Boolean(application.trustedSince)}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusPill({ status, hasBadge }: { status: string; hasBadge: boolean }) {
  // The badge is the truth about what this person currently holds; the status
  // is the truth about the last decision. They can differ — an approved row
  // whose badge was revoked elsewhere — and both are worth showing.
  const label = hasBadge ? "Trusted Member" : status;

  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[10px] font-bold uppercase tracking-wide",
        hasBadge
          ? "border-[hsl(var(--shadow)/0.35)] bg-[hsl(var(--shadow)/0.08)] text-[hsl(var(--shadow))] dark:border-white/25 dark:bg-white/10 dark:text-white/90"
          : status === "pending"
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border/70 text-muted-foreground"
      )}
    >
      {label}
    </span>
  );
}
