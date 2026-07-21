"use client";

import { ShieldAlert, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { applyModerationActionAction, setReportStatusAction } from "@/app/(admin)/admin/reports/actions";
import { AdminSection, AdminStatus, formatAdminDate, humanizeAdminValue } from "@/components/admin/admin-ui";
import { ReportCategoryBadge, ReportStatusBadge } from "@/components/admin/moderation/report-badges";
import { AppSelect, type AppSelectOption } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  allowedReportTransitions,
  availableModerationActions,
  categoryLabel,
  isAccountSuspension,
  MODERATION_ACTION_LABELS,
  moderationActionToRestriction,
  moderationTakesDuration,
  reportStatusLabel,
  type ModerationActionType,
  type ReportKind
} from "@/lib/admin/moderation";
import { cn } from "@/lib/utils";

export type ReportReviewData = {
  kind: ReportKind;
  id: string;
  status: string;
  primary: string;
  detail: string | null;
  category: string | null;
  contentTypeLabel: string | null;
  createdAt: string;
  reported: {
    id: string;
    name: string;
    username: string | null;
    avatarUrl: string | null;
    totalReports: number;
    activeRestrictions: { type: string; endsAt: string | null }[];
  } | null;
  reporterName: string;
  history: { id: string; label: string; note: string | null; actorName: string; createdAt: string }[];
};

type Feedback = { ok: boolean; text: string } | null;

