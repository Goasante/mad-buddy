"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROOM_JOIN_MODES } from "@/components/events/event-rooms";
import { cn } from "@/lib/utils";
import type { RoomView } from "@/lib/events/rooms";

/**
 * Room Settings -- reference panel "HOST: ROOM SETTINGS".
 *
 * EVERY CONTROL PERSISTS. Name, description, join mode, member limit, status
 * and "Show in event" all map to real columns and are written by
 * updateEventRoomAction, which re-checks authority server-side. There is no
 * toggle here whose only effect is local state -- "Show in event" in particular
 * writes event_circles.listed_in_event, a column added for exactly this control
 * rather than faked in the client.
 *
 * Archive is destructive-looking but never destructive: it makes the Room
 * read-only and keeps every message and member.
 */

const STATUS_OPTIONS: Array<{ value: RoomView["status"]; label: string; hint: string }> = [
  { value: "open", label: "Open", hint: "People can discover it" },
  { value: "active", label: "Active", hint: "Open for joining" },
  { value: "closing", label: "Closing", hint: "Soon closing to new members" }
];

export function EventRoomSettings({
  room,
  groupOptions,
  selectedGroupIds,
  onSave,
  onArchive,
  onCancel,
  pending,
  error
}: {
  room: RoomView;
  groupOptions: Array<{ id: string; name: string }>;
  selectedGroupIds: string[];
  onSave: (input: {
    roomId: string;
    name: string;
    description: string;
    joinMode: RoomView["joinMode"];
    maxMembers: number;
    status: RoomView["status"];
    listed: boolean;
    groupConversationIds: string[];
  }) => void;
  onArchive: () => void;
  onCancel: () => void;
  pending: boolean;
  error: string;
}) {
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description ?? "");
  const [joinMode, setJoinMode] = useState<RoomView["joinMode"]>(room.joinMode);
  const [maxMembers, setMaxMembers] = useState(String(room.maxMembers));
  const [status, setStatus] = useState<RoomView["status"]>(room.status);
  const [listed, setListed] = useState(room.listedInEvent);
  const [groupIds, setGroupIds] = useState<string[]>(selectedGroupIds);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const archived = room.status === "archived";
  const needsGroups = joinMode === "community";
  const canSave = name.trim().length > 0 && (!needsGroups || groupIds.length > 0) && !archived;

  return (
    <form
      method="post"
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave || pending) return;
        onSave({
          roomId: room.id,
          name: name.trim(),
          description: description.trim(),
          joinMode,
          maxMembers: Number(maxMembers) || room.maxMembers,
          status,
          listed,
          groupConversationIds: needsGroups ? groupIds : []
        });
      }}
    >
      {archived ? (
        <p className="rounded-xl bg-secondary/50 p-3 text-sm text-muted-foreground">
          This room is archived and read-only. Its history stays available to members.
        </p>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="settings-name" className="text-sm font-medium">
          Room name
        </label>
        <input
          id="settings-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          disabled={archived}
          className="min-h-[2.75rem] w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="settings-description" className="text-sm font-medium">
          Description
        </label>
        <input
          id="settings-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={500}
          disabled={archived}
          className="min-h-[2.75rem] w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        />
      </div>

      <fieldset className="space-y-1.5" disabled={archived}>
        <legend className="text-sm font-medium">Join mode</legend>
        <div className="space-y-1.5">
          {ROOM_JOIN_MODES.map((mode) => (
            <label
              key={mode.value}
              className={cn(
                "flex min-h-[2.75rem] cursor-pointer items-start gap-3 rounded-xl border p-3 transition",
                joinMode === mode.value ? "border-primary bg-primary/5" : "border-border/70"
              )}
            >
              <input
                type="radio"
                name="settings-join-mode"
                checked={joinMode === mode.value}
                onChange={() => setJoinMode(mode.value)}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{mode.label}</span>
                <span className="block text-xs text-muted-foreground">{mode.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {needsGroups ? (
        <fieldset className="space-y-1.5" disabled={archived}>
          <legend className="text-sm font-medium">Which groups?</legend>
          {groupOptions.length === 0 ? (
            <p className="rounded-xl bg-secondary/40 p-3 text-xs text-muted-foreground">
              You are not in any groups, so this mode would admit nobody.
            </p>
          ) : (
            groupOptions.map((group) => (
              <label
                key={group.id}
                className="flex min-h-[2.75rem] cursor-pointer items-center gap-3 rounded-xl border border-border/70 p-3"
              >
                <input
                  type="checkbox"
                  checked={groupIds.includes(group.id)}
                  onChange={(event) =>
                    setGroupIds((current) =>
                      event.target.checked
                        ? [...current, group.id]
                        : current.filter((id) => id !== group.id)
                    )
                  }
                  className="h-4 w-4 accent-primary"
                />
                <span className="text-sm">{group.name}</span>
              </label>
            ))
          )}
        </fieldset>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="settings-limit" className="text-sm font-medium">
          Member limit
        </label>
        <input
          id="settings-limit"
          type="number"
          inputMode="numeric"
          min={1}
          max={5000}
          value={maxMembers}
          onChange={(event) => setMaxMembers(event.target.value)}
          disabled={archived}
          className="min-h-[2.75rem] w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        />
        <p className="text-xs text-muted-foreground">
          {room.memberCount} of {room.maxMembers} currently. Lowering this never removes anyone.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="settings-status" className="text-sm font-medium">
          Room status
        </label>
        <select
          id="settings-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as RoomView["status"])}
          disabled={archived}
          className="min-h-[2.75rem] w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {STATUS_OPTIONS.find((option) => option.value === status)?.hint ?? "Read-only"}
        </p>
      </div>

      {/* SHOW IN EVENT. A real column, and listing only -- an unlisted Room is
          still reachable by its existing members, its QR and its invitations.
          Hiding a Room is not revoking access to it. */}
      <label className="flex min-h-[2.75rem] cursor-pointer items-center justify-between gap-3 border-t border-border/60 pt-4">
        <span className="min-w-0">
          <span className="block text-sm font-medium">Show in event</span>
          <span className="block text-xs text-muted-foreground">Visible on the event page</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-checked={listed}
          checked={listed}
          onChange={(event) => setListed(event.target.checked)}
          disabled={archived}
          className="h-5 w-9 shrink-0 accent-primary"
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave || pending} className="flex-1">
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Save
        </Button>
      </div>

      {/* ARCHIVE. Confirmed before it happens, and honest about what it does:
          it does NOT delete anything. */}
      {!archived && room.myRole === "host" ? (
        <div className="space-y-2 border-t border-border/60 pt-4">
          {confirmArchive ? (
            <>
              <p className="text-sm text-foreground">
                Archive {room.name}? Members keep the history, but nobody can post again.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmArchive(false)}
                  disabled={pending}
                  className="flex-1"
                >
                  Keep it open
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={onArchive}
                  disabled={pending}
                  className="flex-1"
                >
                  Archive room
                </Button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmArchive(true)}
              className="min-h-[2.75rem] w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="block text-sm font-semibold text-destructive">Archive Room</span>
              <span className="block text-xs text-muted-foreground">This will archive the room</span>
            </button>
          )}
        </div>
      ) : null}
    </form>
  );
}
