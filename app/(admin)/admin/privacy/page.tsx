import { CheckCircle2, Clock3, FileLock2, ShieldCheck } from "lucide-react";
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
import { AdminQueueStatus } from "@/components/admin/admin-queue-status";
import { Card } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/admin/access";

export default async function AdminPrivacyPage() {
  const { admin } = await requireAdminPagePermission("admin.privacy.requests.manage");
  const requestsResult = await admin
    .from("privacy_requests")
    .select("id, user_id, request_type, status, submitted_at, verified_at, completed_at")
    .order("submitted_at", { ascending: false })
    .limit(100);
  const requests = requestsResult.data ?? [];
  const userIds = [...new Set(requests.map((request) => request.user_id))];
  const profilesResult = userIds.length
    ? await admin.from("profiles").select("user_id, full_name, username").in("user_id", userIds)
    : { data: [], error: null };
  const users = new Map((profilesResult.data ?? []).map((profile) => [profile.user_id, profile.full_name || `@${profile.username}`]));
  const active = requests.filter((request) => !["completed", "rejected"].includes(request.status));

  return (
    <div className="space-y-7">
      <AdminPageHeader title="Privacy requests" description="Track verified account requests using status metadata only. Private request content is not displayed." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard icon={FileLock2} label="Open requests" value={active.length} hint="Requires review or processing" tone={active.length ? "warning" : "success"} />
        <AdminMetricCard icon={ShieldCheck} label="Verified" value={requests.filter((item) => item.status === "verified").length} hint="Identity check complete" />
        <AdminMetricCard icon={Clock3} label="Processing" value={requests.filter((item) => item.status === "processing").length} hint="Work in progress" tone="orange" />
        <AdminMetricCard icon={CheckCircle2} label="Completed" value={requests.filter((item) => item.status === "completed").length} hint="Within recent records" tone="success" />
      </div>
      <AdminSection title="Request queue" description="All status changes require an audit entry before they are saved.">
        {requestsResult.error || profilesResult.error ? <AdminQueryError /> : null}
        {!requestsResult.error && requests.length === 0 ? <AdminEmptyState icon={FileLock2} title="No privacy requests" description="Verified user requests will appear here." /> : null}
        <div className="grid gap-3">
          {requests.map((request) => (
            <Card key={request.id} className="p-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminStatus label={humanizeAdminValue(request.request_type)} tone={request.request_type.includes("delete") ? "warning" : "default"} />
                    <span className="text-xs text-muted-foreground">Submitted {formatAdminDate(request.submitted_at, true)}</span>
                  </div>
                  <h2 className="mt-2 truncate text-sm font-semibold">{users.get(request.user_id) ?? "Account unavailable"}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {request.completed_at ? `Completed ${formatAdminDate(request.completed_at, true)}` : request.verified_at ? `Verified ${formatAdminDate(request.verified_at, true)}` : "Identity verification pending"}
                  </p>
                </div>
                <AdminQueueStatus kind="privacy" recordId={request.id} initialStatus={request.status} />
              </div>
            </Card>
          ))}
        </div>
      </AdminSection>
    </div>
  );
}
