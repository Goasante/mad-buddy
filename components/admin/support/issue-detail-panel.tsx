"use client";

import { Check, Copy, Lock, MessageSquare, RotateCcw, Send, ShieldAlert } from "lucide-react";
import { useState, useTransition } from "react";
import {
  addInternalNoteAction,
  assignSupportIssueAction,
  sendPublicResponseAction,
  updateSupportIssuePriorityAction,
  updateSupportIssueStatusAction
} from "@/app/(admin)/admin/support/actions";
import { AdminSection, formatAdminDate } from "@/components/admin/admin-ui";
import { IssuePriorityBadge, IssueStatusBadge } from "@/components/admin/support/issue-badges";
import { AppSelect, type AppSelectOption } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  allowedTransitions,
  categoryLabel,
  priorityLabel,
  SUPPORT_PRIORITIES,
  SUPPORT_TEMPLATES,
  statusLabel,
  type SupportPriority,
  type SupportStatus
} from "@/lib/admin/support";
import { cn } from "@/lib/utils";

export type IssueDetailData = {
  id: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  affectedFeature: string | null;
  platform: string | null;
  appVersion: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  user: { id: string; name: string; username: string | null; avatarUrl: string | null; plan: string | null } | null;
  messages: { id: string; senderType: string; authorName: string; message: string; createdAt: string }[];
  internalNotes: { id: string; authorName: string; body: string; createdAt: string }[];
  timeline: { id: string; label: string; note: string | null; actorName: string; createdAt: string }[];
  staff: { id: string; name: string }[];
  actorId: string;
};

type Feedback = { ok: boolean; text: string } | null;

export function IssueDetailPanel({ data }: { data: IssueDetailData }) {
  const [feedback, setFeedback] = useState<Feedback>(null);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <IssuePriorityBadge priority={data.priority} />
            <IssueStatusBadge status={data.status} />
            <span className="text-xs text-muted-foreground">{categoryLabel(data.category)}</span>
          </div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{data.subject}</h1>
          <CopyableId id={data.id} />
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
        {/* Conversation + composers (wider) */}
        <div className="order-2 space-y-5 lg:order-1">
          <AdminSection title="Conversation" description="The user’s original report and every public response.">
            <div className="space-y-2.5">
              <Card className="border-l-2 border-l-primary/40 p-3.5">
                <p className="text-xs font-semibold text-muted-foreground">Original report</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{data.description}</p>
                <time className="mt-2 block text-[11px] text-muted-foreground">{formatAdminDate(data.createdAt, true)}</time>
              </Card>
              {data.messages.map((message) => (
                <Card
                  key={message.id}
                  className={cn("p-3.5", message.senderType === "agent" && "border-l-2 border-l-emerald-500/40 bg-emerald-500/[0.04]")}
                >
                  <p className="text-xs font-semibold">
                    {message.senderType === "agent" ? "Support response" : message.senderType === "user" ? "User reply" : "System"}
                    <span className="ml-1.5 font-normal text-muted-foreground">· {message.authorName}</span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{message.message}</p>
                  <time className="mt-2 block text-[11px] text-muted-foreground">{formatAdminDate(message.createdAt, true)}</time>
                </Card>
              ))}
            </div>
          </AdminSection>

          <Composers issueId={data.id} onFeedback={setFeedback} internalNotes={data.internalNotes} />
        </div>

        {/* Metadata + controls (narrow) */}
        <div className="order-1 space-y-4 lg:order-2">
          <UserSummary user={data.user} />

          <Card className="space-y-3 p-4">
            <AssignmentControl
              issueId={data.id}
              assignedTo={data.assignedTo}
              assignedName={data.assignedName}
              actorId={data.actorId}
              staff={data.staff}
              onFeedback={setFeedback}
            />
            <StatusControl issueId={data.id} status={data.status as SupportStatus} onFeedback={setFeedback} />
            <PriorityControl issueId={data.id} priority={data.priority as SupportPriority} onFeedback={setFeedback} />
          </Card>

          <Card className="space-y-2 p-4 text-sm">
            <MetaRow label="Affected feature" value={data.affectedFeature} />
            <MetaRow label="Platform" value={data.platform} />
            <MetaRow label="App version" value={data.appVersion} />
            <MetaRow label="Created" value={formatAdminDate(data.createdAt, true)} />
            <MetaRow label="Updated" value={formatAdminDate(data.updatedAt, true)} />
            {data.resolvedAt ? <MetaRow label="Resolved" value={formatAdminDate(data.resolvedAt, true)} /> : null}
          </Card>

          <Timeline entries={data.timeline} />
        </div>
      </div>
    </div>
  );
}

function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="focus-ring mt-1.5 inline-flex items-center gap-1.5 rounded-md text-[11px] text-muted-foreground hover:text-foreground"
      aria-label="Copy issue ID"
    >
      {copied ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
      <span className="font-mono">{id}</span>
    </button>
  );
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-sm">{value ?? "—"}</span>
    </div>
  );
}

