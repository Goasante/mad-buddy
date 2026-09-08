"use client";

import { Check, Copy, History, RefreshCw, Search, Stethoscope, Wrench } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { signalAccountRefreshAction } from "@/app/(admin)/admin/repairs/doctor-actions";
import {
  diagnoseCombinedAccountAction,
  type CombinedAccountDoctorSeverity,
  type CombinedAccountDoctorState
} from "@/app/(admin)/admin/repairs/combined-doctor-actions";
import {
  getRecentRepairsAction,
  runAccountRepairAction,
  searchRepairUsersAction,
  type RepairHistoryEntry,
  type RepairUser
} from "@/app/(admin)/admin/repairs/actions";
import { AdminSection, AdminStatus, formatAdminDate } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  OUTCOME_GUIDANCE,
  OUTCOME_LABEL,
  type RepairOutcome,
  type RepairVerification
} from "@/lib/admin/repair-verification";
import { getRepair, repairRiskTone, repairsByCategory, type RepairDefinition } from "@/lib/admin/repairs";
import { cn } from "@/lib/utils";

type RepairFeedback = {
  kind: "repair" | "signal";
  ok: boolean;
  text: string;
  verification?: RepairVerification;
};

export function RepairCentre({
  allowedRepairIds,
  initialQuery = "",
  prioritisedAreas = []
}: {
  allowedRepairIds: string[];
  initialQuery?: string;
  /**
   * Doctor areas to surface first, derived SERVER-SIDE from the support
   * ticket's category. Ordering only -- it never changes which checks run,
   * which repairs are offered, or what any of them are allowed to do.
   */
  prioritisedAreas?: string[];
}) {
  const allowed = new Set(allowedRepairIds);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<RepairUser[] | null>(null);
  const [searchMessage, setSearchMessage] = useState("");
  const [selected, setSelected] = useState<RepairUser | null>(null);
  const [copiedUserId, setCopiedUserId] = useState(false);
  const [history, setHistory] = useState<RepairHistoryEntry[]>([]);
  const [doctor, setDoctor] = useState<CombinedAccountDoctorState | null>(null);
  const [pendingRepair, setPendingRepair] = useState<RepairDefinition | null>(null);
  const [feedback, setFeedback] = useState<RepairFeedback | null>(null);
  const [isSearching, startSearch] = useTransition();
  const [isDiagnosing, startDiagnosis] = useTransition();
  const [isSignalingRefresh, startRefreshSignal] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const term = query.trim();
    debounce.current = setTimeout(
      () => {
        if (term.length < 2) {
          setResults(null);
          setSearchMessage("");
          return;
        }
        startSearch(async () => {
          const state = await searchRepairUsersAction({ query: term });
          setResults(state.results);
          setSearchMessage(state.ok ? (state.results.length === 0 ? "No matching accounts." : "") : state.message);
        });
      },
      term.length < 2 ? 0 : 350
    );
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  function loadHistory(userId: string) {
    getRecentRepairsAction({ userId }).then((state) => setHistory(state.entries));
  }

  function loadDoctor(userId: string) {
    startDiagnosis(async () => {
      const state = await diagnoseCombinedAccountAction({ userId });
      setDoctor(state);
    });
  }

  function signalRefresh(userId: string) {
    startRefreshSignal(async () => {
      const result = await signalAccountRefreshAction({ userId });
      setFeedback({ kind: "signal", ok: result.ok, text: result.message });
      if (result.ok) loadHistory(userId);
    });
  }

  async function copySelectedUserId() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.userId);
      setCopiedUserId(true);
      window.setTimeout(() => setCopiedUserId(false), 1800);
    } catch {
      setCopiedUserId(false);
    }
  }

  function selectUser(user: RepairUser) {
    setSelected(user);
    setCopiedUserId(false);
    setResults(null);
    setQuery("");
    setFeedback(null);
    setDoctor(null);
    loadHistory(user.userId);
    loadDoctor(user.userId);
  }

  function clearSelected() {
    setSelected(null);
    setCopiedUserId(false);
    setHistory([]);
    setDoctor(null);
    setFeedback(null);
  }

  const groups = repairsByCategory()
    .map((group) => ({ ...group, repairs: group.repairs.filter((repair) => allowed.has(repair.id)) }))
    .filter((group) => group.repairs.length > 0);

  return (
    <div className="space-y-6">
      <AdminSection
        title="Find an account"
        description="Search by display name or username. Account Doctor checks safe lifecycle metadata as soon as you choose one."
      >
        {selected ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <UserAvatar src={selected.avatarUrl} name={selected.name} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{selected.name}</p>
                <p className="truncate text-xs text-muted-foreground">@{selected.username}</p>
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">User ID</span>
                  <code className="break-all font-mono text-[11px] text-muted-foreground" title={selected.userId}>
                    {selected.userId}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={copySelectedUserId}
                    aria-label={copiedUserId ? "User ID copied" : "Copy user ID"}
                  >
                    {copiedUserId ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                    {copiedUserId ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={clearSelected}>
              Change account
            </Button>
          </Card>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search accounts"
                aria-label="Search accounts"
                className="pl-9"
              />
            </div>
            <div className="mt-3">
              {isSearching ? (
                <p className="px-1 text-xs text-muted-foreground">Searching…</p>
              ) : searchMessage ? (
                <p className="px-1 text-xs text-muted-foreground" role="status">{searchMessage}</p>
              ) : results && results.length > 0 ? (
                <ul className="grid gap-2">
                  {results.map((user) => (
                    <li key={user.userId}>
                      <button type="button" onClick={() => selectUser(user)} className="focus-ring w-full rounded-xl text-left">
                        <Card className="flex items-center gap-3 p-3 hover:border-primary/35">
                          <UserAvatar src={user.avatarUrl} name={user.name} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{user.name}</p>
                            <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
                          </div>
                        </Card>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-1 text-xs text-muted-foreground">Search for the account you want to diagnose or repair.</p>
              )}
            </div>
          </>
        )}
      </AdminSection>

      {feedback ? <RepairFeedbackPanel feedback={feedback} /> : null}

      {selected ? (
        <AccountDoctorPanel
          state={doctor}
          pending={isDiagnosing}
          refreshSignalPending={isSignalingRefresh}
          allowedRepairIds={allowedRepairIds}
          prioritisedAreas={prioritisedAreas}
          onCheckAgain={() => loadDoctor(selected.userId)}
          onSignalRefresh={() => signalRefresh(selected.userId)}
          onRepair={(repairId) => {
            const repair = getRepair(repairId);
            if (repair && allowed.has(repair.id)) setPendingRepair(repair);
          }}
        />
      ) : null}

      {selected ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <div className="space-y-5">
            {groups.map((group) => (
              <AdminSection key={group.category} title={group.category}>
                <div className="grid gap-2">
                  {group.repairs.map((repair) => (
                    <Card key={repair.id} className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">{repair.label}</p>
                          <AdminStatus label={`${repair.risk} risk`} tone={repairRiskTone(repair.risk)} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{repair.description}</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={repair.risk === "high" ? "danger" : "outline"}
                        onClick={() => setPendingRepair(repair)}
                      >
                        <Wrench className="h-4 w-4" aria-hidden="true" /> Run
                      </Button>
                    </Card>
                  ))}
                </div>
              </AdminSection>
            ))}
            {groups.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">You don’t have permission to run any repairs.</p>
            ) : null}
          </div>
          <RepairHistory entries={history} />
        </div>
      ) : null}

      <RepairConfirmDialog
        repair={pendingRepair}
        user={selected}
        onClose={() => setPendingRepair(null)}
        onDone={(result) => {
          setFeedback(result);
          setPendingRepair(null);
          if (result.ok && selected) {
            loadHistory(selected.userId);
            loadDoctor(selected.userId);
          }
        }}
      />
    </div>
  );
}

function RepairFeedbackPanel({ feedback }: { feedback: RepairFeedback }) {
  const verification = feedback.verification;
  return (
    <div
      className={cn(
        "rounded-xl border p-3 text-sm",
        verification ? verificationPanelClass(verification.outcome) : feedback.ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
          : "border-amber-500/30 bg-amber-500/10 text-amber-100"
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{feedback.text}</p>
        {verification ? (
          <AdminStatus label={OUTCOME_LABEL[verification.outcome]} tone={verificationStatusTone(verification.outcome)} />
        ) : null}
      </div>

      {verification ? (
        <div className="mt-2 space-y-1.5">
          <p className="leading-relaxed">{verification.summary}</p>
          <p className="text-xs opacity-85">
            <span className="font-semibold">Verified invariant:</span> {verification.invariant}
          </p>
          {verification.rule ? (
            <p className="text-xs opacity-85">
              <span className="font-semibold">Product rule:</span> {verification.rule}
            </p>
          ) : null}
          <p className="text-xs opacity-85">
            <span className="font-semibold">Next:</span> {OUTCOME_GUIDANCE[verification.outcome]}
          </p>
        </div>
      ) : feedback.kind === "repair" && feedback.ok ? (
        <p className="mt-2 text-xs opacity-85">
          This repair does not yet have an invariant verifier. The mutation was accepted, but the user-facing problem is not confirmed fixed.
        </p>
      ) : null}
    </div>
  );
}

function verificationStatusTone(outcome: RepairOutcome): "success" | "warning" | "danger" | "default" {
  if (outcome === "fixed") return "success";
  if (outcome === "still_broken") return "danger";
  if (outcome === "blocked_by_product_rule") return "warning";
  return "default";
}

function verificationPanelClass(outcome: RepairOutcome) {
  if (outcome === "fixed") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  if (outcome === "still_broken") return "border-red-500/30 bg-red-500/10 text-red-100";
  if (outcome === "blocked_by_product_rule") return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  return "border-border bg-muted/30 text-foreground";
}

function AccountDoctorPanel({
  state,
  pending,
  refreshSignalPending,
  allowedRepairIds,
  prioritisedAreas,
  onCheckAgain,
  onSignalRefresh,
  onRepair
}: {
  state: CombinedAccountDoctorState | null;
  pending: boolean;
  refreshSignalPending: boolean;
  allowedRepairIds: string[];
  prioritisedAreas: string[];
  onCheckAgain: () => void;
  onSignalRefresh: () => void;
  onRepair: (repairId: string) => void;
}) {
  const allowed = new Set(allowedRepairIds);

  return (
    <AdminSection
      title="Account Doctor"
      description="Checks lifecycle metadata only — never message bodies, exact location, private media, payment credentials, push tokens, raw DOB, or Safe Arrival details."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <Stethoscope className="h-4 w-4" aria-hidden="true" />
          </span>
          <span>{pending ? "Checking account health…" : state?.message ?? "Run a health check for this account."}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCheckAgain} disabled={pending}>
            <Stethoscope className="h-4 w-4" aria-hidden="true" />
            {state ? "Check again" : "Run check"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onSignalRefresh} disabled={refreshSignalPending}>
            <RefreshCw className={cn("h-4 w-4", refreshSignalPending && "animate-spin")} aria-hidden="true" />
            Refresh user app
          </Button>
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        “Refresh user app” changes no account data. It sends an audited refresh signal; an already-open signed-in app refreshes on foreground or within about a minute.
      </p>

      {state?.ok ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <AdminStatus label={`${state.summary.issue} issues`} tone={state.summary.issue > 0 ? "danger" : "success"} />
            <AdminStatus label={`${state.summary.attention} attention`} tone={state.summary.attention > 0 ? "warning" : "default"} />
            <AdminStatus label={`${state.summary.productRule} product rules`} tone={state.summary.productRule > 0 ? "warning" : "default"} />
            <AdminStatus label={`${state.summary.healthy} healthy`} tone="success" />
            <AdminStatus label={`${state.summary.info} info`} />
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {orderFindings(state.findings, prioritisedAreas).map((finding) => (
              <Card key={finding.id} className="flex min-h-[116px] flex-col justify-between gap-3 p-3.5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{finding.title}</p>
                    <AdminStatus label={finding.area} />
                    <AdminStatus label={doctorSeverityLabel(finding.severity)} tone={doctorTone(finding.severity)} />
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{finding.detail}</p>
                </div>
                {finding.repairId && allowed.has(finding.repairId) ? (
                  <div>
                    <Button type="button" variant="outline" size="sm" onClick={() => onRepair(finding.repairId!)}>
                      <Wrench className="h-4 w-4" aria-hidden="true" /> Recommended repair
                    </Button>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        </>
      ) : state && !state.ok ? (
        <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-100" role="status">
          {state.message}
        </p>
      ) : null}
    </AdminSection>
  );
}

/**
 * Puts the areas a support ticket is about at the top.
 *
 * ORDERING ONLY. Nothing is filtered out: an operator who opens the Doctor from
 * a billing ticket must still see a safety finding, and hiding a finding
 * because the ticket did not mention it is how a real problem gets missed. The
 * sort is stable, so everything else keeps its severity order.
 *
 * The catalog ids the prioritiser returns (`direct-messaging`) and the finding
 * areas the Doctor renders ("Messaging") are different vocabularies, so this
 * maps between them rather than assuming they match.
 */
const AREA_FOR_CATALOG_ID: Record<string, string> = {
  "account-auth": "Account",
  "onboarding-activation": "Account",
  "profile-media": "Account",
  "dob-age": "Account",
  "muddies-requests": "Relationships",
  "blocks-refriend": "Relationships",
  "direct-messaging": "Messaging",
  "plan-chat": "Plans",
  plans: "Plans",
  upfor: "UpFor",
  linkr: "Relationships",
  presence: "Presence",
  notifications: "Notifications",
  push: "Notifications",
  events: "Plans",
  "safe-arrival": "Account",
  "access-billing": "Access",
  "features-tours": "Access",
  journey: "Account",
  "privacy-account-ops": "Account"
};

export function orderFindings<T extends { area: string }>(findings: T[], prioritisedAreas: string[]): T[] {
  if (prioritisedAreas.length === 0) return findings;
  const rank = new Map<string, number>();
  prioritisedAreas.forEach((catalogId, index) => {
    const area = AREA_FOR_CATALOG_ID[catalogId];
    if (area && !rank.has(area)) rank.set(area, index);
  });
  if (rank.size === 0) return findings;
  return [...findings].sort(
    (a, b) => (rank.get(a.area) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.area) ?? Number.MAX_SAFE_INTEGER)
  );
}

function doctorTone(severity: CombinedAccountDoctorSeverity): "success" | "warning" | "danger" | "default" {
  if (severity === "issue") return "danger";
  if (severity === "attention" || severity === "product_rule") return "warning";
  if (severity === "healthy") return "success";
  return "default";
}

function doctorSeverityLabel(severity: CombinedAccountDoctorSeverity) {
  if (severity === "issue") return "Issue";
  if (severity === "attention") return "Needs attention";
  if (severity === "product_rule") return "Product rule";
  if (severity === "healthy") return "Healthy";
  return "Info";
}

function RepairHistory({ entries }: { entries: RepairHistoryEntry[] }) {
  return (
    <Card className="p-4">
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold">
        <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Recent repairs
      </p>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No repairs recorded for this account.</p>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {entries.map((entry) => (
            <li key={entry.id} className="border-l-2 border-border/60 pl-2.5">
              <p className="text-sm">{entry.repairLabel}</p>
              {entry.reason ? <p className="text-xs text-muted-foreground">{entry.reason}</p> : null}
              <p className="text-[11px] text-muted-foreground">{entry.actorName} · {formatAdminDate(entry.createdAt, true)}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function RepairConfirmDialog({
  repair,
  user,
  onClose,
  onDone
}: {
  repair: RepairDefinition | null;
  user: RepairUser | null;
  onClose: () => void;
  onDone: (result: RepairFeedback) => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const open = Boolean(repair && user);

  function run() {
    if (!repair || !user) return;
    start(async () => {
      const result = await runAccountRepairAction({
        userId: user.userId,
        repairId: repair.id,
        reason: reason.trim() || undefined
      });
      onDone({ kind: "repair", ok: result.ok, text: result.message, verification: result.verification });
      setReason("");
    });
  }

  useEffect(() => {
    if (open && repair && !repair.confirm && !repair.requiresReason) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!repair || !user) return null;
  if (!repair.confirm && !repair.requiresReason) return null;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
          setReason("");
        }
      }}
      title={`${repair.label}?`}
      description={repair.effect}
    >
      <div className="space-y-3">
        <div
          className={cn(
            "rounded-lg border p-2.5 text-xs",
            repair.risk === "high"
              ? "border-red-500/30 bg-red-500/10 text-red-200"
              : "border-amber-500/25 bg-amber-500/10 text-amber-100"
          )}
        >
          This will run against <span className="font-semibold">{user.name}</span> and is recorded in the audit log.
        </div>
        {repair.requiresReason ? (
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={300}
            placeholder="Reason for this repair"
            aria-label="Reason for this repair"
            className="focus-ring w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => { onClose(); setReason(""); }} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={repair.risk === "high" ? "danger" : "primary"}
            onClick={run}
            disabled={pending || (repair.requiresReason && reason.trim().length < 3)}
          >
            Run repair
          </Button>
        </div>
      </div>
    </Modal>
  );
}
