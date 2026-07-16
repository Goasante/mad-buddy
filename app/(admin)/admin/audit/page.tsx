import { ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export default async function AdminAuditPage() {
  const admin = createSupabaseAdminClient();
  const { data: audits } = await admin
    .from("deletion_audit_logs")
    .select("id, deleted_user_label, deletion_reason, retained_billing_reference, retained_report_reference, deleted_at")
    .order("deleted_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <section>
        <Badge variant="warning">
          <ClipboardList className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Audit
        </Badge>
        <h1 className="mt-4 text-3xl font-semibold">Deletion audit</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Account deletion records retained for support, billing reconciliation, and safety continuity.
        </p>
      </section>

      <section className="grid gap-3">
        {(audits ?? []).map((audit) => (
          <Card key={audit.id} className="p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div>
                <p className="font-semibold">{audit.deleted_user_label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(audit.deleted_at)}</p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {audit.deletion_reason || "No reason provided."}
                </p>
              </div>
              <div className="grid content-start gap-2 text-xs text-muted-foreground md:text-right">
                <span>{audit.retained_billing_reference || "No billing reference"}</span>
                <span>{audit.retained_report_reference || "No report reference"}</span>
              </div>
            </div>
          </Card>
        ))}
        {(audits ?? []).length === 0 ? (
          <Card className="p-5 text-sm text-muted-foreground">No deletion audits yet.</Card>
        ) : null}
      </section>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
