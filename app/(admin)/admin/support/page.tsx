import { AlertTriangle, Inbox, LifeBuoy, MessagesSquare } from "lucide-react";
import {
  AdminEmptyState,
  AdminMetricCard,
  AdminPageHeader,
  AdminQueryError,
  AdminSection,
  AdminStatus,
  formatAdminDate,
  humanizeAdminValue
} from "@/components/admin/admin-ui";
import { AdminSupportTicket } from "@/components/admin/admin-support-ticket";
import { Card } from "@/components/ui/card";
import { getAdminAccess } from "@/lib/admin/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { redirect } from "next/navigation";

export default async function AdminSupportPage() {
  const admin = createSupabaseAdminClient();
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.support.manage")) redirect("/admin");
  const [ticketsResult, messagesResult] = await Promise.all([admin
    .from("support_tickets")
    .select("id, user_id, category, subject, description, priority, status, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(100), admin.from("support_ticket_messages").select("id, ticket_id, sender_type, message, created_at").order("created_at", { ascending: true }).limit(500)]);
  const tickets = ticketsResult.data ?? [];
  const userIds = [...new Set(tickets.map((ticket) => ticket.user_id).filter((id): id is string => Boolean(id)))];
  const profilesResult = userIds.length
    ? await admin.from("profiles").select("user_id, full_name, username").in("user_id", userIds)
    : { data: [], error: null };
  const users = new Map((profilesResult.data ?? []).map((profile) => [profile.user_id, profile.full_name || `@${profile.username}`]));
  const active = tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status));

  return (
    <div className="space-y-7">
      <AdminPageHeader title="Support" description="Triage customer requests without exposing message bodies or private diagnostics." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard icon={Inbox} label="Open queue" value={active.length} hint="Needs support attention" tone={active.length ? "warning" : "success"} />
        <AdminMetricCard icon={AlertTriangle} label="Urgent" value={active.filter((item) => item.priority === "urgent").length} hint="Open urgent tickets" tone="danger" />
        <AdminMetricCard icon={MessagesSquare} label="Waiting on user" value={active.filter((item) => item.status === "waiting_on_user").length} hint="Pending customer response" />
        <AdminMetricCard icon={LifeBuoy} label="Resolved" value={tickets.filter((item) => item.status === "resolved").length} hint="Within recent records" tone="success" />
      </div>
      <AdminSection title="Support queue" description="Status changes are recorded in the immutable admin audit log.">
        {ticketsResult.error || profilesResult.error || messagesResult.error ? <AdminQueryError /> : null}
        {!ticketsResult.error && tickets.length === 0 ? <AdminEmptyState icon={LifeBuoy} title="No support tickets" description="New customer requests will appear here." /> : null}
        <div className="grid gap-3">
          {tickets.map((ticket) => (
            <Card key={ticket.id} className="p-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminStatus label={humanizeAdminValue(ticket.priority)} tone={ticket.priority === "urgent" ? "danger" : ticket.priority === "high" ? "warning" : "default"} />
                    <span className="text-xs text-muted-foreground">{humanizeAdminValue(ticket.category)}</span>
                  </div>
                  <h2 className="mt-2 truncate text-sm font-semibold">{ticket.subject}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {ticket.user_id ? users.get(ticket.user_id) ?? "Account unavailable" : "Deleted account"} · Opened {formatAdminDate(ticket.created_at, true)}
                  </p>
                </div>
                <AdminStatus label={humanizeAdminValue(ticket.status)} tone={ticket.status === "escalated" ? "danger" : ticket.status === "resolved" ? "success" : "default"} />
              </div>
              <AdminSupportTicket
                ticketId={ticket.id}
                status={ticket.status}
                description={ticket.description}
                messages={(messagesResult.data ?? []).filter((message) => message.ticket_id === ticket.id).map((message) => ({ id: message.id, senderType: message.sender_type, message: message.message, createdAt: message.created_at }))}
              />
            </Card>
          ))}
        </div>
      </AdminSection>
    </div>
  );
}
