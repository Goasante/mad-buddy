import Link from "next/link";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ReportReviewPanel, type ReportReviewData } from "@/components/admin/moderation/report-review-panel";
import { getAdminAccess } from "@/lib/admin/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { contentTypeLabel, type ReportKind } from "@/lib/admin/moderation";

type DetailProps = { params: Promise<{ kind: string; id: string }> };

export default async function ReportDetailPage({ params }: DetailProps) {
  const { kind: kindParam, id } = await params;
  if (kindParam !== "user" && kindParam !== "content") notFound();
  const kind = kindParam as ReportKind;

  const admin = createSupabaseAdminClient();
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.reports.review")) redirect("/admin");

  // Load the report (safe fields only — never the reported content body).
  let base: {
    id: string;
    status: string;
    reportedUserId: string | null;
    reporterId: string | null;
    primary: string;
    detail: string | null;
    category: string | null;
    contentType: string | null;
    createdAt: string;
  } | null = null;

  if (kind === "content") {
    const { data } = await admin
      .from("content_reports")
      .select("id, reporter_id, reported_user_id, content_type, content_id, category, details, status, created_at")
      .eq("id", id)
      .maybeSingle();
    if (data) {
      base = {
        id: data.id,
        status: data.status,
        reportedUserId: data.reported_user_id,
        reporterId: data.reporter_id,
        primary: data.category,
        detail: data.details,
        category: data.category,
        contentType: data.content_type,
        createdAt: data.created_at
      };
    }
  } else {
    const { data } = await admin
      .from("reports")
      .select("id, reporter_id, reported_user_id, reported_user_label, reason, description, status, created_at")
      .eq("id", id)
      .maybeSingle();
    if (data) {
      base = {
        id: data.id,
        status: data.status,
        reportedUserId: data.reported_user_id,
        reporterId: data.reporter_id,
        primary: data.reason,
        detail: data.description,
        category: null,
        contentType: null,
        createdAt: data.created_at
      };
    }
  }

  if (!base) notFound();

  // Related context (all safe): reported/reporter names, reported user's active
  // restrictions, how many reports exist against them, moderation history, audit.
  const personIds = [base.reportedUserId, base.reporterId].filter((x): x is string => Boolean(x));
  const profileById = new Map<string, { full_name: string; username: string; avatar_url: string | null }>();
  if (personIds.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("user_id, full_name, username, avatar_url").in("user_id", personIds);
    for (const profile of profiles ?? []) profileById.set(profile.user_id, profile);
  }

  const now = new Date().toISOString();
  const [restrictionsRes, userReportCount, contentReportCount, historyRes, auditRes] = await Promise.all([
    base.reportedUserId
      ? admin.from("user_restrictions").select("restriction_type, reason_code, ends_at, created_at").eq("user_id", base.reportedUserId).is("lifted_at", null)
      : Promise.resolve({ data: [] as { restriction_type: string; reason_code: string | null; ends_at: string | null; created_at: string }[] }),
    base.reportedUserId
      ? admin.from("reports").select("id", { count: "exact", head: true }).eq("reported_user_id", base.reportedUserId)
      : Promise.resolve({ count: 0 }),
    base.reportedUserId
      ? admin.from("content_reports").select("id", { count: "exact", head: true }).eq("reported_user_id", base.reportedUserId)
      : Promise.resolve({ count: 0 }),
    kind === "content"
      ? admin.from("moderation_actions").select("id, moderator_id, action_type, reason, created_at").eq("report_id", id).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; moderator_id: string | null; action_type: string; reason: string | null; created_at: string }[] }),
    admin.from("admin_audit_events").select("id, actor_id, action, created_at").eq("target_id", id).order("created_at", { ascending: false }).limit(25)
  ]);

  const actorIds = [
    ...new Set([
      ...(historyRes.data ?? []).map((h) => h.moderator_id),
      ...(auditRes.data ?? []).map((a) => a.actor_id)
    ].filter((x): x is string => Boolean(x)))
  ];
  const actorNameById = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: actors } = await admin.from("profiles").select("user_id, full_name").in("user_id", actorIds);
    for (const actor of actors ?? []) actorNameById.set(actor.user_id, actor.full_name);
  }
  const actorName = (uid: string | null) => (uid ? actorNameById.get(uid) ?? "Staff member" : "System");

  const reportedProfile = base.reportedUserId ? profileById.get(base.reportedUserId) : undefined;
  const reporterProfile = base.reporterId ? profileById.get(base.reporterId) : undefined;
  const activeRestrictions = (restrictionsRes.data ?? []).filter((r) => !r.ends_at || r.ends_at > now);

  const data: ReportReviewData = {
    kind,
    id: base.id,
    status: base.status,
    primary: base.primary,
    detail: base.detail,
    category: base.category,
    contentTypeLabel: base.contentType ? contentTypeLabel(base.contentType) : null,
    createdAt: base.createdAt,
    reported: base.reportedUserId
      ? {
          id: base.reportedUserId,
          name: reportedProfile?.full_name ?? "Account unavailable",
          username: reportedProfile?.username ?? null,
          avatarUrl: reportedProfile?.avatar_url ?? null,
          totalReports: ((userReportCount.count ?? 0) as number) + ((contentReportCount.count ?? 0) as number),
          activeRestrictions: activeRestrictions.map((r) => ({ type: r.restriction_type, endsAt: r.ends_at }))
        }
      : null,
    reporterName: reporterProfile ? `${reporterProfile.full_name} (@${reporterProfile.username})` : base.reporterId ? "Unknown reporter" : "Deleted reporter",
    history: [
      ...(historyRes.data ?? []).map((h) => ({
        id: `mod-${h.id}`,
        label: `Action: ${h.action_type.replaceAll("_", " ")}`,
        note: h.reason,
        actorName: actorName(h.moderator_id),
        createdAt: h.created_at
      })),
      ...(auditRes.data ?? []).map((a) => ({
        id: `audit-${a.id}`,
        label: `Audit: ${a.action.replaceAll("_", " ")}`,
        note: null,
        actorName: actorName(a.actor_id),
        createdAt: a.created_at
      }))
    ].sort((l, r) => Date.parse(r.createdAt) - Date.parse(l.createdAt))
  };

  return (
    <div className="space-y-5">
      <Link href={"/admin/reports" as Route} className="focus-ring inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to reports
      </Link>
      <ReportReviewPanel data={data} />
    </div>
  );
}