function UserSummary({ user }: { user: IssueDetailData["user"] }) {
  if (!user) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">The reporting account is no longer available.</p>
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <UserAvatar src={user.avatarUrl} name={user.name} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{user.name}</p>
          {user.username ? <p className="truncate text-xs text-muted-foreground">@{user.username}</p> : null}
        </div>
      </div>
      {user.plan ? <p className="mt-3 text-xs text-muted-foreground">Plan: <span className="text-foreground">{user.plan}</span></p> : null}
    </Card>
  );
}

// --- Controls -------------------------------------------------------------
function AssignmentControl({
  issueId,
  assignedTo,
  assignedName,
  actorId,
  staff,
  onFeedback
}: {
  issueId: string;
  assignedTo: string | null;
  assignedName: string | null;
  actorId: string;
  staff: { id: string; name: string }[];
  onFeedback: (feedback: Feedback) => void;
}) {
  const [pending, start] = useTransition();
  const options: AppSelectOption[] = [
    { value: "unassigned", label: "Unassigned" },
    ...staff.map((member) => ({ value: member.id, label: member.name }))
  ];

  function assign(value: string) {
    start(async () => {
      const result = await assignSupportIssueAction({ ticketId: issueId, assigneeId: value === "unassigned" ? null : value });
      onFeedback({ ok: result.ok, text: result.message });
    });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">Assigned to</label>
        {assignedTo !== actorId ? (
          <button
            type="button"
            onClick={() => assign(actorId)}
            disabled={pending}
            className="focus-ring text-xs font-medium text-primary hover:underline disabled:opacity-50"
          >
            Assign to me
          </button>
        ) : null}
      </div>
      <AppSelect
        size="compact"
        value={assignedTo ?? "unassigned"}
        options={options}
        searchable
        placeholder="Unassigned"
        disabled={pending}
        onChange={assign}
      />
      {assignedName ? <p className="text-[11px] text-muted-foreground">Currently {assignedName}</p> : null}
    </div>
  );
}

function StatusControl({
  issueId,
  status,
  onFeedback
}: {
  issueId: string;
  status: SupportStatus;
  onFeedback: (feedback: Feedback) => void;
}) {
  const [pending, start] = useTransition();
  const nextOptions: AppSelectOption[] = allowedTransitions(status).map((value) => ({ value, label: statusLabel(value) }));

  function change(next: string) {
    if (next === status) return;
    start(async () => {
      const result = await updateSupportIssueStatusAction({ ticketId: issueId, status: next });
      onFeedback({ ok: result.ok, text: result.message });
    });
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">Status</label>
      <AppSelect
        size="compact"
        value={status}
        options={[{ value: status, label: `${statusLabel(status)} (current)`, disabled: true }, ...nextOptions]}
        disabled={pending || nextOptions.length === 0}
        onChange={change}
      />
    </div>
  );
}

function PriorityControl({
  issueId,
  priority,
  onFeedback
}: {
  issueId: string;
  priority: SupportPriority;
  onFeedback: (feedback: Feedback) => void;
}) {
  const [pending, start] = useTransition();
  const [criticalOpen, setCriticalOpen] = useState(false);
  const [reason, setReason] = useState("");
  const options: AppSelectOption[] = SUPPORT_PRIORITIES.map((value) => ({ value, label: priorityLabel(value) }));

  function apply(next: SupportPriority, withReason?: string) {
    start(async () => {
      const result = await updateSupportIssuePriorityAction({ ticketId: issueId, priority: next, reason: withReason });
      onFeedback({ ok: result.ok, text: result.message });
      if (result.ok) {
        setCriticalOpen(false);
        setReason("");
      }
    });
  }

  function change(next: string) {
    if (next === priority) return;
    // Critical (urgent) needs a confirmation + written reason.
    if (next === "urgent") {
      setCriticalOpen(true);
      return;
    }
    apply(next as SupportPriority);
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">Priority</label>
      <AppSelect size="compact" value={priority} options={options} disabled={pending} onChange={change} />

      <Modal
        open={criticalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCriticalOpen(false);
            setReason("");
          }
        }}
        title="Set Critical priority?"
        description="Use Critical only for serious privacy failure, a broad outage, payment corruption, major authentication failure, widespread data loss, or a high-impact security event. This will be recorded."
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200">
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            Critical is high-visibility. Add a short reason so the escalation is auditable.
          </div>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={280}
            placeholder="Why does this need Critical priority?"
            className="focus-ring w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { setCriticalOpen(false); setReason(""); }} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={() => apply("urgent", reason)} disabled={pending || reason.trim().length < 3}>
              Set Critical
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// --- Composers ------------------------------------------------------------
type ComposerStatus = "idle" | "sending" | "sent" | "failed";

