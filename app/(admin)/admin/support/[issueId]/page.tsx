import Link from "next/link";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { IssueDetailPanel, type IssueDetailData } from "@/components/admin/support/issue-detail-panel";
import { getAdminAccess } from "@/lib/admin/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { describeSupportEvent } from "@/lib/admin/support";

type DetailPageProps = { params: Promise<{ issueId: string }> };

// Only ever surface these diagnostic keys — never anything sensitive.
const SAFE_DIAGNOSTIC_KEYS = ["affected_feature", "platform", "app_version", "route"] as const;

export default async function SupportIssueDetailPage({ params }: DetailPageProps) {
  const { issueId } = await params;
  const admin = createSupabaseAdminClient();
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.support.manage")) redirect("/admin");

  const { data: ticket, error } = await admin
    .from("support_tickets")
    .select("id, user_id, subject, description, category, priority, status, assigned_to, diagnostics, created_at, updated_at, resolved_at")
    .eq("id", issueId)
    .maybeSingle();
  if (error) redirect("/admin/support");
  if (!ticket) notFound();

  const diagnostics = (ticket.diagnostics ?? {}) as Record<string, unknown>;
  const safeDiagnostics: Record<string, string> = {};
  for (const key of SAFE_DIAGNOSTIC_KEYS) {
    const value = diagnostics[key];
    if (typeof value === "string" && value.length <= 120) safeDiagnostics[key] = value;
  }

  const [messagesRes, notesRes, eventsRes, auditRes, staffRes] = await Promise.all([
    admin
      .from("support_ticket_messages")
      .select("id, sender_type, sender_id, message, created_at")
      .eq("ticket_id", issueId)
      .order("created_at", { ascending: true }),
    admin
      .from("support_internal_notes")
      .select("id, author_id, body, created_at")
      .eq("ticket_id", issueId)
      .order("created_at", { ascending: true }),
    admin
      .from("support_ticket_events")
      .select("id, actor_id, event_type, from_value, to_value, note, created_at")
      .eq("ticket_id", issueId)
      .order("created_at", { ascending: false }),
    admin
      .from("admin_audit_events")
      .select("id, actor_id, action, created_at")
      .eq("target_type", "support_ticket")
      .eq("target_id", issueId)
      .order("created_at", { ascending: false })
      .limit(25),
    admin
      .from("admin_users")
      .select("auth_user_id, role, disabled_at")
      .is("disabled_at", null)
      .in("role", ["owner", "admin", "support"])
  ]);

  const staffIds = (staffRes.data ?? []).map((row) => row.auth_user_id).filter((id): id is string => Boolean(id));

  // Batched name/avatar resolution for every referenced person.
  const personIds = [
    ...new Set(
      [
        ticket.user_id,
        ticket.assigned_to,
        ...(messagesRes.data ?? []).map((m) => m.sender_id),
        ...(notesRes.data ?? []).map((n) => n.author_id),
        ...(eventsRes.data ?? []).map((e) => e.actor_id),
        ...(auditRes.data ?? []).map((a) => a.actor_id),
        ...staffIds
      ].filter((id): id is string => Boolean(id))
    )
  ];
  const profileById = new Map<string, { full_name: string; username: string; avatar_url: string | null }>();
  if (personIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name, username, avatar_url")
      .in("user_id", personIds);
    for (const profile of profiles ?? []) profileById.set(profile.user_id, profile);
  }
  const nameFor = (id: string | null) => (id ? profileById.get(id)?.full_name ?? "Account unavailable" : "System");

  // Safe user summary only (no private content).
  let userSummary: IssueDetailData["user"] = null;
  if (ticket.user_id) {
    const profile = profileById.get(ticket.user_id);
    const { data: subscription } = await admin
      .from("subscriptions")
      .select("plan, status")
      .eq("user_id", ticket.user_id)
      .maybeSingle();
    userSummary = {
      id: ticket.user_id,
      name: profile?.full_name ?? "Account unavailable",
      username: profile?.username ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      plan: subscription?.status === "active" ? subscription.plan : null
    };
  }

  const data: IssueDetailData = {
    id: ticket.id,
    subject: ticket.subject,
    description: ticket.description,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    affectedFeature: safeDiagnostics.affected_feature ?? null,
    platform: safeDiagnostics.platform ?? null,
    appVersion: safeDiagnostics.app_version ?? null,
    assignedTo: ticket.assigned_to,
    assignedName: ticket.assigned_to ? nameFor(ticket.assigned_to) : null,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    resolvedAt: ticket.resolved_at,
    user: userSummary,
    messages: (messagesRes.data ?? []).map((m) => ({
      id: m.id,
      senderType: m.sender_type,
      authorName: m.sender_type === "user" ? userSummary?.name ?? "User" : nameFor(m.sender_id),
      message: m.message,
      createdAt: m.created_at
    })),
    internalNotes: (notesRes.data ?? []).map((n) => ({
      id: n.id,
      authorName: nameFor(n.author_id),
      body: n.body,
      createdAt: n.created_at
    })),
    timeline: [
      ...(eventsRes.data ?? []).map((e) => ({
        id: `event-${e.id}`,
        label: describeSupportEvent({ eventType: e.event_type, fromValue: e.from_value, toValue: e.to_value }),
        note: e.note,
        actorName: nameFor(e.actor_id),
        createdAt: e.created_at
      })),
      ...(auditRes.data ?? []).map((a) => ({
        id: `audit-${a.id}`,
        label: `Audit: ${a.action.replaceAll("_", " ")}`,
        note: null,
        actorName: nameFor(a.actor_id),
        createdAt: a.created_at
      }))
    ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    staff: staffIds
      .map((id) => ({ id, name: profileById.get(id)?.full_name ?? "Staff member" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    actorId: context.userId
  };

  return (
    <div className="space-y-5">
      <Link
        href={"/admin/support" as Route}
        className="focus-ring inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to issues
      </Link>
      <IssueDetailPanel data={data} />
    </div>
  );
}
