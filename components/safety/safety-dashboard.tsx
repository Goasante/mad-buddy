"use client";

import { useState, useTransition } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Archive,
  Ban,
  CheckCircle2,
  Eye,
  ShieldAlert,
  Trash2,
  UserRound
} from "lucide-react";
import {
  blockReportedUserAction,
  updateReportStatusAction,
  type SafetyActionState
} from "@/app/(app)/safety/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ReportStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

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

type SafetyDashboardProps = {
  reports: SafetyReport[];
  deletionAudits: SafetyDeletionAudit[];
  metrics: SafetyMetric[];
  isDevelopmentFallback: boolean;
};

const statusOptions: Array<{ value: ReportStatus; label: string; icon: LucideIcon }> = [
  { value: "open", label: "Open", icon: AlertTriangle },
  { value: "reviewing", label: "Reviewing", icon: Eye },
  { value: "resolved", label: "Resolved", icon: CheckCircle2 },
  { value: "dismissed", label: "Dismissed", icon: Archive }
];

const readyState: SafetyActionState = {
  ok: true,
  message: "Ready"
};

export function SafetyDashboard({
  reports,
  deletionAudits,
  metrics,
  isDevelopmentFallback
}: SafetyDashboardProps) {
  const [result, setResult] = useState(readyState);
  const [isPending, startTransition] = useTransition();

  function updateStatus(reportId: string, status: ReportStatus) {
    startTransition(async () => {
      setResult(await updateReportStatusAction({ reportId, status }));
    });
  }

  function blockReportedUser(reportId: string) {
    startTransition(async () => {
      setResult(await blockReportedUserAction({ reportId }));
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-red-300/20 bg-gradient-to-br from-red-400/12 via-violet-500/10 to-blue-400/10 p-5 sm:p-6">
        <Badge variant={isDevelopmentFallback ? "warning" : "danger"}>
          <ShieldAlert className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Safety
        </Badge>
        <h1 className="mt-4 text-3xl font-semibold sm:text-4xl">Moderation dashboard</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Review reports, track account deletion audits, and keep safety work separate from normal friend activity.
        </p>
        <p
          className={cn(
            "mt-4 rounded-md border px-3 py-2 text-sm",
            result.ok
              ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
              : "border-amber-300/25 bg-amber-300/10 text-amber-100"
          )}
          role="status"
        >
          {isPending ? "Saving..." : result.message}
        </p>
        {isDevelopmentFallback ? (
          <p className="mt-3 text-xs leading-5 text-amber-100">
            Local development fallback is active. Set ADMIN_EMAILS before production use.
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label} className="p-4">
            <p className="text-sm text-muted-foreground">{metric.label}</p>
            <p className="mt-2 text-3xl font-semibold">{metric.value}</p>
            <Badge variant={metric.tone} className="mt-3">
              Safety metric
            </Badge>
          </Card>
        ))}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">Reports</h2>
          <Badge variant="blue">{reports.length} total</Badge>
        </div>
        {reports.length === 0 ? (
          <Card className="p-5 text-sm text-muted-foreground">No reports yet.</Card>
        ) : (
          <div className="grid gap-4">
            {reports.map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                disabled={isPending}
                onStatus={updateStatus}
                onBlock={blockReportedUser}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">Deletion audits</h2>
          <Badge variant="warning">{deletionAudits.length} recent</Badge>
        </div>
        {deletionAudits.length === 0 ? (
          <Card className="p-5 text-sm text-muted-foreground">No deletion audit records yet.</Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {deletionAudits.map((audit) => (
              <Card key={audit.id} className="p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-red-300/10 text-red-100">
                    <Trash2 className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold">{audit.deletedUserLabel}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDate(audit.deletedAt)}</p>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      {audit.deletionReason || "No reason provided."}
                    </p>
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">
                      {audit.retainedReportReference || "No retained report reference."}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

type ReportCardProps = {
  report: SafetyReport;
  disabled: boolean;
  onStatus: (reportId: string, status: ReportStatus) => void;
  onBlock: (reportId: string) => void;
};

function ReportCard({ report, disabled, onStatus, onBlock }: ReportCardProps) {
  return (
    <Card className="p-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_auto]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusTone(report.status)}>{report.status}</Badge>
            <span className="text-xs text-muted-foreground">{formatDate(report.createdAt)}</span>
          </div>
          <h3 className="mt-3 text-lg font-semibold">{report.reason}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {report.description || "No extra description."}
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <PersonLine icon={UserRound} label="Reporter" value={report.reporterLabel} id={report.reporterId} />
            <PersonLine icon={Ban} label="Reported" value={report.reportedUserLabel} id={report.reportedUserId} />
          </div>
        </div>
        <div className="grid content-start gap-2 sm:grid-cols-2 xl:w-72">
          {statusOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={report.status === option.value ? "primary" : "outline"}
              size="sm"
              disabled={disabled}
              onClick={() => onStatus(report.id, option.value)}
            >
              <option.icon className="h-4 w-4" aria-hidden="true" />
              {option.label}
            </Button>
          ))}
          <Button
            type="button"
            variant="danger"
            size="sm"
            className="sm:col-span-2"
            disabled={disabled || !report.reportedUserId}
            onClick={() => onBlock(report.id)}
          >
            <Ban className="h-4 w-4" aria-hidden="true" />
            Moderator block
          </Button>
        </div>
      </div>
    </Card>
  );
}

type PersonLineProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  id: string | null;
};

function PersonLine({ icon: Icon, label, value, id }: PersonLineProps) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-2 truncate text-sm font-semibold">{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{id ?? "Deleted user"}</p>
    </div>
  );
}

function statusTone(status: ReportStatus) {
  const tones: Record<ReportStatus, "danger" | "warning" | "green" | "default"> = {
    open: "danger",
    reviewing: "warning",
    resolved: "green",
    dismissed: "default"
  };

  return tones[status];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
