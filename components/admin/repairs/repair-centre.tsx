"use client";

import { History, Search, Wrench } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
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
import { repairRiskTone, repairsByCategory, type RepairDefinition } from "@/lib/admin/repairs";
import { cn } from "@/lib/utils";

export function RepairCentre({ allowedRepairIds }: { allowedRepairIds: string[] }) {
  const allowed = new Set(allowedRepairIds);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RepairUser[] | null>(null);
  const [searchMessage, setSearchMessage] = useState("");
  const [selected, setSelected] = useState<RepairUser | null>(null);
  const [history, setHistory] = useState<RepairHistoryEntry[]>([]);
  const [pendingRepair, setPendingRepair] = useState<RepairDefinition | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [isSearching, startSearch] = useTransition();
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

  function selectUser(user: RepairUser) {
    setSelected(user);
    setResults(null);
    setQuery("");
    setFeedback(null);
    loadHistory(user.userId);
  }

  const groups = repairsByCategory()
    .map((group) => ({ ...group, repairs: group.repairs.filter((repair) => allowed.has(repair.id)) }))
    .filter((group) => group.repairs.length > 0);

  return (
    <div className="space-y-6">
      {/* Step 1: find an account */}
      <AdminSection title="Find an account" description="Search by display name or username, then choose the account to repair.">
        {selected ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-3.5">
            <div className="flex items-center gap-3">
              <UserAvatar src={selected.avatarUrl} name={selected.name} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{selected.name}</p>
                <p className="truncate text-xs text-muted-foreground">@{selected.username}</p>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => { setSelected(null); setHistory([]); setFeedback(null); }}>
              Change account
            </Button>
          </Card>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search accounts" aria-label="Search accounts" className="pl-9" />
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
                <p className="px-1 text-xs text-muted-foreground">Search for the account you want to repair.</p>
              )}
            </div>
          </>
        )}
      </AdminSection>

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

      {/* Step 2: choose a repair */}
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
          if (result.ok && selected) loadHistory(selected.userId);
        }}
      />
    </div>
  );
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
  onDone: (result: { ok: boolean; text: string }) => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  // Low-risk repairs with no confirmation still route through here for a single
  // consistent run path, but auto-run without a modal body when opened.
  const open = Boolean(repair && user);

  function run() {
    if (!repair || !user) return;
    start(async () => {
      const result = await runAccountRepairAction({ userId: user.userId, repairId: repair.id, reason: reason.trim() || undefined });
      onDone({ ok: result.ok, text: result.message });
      setReason("");
    });
  }

  // Auto-run repairs that need neither confirmation nor a reason.
  useEffect(() => {
    if (open && repair && !repair.confirm && !repair.requiresReason) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!repair || !user) return null;
  if (!repair.confirm && !repair.requiresReason) return null; // handled by auto-run

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) { onClose(); setReason(""); } }} title={`${repair.label}?`} description={repair.effect}>
      <div className="space-y-3">
        <div className={cn("rounded-lg border p-2.5 text-xs", repair.risk === "high" ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-amber-500/25 bg-amber-500/10 text-amber-100")}>
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
          <Button type="button" variant="outline" onClick={() => { onClose(); setReason(""); }} disabled={pending}>Cancel</Button>
          <Button type="button" variant={repair.risk === "high" ? "danger" : "primary"} onClick={run} disabled={pending || (repair.requiresReason && reason.trim().length < 3)}>
            Run repair
          </Button>
        </div>
      </div>
    </Modal>
  );
}
