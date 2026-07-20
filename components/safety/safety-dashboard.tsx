"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, FileWarning, LoaderCircle, ShieldCheck } from "lucide-react";
import { updateReportStatusAction } from "@/app/(app)/safety/actions";
import {
  AdminEmptyState,
  AdminMetricCard,
  AdminPageHeader,
  AdminSection,
  AdminStatus,
  formatAdminDate,
  humanizeAdminValue
} from "@/components/admin/admin-ui";
import { AppSelect, type AppSelectOption } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ReportStatus } from "@/lib/supabase/database.types";

export type SafetyReport = {
  id: string;
  reporterId: string | null;
  reporterLabel: string;
  reportedUserId: string | null;
  reportedUserLabel: string;
  reason: string;
  description: string | null;
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
};

export type SafetyDeletionAudit = {
  id: string;
  deletedUserLabel: string;
  deletionReason: string | null;
  retainedBillingReference: string | null;
  retainedReportReference: string | null;
  deletedAt: string;
};

export type SafetyMetric = {
  label: string;
  value: string;
  tone: "green" | "blue" | "violet" | "warning" | "danger";
};

const options: AppSelectOption<ReportStatus>[] = [
  { value: "open", label: "Open" },
  { value: "reviewing", label: "Reviewing" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" }
];

export function SafetyDashboard({
  reports,
  metrics,
  isDevelopmentFallback
}: {
  reports: SafetyReport[];
  deletionAudits: SafetyDeletionAudit[];
  metrics: SafetyMetric[];
  isDevelopmentFallback: boolean;
}) {
  return (
    <div className="space-y-7">
      <AdminPageHeader
        title="Reports"
        description="Review user reports and record clear outcomes without exposing unrelated private data."
        meta={isDevelopmentFallback ? <AdminStatus label="Local admin fallback" tone="warning" /> : undefined}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric, index) => (
          <AdminMetricCard
            key={metric.label}
            icon={index === 0 ? AlertTriangle : index === 1 ? FileWarning : ShieldCheck}
            label={metric.label}
            value={metric.value}
            tone={metric.tone === "green" ? "success" : metric.tone === "danger" ? "danger" : metric.tone === "warning" ? "warning" : "default"}
          />
        ))}
      </div>
      <AdminSection title="Report queue" description="Status changes are saved with an immutable admin audit event.">
        {reports.length === 0 ? <AdminEmptyState icon={ShieldCheck} title="No reports" description="New safety reports will appear here." /> : null}
        <div className="grid gap-3">
          {reports.map((report) => <ReportRow key={report.id} report={report} />)}
        </div>
      </AdminSection>
    </div>
  );
}

function ReportRow({ report }: { report: SafetyReport }) {
  const [status, setStatus] = useState<ReportStatus>(report.status);
  const [saved, setSaved] = useState<ReportStatus>(report.status);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await updateReportStatusAction({ reportId: report.id, status });
      setMessage(result.message);
      if (result.ok) setSaved(status);
    });
  }

  return (
    <Card className="p-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <AdminStatus label={humanizeAdminValue(saved)} tone={saved === "open" ? "danger" : saved === "reviewing" ? "warning" : saved === "resolved" ? "success" : "default"} />
            <span className="text-xs text-muted-foreground">Reported {formatAdminDate(report.createdAt, true)}</span>
          </div>
          <h2 className="mt-2 text-sm font-semibold">{humanizeAdminValue(report.reason)}</h2>
          {report.description ? <p className="mt-1 line-clamp-2 max-w-3xl text-xs leading-5 text-muted-foreground">{report.description}</p> : null}
          <p className="mt-2 text-xs text-muted-foreground">
            Reporter: {report.reporterLabel} · Reported account: {report.reportedUserLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          <AppSelect value={status} options={options} size="compact" disabled={pending} triggerClassName="min-w-36" onChange={setStatus} />
          <Button type="button" size="sm" variant="outline" disabled={pending || status === saved} onClick={save}>
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
            Save
          </Button>
          {message ? <p className="w-full text-right text-xs text-muted-foreground" role="status">{message}</p> : null}
        </div>
      </div>
    </Card>
  );
}
