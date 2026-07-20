"use client";

import { Search, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  assignStaffRoleAction,
  searchExistingUsersAction,
  type StaffSearchResult
} from "@/app/(admin)/admin/admins/actions";
import { AdminEmptyState, AdminSection, AdminStatus, formatAdminDate, humanizeAdminValue } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import { canAssignStaffRole, type StaffRole, type StaffStanding } from "@/lib/admin/governance";
import { cn } from "@/lib/utils";

export type TeamMember = {
  userId: string | null;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: StaffRole;
  active: boolean;
  addedBy: string | null;
  addedOn: string;
  lastActive: string | null;
  isCurrentUser: boolean;
};

type PendingChange = {
  target: { userId: string; displayName: string; currentRole: StaffStanding };
  requestedRole: StaffStanding;
};

const roleTone: Record<StaffRole, "success" | "warning" | "default"> = {
  owner: "warning",
  admin: "success",
  support: "default"
};

/** Actions available for a target, derived from the SAME matrix the server
 *  enforces — so a button never appears for something the server would reject. */
function availableActions(actorRole: StaffStanding, current: StaffStanding, isSelf: boolean) {
  const candidates: StaffStanding[] = ["admin", "support", "standard"];
  return candidates
    .filter((requested) => canAssignStaffRole({ actorRole, isSelf, targetCurrentRole: current, requestedRole: requested }).allowed)
    .map((requested) => ({ requested, label: actionLabel(requested, current) }));
}

function actionLabel(requested: StaffStanding, current: StaffStanding): string {
  if (requested === "standard") return "Remove access";
  if (requested === "support") return current === "admin" ? "Change to Support" : "Make Support";
  return "Make Admin";
}

