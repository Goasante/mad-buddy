import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { RotateCcw } from "lucide-react";

import { AdminEmptyState, AdminPageHeader, AdminQueryError, AdminStatus, formatAdminDate } from "@/components/admin/admin-ui";
import { IssueStatusBadge } from "@/components/admin/support/issue-badges";
import { Card } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/user-avatar";
import { getAdminAccess } from "@/lib/admin/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";

function diagnosticsObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export default async function AdminLinkrRequestsPage() {
  const admin = createSupabaseAdminClient();
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.support.manage")) redirect("/admin");

  const result = await admin
    .from("support_tickets")
    .select("id, user_id, subject, status, created_at, updated_at, diagnostics")
    .eq("diagnostics->>workflow", "linkr_pass_reversal")
    .order("created_at", { ascending: false })
    .limit(100);
  const tickets = result.data ?? [];
  const pendingCount = tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status)).length;

  const relatedIds = new Set<string>();
  for (const ticket of tickets) {
    if (ticket.user_id) relatedIds.add(ticket.user_id);
    const target = diagnosticsObject(ticket.diagnostics).target_user_id;
    if (typeof target === "string") relatedIds.add(target);
  }

  const profileById = new Map<string, { full_name: string; username: string; avatar_url: string | null }>();
  if (relatedIds.size > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name, username, avatar_url")
      .in("user_id", [...relatedIds]);
    for (const profile of profiles ?? []) profileById.set(profile.user_id, profile);
  }
  const nameFor = (id: string | null) => {
    if (!id) return "Account unavailable";
    const profile = profileById.get(id);
    return profile?.full_name?.trim() || profile?.username || "Account unavailable";
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Linkr requests"
        description="Review rewind requests that users send after using their three self-service Linkr reverses."
        meta={<AdminStatus label={`${pendingCount} pending`} tone={pendingCount > 0 ? "warning" : "success"} />}
      />

      {result.error ? <AdminQueryError message="Linkr requests could not be loaded. Try again shortly." /> : null}

      {!result.error && tickets.length === 0 ? (
        <AdminEmptyState
          icon={RotateCcw}
          title="No Linkr rewind requests"
          description="Requests sent from Linkr will appear here automatically."
        />
      ) : null}

      {tickets.length > 0 ? (
        <div className="grid gap-3">
          {tickets.map((ticket) => {
            const diagnostics = diagnosticsObject(ticket.diagnostics);
            const targetId = typeof diagnostics.target_user_id === "string" ? diagnostics.target_user_id : null;
            const requester = ticket.user_id ? profileById.get(ticket.user_id) : null;
            const isPending = !["resolved", "closed"].includes(ticket.status);
            return (
              <Card key={ticket.id} className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{ticket.subject || "Linkr rewind request"}</p>
                      <IssueStatusBadge status={ticket.status} />
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <UserAvatar src={requester?.avatar_url ?? null} name={nameFor(ticket.user_id)} size="xs" />
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">{nameFor(ticket.user_id)}</span>
                        {targetId ? <> wants to rewind a pass on <span className="font-medium text-foreground">{nameFor(targetId)}</span></> : null}
                      </p>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Requested {formatAdminDate(ticket.created_at)} · Updated {formatAdminDate(ticket.updated_at)}
                    </p>
                  </div>
                  <Link
                    href={`/admin/support/${ticket.id}` as Route}
                    className="focus-ring inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-border/70 px-4 text-sm font-semibold hover:bg-secondary/40"
                  >
                    {isPending ? "Review request" : "View review"}
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
