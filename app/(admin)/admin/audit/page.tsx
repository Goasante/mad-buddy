import { Activity, Eye, Trash2 } from "lucide-react";
import { AdminEmptyState, AdminPageHeader, AdminQueryError, AdminSection, AdminStatus, formatAdminDate, humanizeAdminValue } from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/admin/access";

export default async function AdminAuditPage() {
  const { admin } = await requireAdminPagePermission("admin.audit.view");
  const [eventsResult, accessResult, deletionsResult] = await Promise.all([
    admin.from("admin_audit_events").select("id, action, target_type, actor_role, reason, auth_strength, created_at").order("created_at", { ascending: false }).limit(100),
    admin.from("sensitive_access_log").select("id, category, reason, approved_by, accessed_at").order("accessed_at", { ascending: false }).limit(50),
    admin.from("deletion_audit_logs").select("id, deleted_user_label, deletion_reason, deleted_at").order("deleted_at", { ascending: false }).limit(50)
  ]);
  const events = eventsResult.data ?? [];

  return (
    <div className="space-y-7">
      <AdminPageHeader title="Audit log" description="Append-only records for privileged actions, justified sensitive access, and account deletion continuity." meta={<AdminStatus label="Immutable history" tone="success" />} />
      <AdminSection title="Admin activity" description="Latest privileged state changes across the platform.">
        {eventsResult.error ? <AdminQueryError /> : null}
        {!eventsResult.error && events.length === 0 ? <AdminEmptyState icon={Activity} title="No admin activity" description="Audited staff actions will appear here." /> : <AuditTable rows={events.map((event) => ({ id: event.id, title: humanizeAdminValue(event.action), detail: [event.target_type ? humanizeAdminValue(event.target_type) : null, event.reason].filter(Boolean).join(" · ") || "Platform action", meta: event.auth_strength ? humanizeAdminValue(event.auth_strength) : event.actor_role ? humanizeAdminValue(event.actor_role) : "Admin", date: event.created_at }))} />}
      </AdminSection>
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <AdminSection title="Sensitive access" description="Recorded justification metadata. Private content is not included.">
          {accessResult.error ? <AdminQueryError /> : (accessResult.data ?? []).length === 0 ? <AdminEmptyState icon={Eye} title="No sensitive access" description="Justified sensitive-data access will appear here." /> : <AuditTable rows={(accessResult.data ?? []).map((item) => ({ id: item.id, title: humanizeAdminValue(item.category), detail: item.reason, meta: item.approved_by ? "Approved" : "Recorded", date: item.accessed_at }))} />}
        </AdminSection>
        <AdminSection title="Account deletions" description="Continuity records retained for support and safety obligations.">
          {deletionsResult.error ? <AdminQueryError /> : (deletionsResult.data ?? []).length === 0 ? <AdminEmptyState icon={Trash2} title="No deletion records" description="Completed account deletions will appear here." /> : <AuditTable rows={(deletionsResult.data ?? []).map((item) => ({ id: item.id, title: item.deleted_user_label, detail: item.deletion_reason || "No reason provided", meta: "Deleted", date: item.deleted_at }))} />}
        </AdminSection>
      </div>
    </div>
  );
}

function AuditTable({ rows }: { rows: Array<{ id: string; title: string; detail: string; meta: string; date: string }> }) {
  return <Card className="divide-y divide-border/70 overflow-hidden p-0">{rows.map((row) => <div key={row.id} className="grid gap-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><p className="truncate text-sm font-medium">{row.title}</p><p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{row.detail}</p></div><div className="flex items-center gap-3 sm:justify-end"><AdminStatus label={row.meta} /><time className="text-xs text-muted-foreground">{formatAdminDate(row.date, true)}</time></div></div>)}</Card>;
}
