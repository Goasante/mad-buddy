"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { MoreVertical, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import { PeoplePicker, type PickerRow } from "@/components/events/people-picker";
import {
  addEventAdminAction,
  getAudienceOptionsAction,
  listEventAdminsAction,
  removeEventAdminAction
} from "@/app/(app)/event-actions";
import type { EventAdminView } from "@/lib/events/updates";
import type { InviteeOption } from "@/lib/events/audience-options";

/**
 * Event admins -- reference panels 9, 9B, 9C.
 *
 * A lightweight delegation tool, not role management. The backend permission has
 * existed since 4C -- an admin may publish Event Updates and nothing else -- and
 * this is the surface that makes it reachable.
 *
 * HOST ONLY, and the server says so too. Rendering this behind an isHost check
 * decides what is DRAWN, never what is ALLOWED: addEventAdmin and
 * removeEventAdmin each re-check ownership, so a hidden button is a courtesy
 * rather than a control.
 *
 * Removal goes through a confirmation, because it silently takes a capability
 * away from another person who currently has it -- there is no undo, and the
 * removed admin gets no notice from this screen.
 */
export function EventAdminManager({ eventId }: { eventId: string }) {
  const [admins, setAdmins] = useState<EventAdminView[]>([]);
  const [candidates, setCandidates] = useState<InviteeOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [removing, setRemoving] = useState<EventAdminView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      const [nextAdmins, options] = await Promise.all([
        listEventAdminsAction(eventId),
        getAudienceOptionsAction()
      ]);
      setAdmins(nextAdmins);
      // Same eligible-Muddy source the invitee picker uses: blocks already
      // removed, and never a global account search.
      setCandidates(options.invitees);
      setLoaded(true);
    });
  }

  useEffect(refresh, [eventId]);

  const adminIds = useMemo(() => new Set(admins.map((admin) => admin.userId)), [admins]);

  // Someone already an admin is not offered again -- a no-op row that reports
  // "already an admin" is a worse answer than not showing it.
  const candidateRows = useMemo<PickerRow[]>(
    () =>
      candidates
        .filter((person) => !adminIds.has(person.userId))
        .map((person) => ({ id: person.userId, name: person.name, avatarUrl: person.avatarUrl })),
    [candidates, adminIds]
  );

  function addSelected() {
    setError(null);
    startTransition(async () => {
      /* Sequential, not Promise.all: each call is a separate ownership-checked
       * mutation, and one failure must not leave the others in doubt. The first
       * refusal stops the run and is reported as-is. */
      for (const userId of selectedIds) {
        const result = await addEventAdminAction(eventId, userId);
        if (!result.ok) {
          setError(result.message);
          break;
        }
      }
      setSelectedIds([]);
      setAddOpen(false);
      refresh();
    });
  }

  function confirmRemove() {
    if (!removing) return;
    const target = removing;
    setError(null);
    startTransition(async () => {
      const result = await removeEventAdminAction(eventId, target.userId);
      // Closed only after the server answered. Closing first would show the
      // admin gone from a list the server may still be refusing to change.
      if (!result.ok) setError(result.message);
      setRemoving(null);
      refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl bg-secondary/30 p-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Admins can post updates for this event. Only you, as the host, can add or remove admins.
        </p>
      </div>

      <section className="space-y-1">
        <h3 className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Current admins
        </h3>
        {!loaded ? (
          <p className="px-1 py-3 text-sm text-muted-foreground">Loading admins...</p>
        ) : admins.length === 0 ? (
          <p className="px-1 py-3 text-sm text-muted-foreground">
            No admins yet. You are the only person who can post updates.
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {admins.map((admin) => (
              <li key={admin.userId} className="flex min-h-[3.25rem] items-center gap-3 px-1 py-2">
                <UserAvatar name={admin.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium leading-snug">{admin.name}</span>
                  <span className="block text-xs text-muted-foreground">Can post updates</span>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={pending}
                  onClick={() => setRemoving(admin)}
                  aria-label={`Remove ${admin.name} as event admin`}
                  className="shrink-0 text-muted-foreground"
                >
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Button
        variant="outline"
        className="w-full"
        disabled={pending || !loaded}
        onClick={() => {
          setSelectedIds([]);
          setAddOpen(true);
        }}
      >
        <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Add admin
      </Button>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Modal
        owner="EventAdminAddModal"
        open={addOpen}
        onOpenChange={setAddOpen}
        variant="sheet"
        title="Add admin"
        description="Admins you choose can post updates for this event."
      >
        <div className="flex max-h-[60vh] flex-col">
          <PeoplePicker
            rows={candidateRows}
            selectedIds={selectedIds}
            onToggle={(id) =>
              setSelectedIds((current) =>
                current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
              )
            }
            onConfirm={addSelected}
            searchPlaceholder="Search your Muddies"
            confirmLabel={(count) => (count === 1 ? "Add 1 admin" : `Add ${count} admins`)}
            emptyMessage="Everyone you could add is already an admin."
            pending={pending}
          />
        </div>
      </Modal>

      {/* Destructive confirmation. It names the person and states the exact
          consequence -- "are you sure?" alone tells nobody what they are
          agreeing to. */}
      <Modal
        owner="EventAdminRemoveModal"
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remove admin"
        compact
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmRemove} disabled={pending}>
              Remove admin
            </Button>
          </div>
        }
      >
        {removing ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <UserAvatar name={removing.name} size="sm" />
              <span className="font-medium">{removing.name}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              They will no longer be able to post updates for this event.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
