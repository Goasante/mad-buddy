import { redirect } from "next/navigation";
import { Scale } from "lucide-react";

import { AppealControls } from "@/components/admin/appeal-controls";
import { AdminEmptyState, AdminPageHeader, formatAdminDate } from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/card";
import { getAdminAccess } from "@/lib/admin/access";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminAppealsPage() {
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");
  const admin = createSupabaseAdminClient();
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.appeals.review")) redirect("/admin");

  const { data: appeals } = await admin.from("appeals")
    .select("id, subject_user_id, source_restriction_id, reason, status, submitted_at, decision, decision_note")
    .order("submitted_at", { ascending: false }).limit(100);
  const userIds = [...new Set((appeals ?? []).map((row) => row.subject_user_id))];
  const restrictionIds = (appeals ?? []).map((row) => row.source_restriction_id).filter((value): value is string => Boolean(value));
  const [{ data: profiles }, { data: restrictions }] = await Promise.all([
    userIds.length ? admin.from("profiles").select("user_id, full_name, username").in("user_id", userIds) : Promise.resolve({ data: [] }),
    restrictionIds.length ? admin.from("user_restrictions").select("id, restriction_type, starts_at, ends_at, lifted_at").in("id", restrictionIds) : Promise.resolve({ data: [] })
  ]);
  const profileById = new Map((profiles ?? []).map((row) => [row.user_id, row]));
  const restrictionById = new Map((restrictions ?? []).map((row) => [row.id, row]));

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Appeals" description="Review account enforcement appeals and restore access when a decision should be reversed." />
      {(appeals ?? []).length === 0 ? <AdminEmptyState icon={Scale} title="No appeals" description="Submitted appeals will appear here." /> : (appeals ?? []).map((appeal) => {
        const profile = profileById.get(appeal.subject_user_id);
        const restriction = appeal.source_restriction_id ? restrictionById.get(appeal.source_restriction_id) : null;
        return (
          <Card key={appeal.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-sm font-semibold">{profile?.full_name ?? "Account unavailable"}</p><p className="text-xs text-muted-foreground">@{profile?.username ?? "unknown"} · {restriction?.restriction_type?.replaceAll("_", " ") ?? "Account action"}</p></div>
              <span className="rounded-full border border-border/70 px-2.5 py-1 text-xs font-medium">{appeal.decision ?? appeal.status.replaceAll("_", " ")}</span>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm">{appeal.reason}</p>
            <p className="mt-2 text-xs text-muted-foreground">Submitted {formatAdminDate(appeal.submitted_at, true)}</p>
            {appeal.status === "submitted" || appeal.status === "in_review" ? <AppealControls appealId={appeal.id} /> : appeal.decision_note ? <p className="mt-3 border-t border-border/60 pt-3 text-sm text-muted-foreground">{appeal.decision_note}</p> : null}
          </Card>
        );
      })}
    </div>
  );
}