export function ReportReviewPanel({ data }: { data: ReportReviewData }) {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [status, setStatus] = useState(data.status);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {data.kind === "content" ? <ReportCategoryBadge category={data.primary} /> : null}
            <ReportStatusBadge kind={data.kind} status={status} />
            <span className="text-xs text-muted-foreground">Reported {formatAdminDate(data.createdAt, true)}</span>
          </div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
            {data.kind === "content" ? `${categoryLabel(data.primary)} report` : humanizeAdminValue(data.primary)}
          </h1>
          {data.contentTypeLabel ? <p className="mt-1 text-sm text-muted-foreground">On a {data.contentTypeLabel.toLowerCase()}</p> : null}
        </div>
      </header>

      {feedback ? (
        <div
          className={cn(
            "rounded-xl border p-3 text-sm",
            feedback.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-100"
          )}
          role="status"
        >
          {feedback.text}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="order-2 space-y-5 lg:order-1">
          <AdminSection title="Report" description="What the reporter told us. Reported content itself is never shown here.">
            <Card className="p-3.5">
              {data.detail ? (
                <p className="whitespace-pre-wrap text-sm leading-6">{data.detail}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No extra detail was provided.</p>
              )}
            </Card>
          </AdminSection>

          <ActionControl kind={data.kind} reportId={data.id} hasReportedUser={Boolean(data.reported)} onFeedback={setFeedback} />

          <Timeline history={data.history} />
        </div>

        <div className="order-1 space-y-4 lg:order-2">
          <ReportedSummary reported={data.reported} reporterName={data.reporterName} />

          <Card className="space-y-1.5 p-4">
            <label className="text-xs font-medium text-muted-foreground">Status</label>
            <StatusControl
              kind={data.kind}
              reportId={data.id}
              status={status}
              onDone={(next, fb) => {
                setFeedback(fb);
                if (fb.ok) setStatus(next);
              }}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

function ReportedSummary({ reported, reporterName }: { reported: ReportReviewData["reported"]; reporterName: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground">Reported account</p>
      {reported ? (
        <>
          <div className="mt-2 flex items-center gap-3">
            <UserAvatar src={reported.avatarUrl} name={reported.name} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{reported.name}</p>
              {reported.username ? <p className="truncate text-xs text-muted-foreground">@{reported.username}</p> : null}
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{reported.totalReports} report{reported.totalReports === 1 ? "" : "s"} against this account</p>
          {reported.activeRestrictions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {reported.activeRestrictions.map((restriction) => (
                <AdminStatus
                  key={restriction.type}
                  label={humanizeAdminValue(restriction.type)}
                  tone={restriction.type.startsWith("suspended") ? "danger" : "warning"}
                />
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No active restrictions.</p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">The reported account is no longer available.</p>
      )}
      <div className="mt-3 border-t border-border/60 pt-3">
        <p className="text-xs font-medium text-muted-foreground">Reporter</p>
        <p className="mt-1 truncate text-sm">{reporterName}</p>
      </div>
    </Card>
  );
}

function StatusControl({
  kind,
  reportId,
  status,
  onDone
}: {
  kind: ReportKind;
  reportId: string;
  status: string;
  onDone: (next: string, feedback: { ok: boolean; text: string }) => void;
}) {
  const [pending, start] = useTransition();
  const options: AppSelectOption[] = [
    { value: status, label: `${reportStatusLabel(kind, status)} (current)`, disabled: true },
    ...allowedReportTransitions(kind, status).map((value) => ({ value, label: reportStatusLabel(kind, value) }))
  ];

  function change(next: string) {
    if (next === status) return;
    start(async () => {
      const result = await setReportStatusAction({ kind, reportId, status: next });
      onDone(next, { ok: result.ok, text: result.message });
    });
  }

  return <AppSelect size="compact" value={status} options={options} disabled={pending} onChange={change} />;
}

function ActionControl({
  kind,
  reportId,
  hasReportedUser,
  onFeedback
}: {
  kind: ReportKind;
  reportId: string;
  hasReportedUser: boolean;
  onFeedback: (feedback: Feedback) => void;
}) {
  const [action, setAction] = useState<ModerationActionType | null>(null);
  const [reason, setReason] = useState("");
  const [durationHours, setDurationHours] = useState("168");
  const [pending, start] = useTransition();

  const actionOptions: AppSelectOption<ModerationActionType>[] = availableModerationActions(kind).map((value) => ({
    value,
    label: MODERATION_ACTION_LABELS[value]
  }));
  const restriction = action ? moderationActionToRestriction(action) : null;
  const needsUser = Boolean(restriction);
  const suspension = action ? isAccountSuspension(action) : false;
  const takesDuration = action ? moderationTakesDuration(action) : false;
  const reasonRequired = action ? action !== "no_action" : false;
  const blocked = needsUser && !hasReportedUser;

  function submit() {
    if (!action) return;
    start(async () => {
      const result = await applyModerationActionAction({
        kind,
        reportId,
        actionType: action,
        reason: reason.trim() || undefined,
        durationHours: takesDuration ? Number(durationHours) : undefined
      });
      onFeedback({ ok: result.ok, text: result.message });
      if (result.ok) {
        setAction(null);
        setReason("");
      }
    });
  }

  return (
    <AdminSection title="Take action" description="Use the least severe effective action. Enforcement is applied through the audited restriction service.">
      <Card className="space-y-3 p-4">
        <AppSelect<ModerationActionType>
          value={action}
          options={actionOptions}
          placeholder="Choose an action"
          onChange={(value) => setAction(value)}
        />

        {action ? (
          <>
            {blocked ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                The reported account is unavailable, so account enforcement can’t be applied.
              </div>
            ) : null}

            {suspension ? (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200">
                <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                This suspends the account across every surface. It is appealable and recorded.
              </div>
            ) : null}

            {reasonRequired ? (
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Reason for this action (recorded in the audit log)"
                aria-label="Reason for this action"
                className="focus-ring w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
              />
            ) : null}

            {takesDuration ? (
              <div>
                <label className="text-xs font-medium text-muted-foreground" htmlFor="suspension-hours">Suspension length (hours)</label>
                <input
                  id="suspension-hours"
                  type="number"
                  min={1}
                  max={8760}
                  value={durationHours}
                  onChange={(event) => setDurationHours(event.target.value)}
                  className="focus-ring mt-1 w-32 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                />
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                variant={suspension ? "danger" : "primary"}
                disabled={pending || blocked || (reasonRequired && reason.trim().length < 3) || (takesDuration && !(Number(durationHours) > 0))}
                onClick={submit}
              >
                Apply {MODERATION_ACTION_LABELS[action].toLowerCase()}
              </Button>
            </div>
          </>
        ) : null}
      </Card>
    </AdminSection>
  );
}

function Timeline({ history }: { history: ReportReviewData["history"] }) {
  return (
    <AdminSection title="History" description="Moderation actions and audit activity for this report.">
      {history.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="space-y-2.5">
          {history.map((entry) => (
            <li key={entry.id} className="flex gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm">{entry.label}</p>
                {entry.note ? <p className="text-xs text-muted-foreground">{entry.note}</p> : null}
                <p className="text-[11px] text-muted-foreground">{entry.actorName} · {formatAdminDate(entry.createdAt, true)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </AdminSection>
  );
}