export function TeamAccessManager({
  actorRole,
  team
}: {
  actorRole: StaffRole;
  team: TeamMember[];
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StaffSearchResult[] | null>(null);
  const [searchMessage, setSearchMessage] = useState("");
  const [emailsVisible, setEmailsVisible] = useState(false);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [isSearching, startSearch] = useTransition();
  const [isMutating, startMutate] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search (spec §6): one request per settled input, min 2 chars.
  // All state updates run inside the scheduled callback (never synchronously in
  // the effect body) to avoid cascading renders.
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
          const state = await searchExistingUsersAction({ query: term });
          setResults(state.results);
          setEmailsVisible(state.emailsVisible);
          setSearchMessage(state.ok ? (state.results.length === 0 ? "No matching users." : "") : state.message);
        });
      },
      term.length < 2 ? 0 : 350
    );
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  function confirmChange() {
    if (!pending) return;
    startMutate(async () => {
      const result = await assignStaffRoleAction({
        targetUserId: pending.target.userId,
        requestedRole: pending.requestedRole
      });
      setFeedback({ ok: result.ok, text: result.message });
      setPending(null);
      if (result.ok) {
        // Reflect the change in the open search results without a full reload.
        setResults((current) =>
          current
            ? current.map((entry) =>
                entry.userId === pending.target.userId ? { ...entry, currentRole: pending.requestedRole } : entry
              )
            : current
        );
      }
    });
  }

  return (
    <div className="space-y-7">
      {feedback ? (
        <div
          className={cn(
            "rounded-xl border p-3 text-sm",
            feedback.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-amber-500/30 bg-amber-500/10 text-amber-100"
          )}
          role="status"
        >
          {feedback.text}
        </div>
      ) : null}

      <AdminSection title="Add an existing user" description="Grant staff access to someone who already has a Mad Buddy account. No new account is created.">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search existing users"
            aria-label="Search existing users"
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
              {results.map((user) => {
                const actions = availableActions(actorRole, user.currentRole, false);
                return (
                  <li key={user.userId}>
                    <Card className="flex flex-wrap items-center gap-3 p-3">
                      <UserAvatar src={user.avatarUrl} name={user.displayName} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{user.displayName}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          @{user.username}
                          {emailsVisible && user.email ? ` · ${user.email}` : ""}
                        </p>
                      </div>
                      <AdminStatus
                        label={user.currentRole === "standard" ? "Standard user" : humanizeAdminValue(user.currentRole)}
                        tone={user.currentRole === "standard" ? "default" : "success"}
                      />
                      <div className="flex flex-wrap gap-1.5">
                        {actions.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No actions</span>
                        ) : (
                          actions.map((action) => (
                            <Button
                              key={action.requested}
                              type="button"
                              size="sm"
                              variant={action.requested === "standard" ? "ghost" : "outline"}
                              onClick={() =>
                                setPending({
                                  target: { userId: user.userId, displayName: user.displayName, currentRole: user.currentRole },
                                  requestedRole: action.requested
                                })
                              }
                            >
                              {action.label}
                            </Button>
                          ))
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-1 text-xs text-muted-foreground">
              Search by display name or username to add someone to the team.
            </p>
          )}
        </div>
      </AdminSection>

      <AdminSection title="Current team" description="Authorised Admin and Support accounts.">
        {team.length === 0 ? (
          <AdminEmptyState icon={UsersRound} title="No additional team members" description="Only the bootstrap owner has access." />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto rounded-xl border border-border/60 lg:block">
              <table className="w-full text-sm">
                <thead className="border-b border-border/60 bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Team member</th>
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5 font-medium">Account state</th>
                    <th className="px-4 py-2.5 font-medium">Added by</th>
                    <th className="px-4 py-2.5 font-medium">Added on</th>
                    <th className="px-4 py-2.5 font-medium">Last active</th>
                    <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((member) => (
                    <tr key={member.email} className="border-b border-border/40 last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <UserAvatar src={member.avatarUrl} name={member.displayName} size="xs" />
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {member.displayName}
                              {member.isCurrentUser ? <span className="ml-1.5 text-xs text-muted-foreground">(You)</span> : null}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><AdminStatus label={humanizeAdminValue(member.role)} tone={roleTone[member.role]} /></td>
                      <td className="px-4 py-3"><AdminStatus label={member.active ? "Active" : "Disabled"} tone={member.active ? "success" : "warning"} /></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{member.addedBy ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatAdminDate(member.addedOn)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{member.lastActive ? formatAdminDate(member.lastActive) : "—"}</td>
                      <td className="px-4 py-3">
                        <TeamRowActions actorRole={actorRole} member={member} onChange={setPending} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile / tablet list */}
            <div className="grid gap-2 lg:hidden">
              {team.map((member) => (
                <Card key={member.email} className="p-3">
                  <div className="flex items-center gap-2.5">
                    <UserAvatar src={member.avatarUrl} name={member.displayName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {member.displayName}
                        {member.isCurrentUser ? <span className="ml-1.5 text-xs text-muted-foreground">(You)</span> : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <AdminStatus label={humanizeAdminValue(member.role)} tone={roleTone[member.role]} />
                    <AdminStatus label={member.active ? "Active" : "Disabled"} tone={member.active ? "success" : "warning"} />
                    <span className="text-xs text-muted-foreground">Added {formatAdminDate(member.addedOn)}</span>
                  </div>
                  <div className="mt-2">
                    <TeamRowActions actorRole={actorRole} member={member} onChange={setPending} />
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </AdminSection>

      <RoleConfirmDialog pending={pending} isMutating={isMutating} onCancel={() => setPending(null)} onConfirm={confirmChange} />
    </div>
  );
}

function TeamRowActions({
  actorRole,
  member,
  onChange
}: {
  actorRole: StaffStanding;
  member: TeamMember;
  onChange: (pending: PendingChange) => void;
}) {
  if (!member.userId) {
    return <span className="text-xs text-muted-foreground">Email only</span>;
  }
  const actions = availableActions(actorRole, member.role, member.isCurrentUser);
  if (actions.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {actions.map((action) => (
        <Button
          key={action.requested}
          type="button"
          size="sm"
          variant={action.requested === "standard" ? "ghost" : "outline"}
          onClick={() =>
            onChange({
              target: { userId: member.userId!, displayName: member.displayName, currentRole: member.role },
              requestedRole: action.requested
            })
          }
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

function RoleConfirmDialog({
  pending,
  isMutating,
  onCancel,
  onConfirm
}: {
  pending: PendingChange | null;
  isMutating: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = pending ? confirmCopy(pending.requestedRole) : null;
  return (
    <Modal
      open={Boolean(pending)}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={copy?.title ?? ""}
      description={copy?.description}
    >
      {pending ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-secondary/30 p-3">
            {pending.requestedRole === "admin" ? (
              <ShieldCheck className="h-4 w-4 text-orange-400" aria-hidden="true" />
            ) : (
              <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="text-sm font-medium">{pending.target.displayName}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={isMutating}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={pending.requestedRole === "standard" ? "danger" : "primary"}
              onClick={onConfirm}
              disabled={isMutating}
            >
              {pending.requestedRole === "standard" ? "Remove access" : "Confirm role"}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function confirmCopy(requested: StaffStanding): { title: string; description: string } {
  if (requested === "admin") {
    return {
      title: "Make this user an Admin?",
      description: "They will receive access to sensitive operational tools. This action will be recorded."
    };
  }
  if (requested === "support") {
    return {
      title: "Make this user Support?",
      description: "They will receive limited access to support tools and assigned user issues. This action will be recorded."
    };
  }
  return {
    title: "Remove staff access?",
    description: "They will return to a standard account and lose all staff tools. This action will be recorded."
  };
}