function Composers({
  issueId,
  internalNotes,
  onFeedback
}: {
  issueId: string;
  internalNotes: IssueDetailData["internalNotes"];
  onFeedback: (feedback: Feedback) => void;
}) {
  const [mode, setMode] = useState<"public" | "internal">("public");

  return (
    <AdminSection title="Respond" description="Choose carefully: a public response is sent to the user; an internal note is staff-only.">
      <div className="inline-flex rounded-lg border border-border/70 bg-card/60 p-1">
        <button
          type="button"
          onClick={() => setMode("public")}
          className={cn(
            "focus-ring inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === "public" ? "bg-emerald-500/15 text-emerald-200" : "text-muted-foreground hover:text-foreground"
          )}
          aria-pressed={mode === "public"}
        >
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" /> Response to user
        </button>
        <button
          type="button"
          onClick={() => setMode("internal")}
          className={cn(
            "focus-ring inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === "internal" ? "bg-amber-500/15 text-amber-200" : "text-muted-foreground hover:text-foreground"
          )}
          aria-pressed={mode === "internal"}
        >
          <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Internal note
        </button>
      </div>

      {mode === "public" ? (
        <PublicResponseComposer issueId={issueId} onFeedback={onFeedback} />
      ) : (
        <InternalNoteComposer issueId={issueId} notes={internalNotes} onFeedback={onFeedback} />
      )}
    </AdminSection>
  );
}

function PublicResponseComposer({ issueId, onFeedback }: { issueId: string; onFeedback: (feedback: Feedback) => void }) {
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<ComposerStatus>("idle");
  const [pending, start] = useTransition();
  const templateOptions: AppSelectOption[] = SUPPORT_TEMPLATES.map((template) => ({ value: template.id, label: template.label }));

  function send() {
    setStatus("sending");
    start(async () => {
      const result = await sendPublicResponseAction({ ticketId: issueId, body });
      onFeedback({ ok: result.ok, text: result.message });
      if (result.ok) {
        setStatus("sent");
        setBody("");
        setTimeout(() => setStatus("idle"), 2000);
      } else {
        setStatus("failed");
      }
    });
  }

  return (
    <div className="mt-3 space-y-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-200">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" /> Visible to the user · sends a notification
        </p>
        <div className="w-52">
          <AppSelect
            size="compact"
            value={null}
            options={templateOptions}
            placeholder="Insert template"
            searchable
            onChange={(id) => {
              const template = SUPPORT_TEMPLATES.find((item) => item.id === id);
              if (template) setBody((current) => (current ? `${current}\n\n${template.body}` : template.body));
            }}
          />
        </div>
      </div>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={5}
        maxLength={5000}
        placeholder="Write a response to the user"
        aria-label="Response to user"
        className="focus-ring w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground" role="status">
          {status === "sending" ? "Sending…" : status === "sent" ? "Sent" : status === "failed" ? "Couldn’t send." : ""}
        </p>
        <div className="flex gap-2">
          {status === "failed" ? (
            <Button type="button" variant="outline" size="sm" onClick={send} disabled={pending}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Retry
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={send} disabled={pending || body.trim().length < 2}>
            <Send className="h-4 w-4" aria-hidden="true" /> Send response
          </Button>
        </div>
      </div>
    </div>
  );
}

function InternalNoteComposer({
  issueId,
  notes,
  onFeedback
}: {
  issueId: string;
  notes: IssueDetailData["internalNotes"];
  onFeedback: (feedback: Feedback) => void;
}) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const result = await addInternalNoteAction({ ticketId: issueId, body });
      onFeedback({ ok: result.ok, text: result.message });
      if (result.ok) setBody("");
    });
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="space-y-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-3.5">
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-200">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Staff-only — the user will NOT see this
        </p>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          maxLength={5000}
          placeholder="Add an internal note"
          aria-label="Add an internal note"
          className="focus-ring w-full resize-y rounded-xl border border-amber-500/30 bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" onClick={save} disabled={pending || body.trim().length < 2}>
            <Lock className="h-4 w-4" aria-hidden="true" /> Save internal note
          </Button>
        </div>
      </div>

      {notes.length > 0 ? (
        <div className="space-y-2">
          {notes.map((note) => (
            <div key={note.id} className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3">
              <p className="text-xs font-semibold text-amber-200">
                <Lock className="mr-1 inline h-3 w-3" aria-hidden="true" />
                Internal · {note.authorName}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{note.body}</p>
              <time className="mt-2 block text-[11px] text-muted-foreground">{formatAdminDate(note.createdAt, true)}</time>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-1 text-xs text-muted-foreground">No internal notes yet.</p>
      )}
    </div>
  );
}

function Timeline({ entries }: { entries: IssueDetailData["timeline"] }) {
  return (
    <AdminSection title="History" description="Assignment, status, priority, and audit activity.">
      {entries.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="space-y-2.5">
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm">{entry.label}</p>
                {entry.note ? <p className="text-xs text-muted-foreground">{entry.note}</p> : null}
                <p className="text-[11px] text-muted-foreground">
                  {entry.actorName} · {formatAdminDate(entry.createdAt, true)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </AdminSection>
  );
}
