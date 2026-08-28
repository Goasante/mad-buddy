"use client";

import { useState } from "react";
import { ChevronRight, Loader2, Lock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventArtwork } from "@/components/events/event-artwork";
import { SectionLabel } from "@/components/events/event-badges";
import { cn } from "@/lib/utils";
import type { RoomJoinState, RoomView } from "@/lib/events/rooms";

/**
 * The Rooms tab of an Event -- reference panel 1 ("Event Rooms").
 *
 * COMPOSITION IS THE REFERENCE'S, PALETTE IS MAD BUDDY'S. The reference board
 * is purple because concept boards are; production uses the canonical brand
 * tokens, so every accent here is `primary` and nothing hardcodes a hex.
 *
 * Rows are image-led and compact, exactly as the reference shows: a square of
 * artwork, name, one line of description, member count, and one control on the
 * right whose label IS the server's answer.
 *
 * THE JOIN CONTROL NEVER LIES. Its label comes from `room.joinState`, which the
 * server computed with the SAME resolver the join mutation uses. A Room that
 * would refuse the join renders a disabled reason instead of a Join button, so
 * there is no state in which tapping the primary control fails.
 */

/** Only these states can complete a join; everything else is a reason, not a button. */
function isActionable(state: RoomJoinState): boolean {
  return state === "join";
}

function joinLabel(state: RoomJoinState): string {
  switch (state) {
    case "join":
      return "Join";
    case "joined":
      return "Open";
    case "full":
      return "Full";
    case "needs_invitation":
      return "Invite only";
    case "needs_check_in":
      return "Check in first";
    case "needs_qr":
      return "Scan QR";
    case "needs_group":
      return "Group only";
    case "opens_later":
      return "Opens later";
    case "archived":
      return "Archived";
    default:
      return "Closed";
  }
}

/** The one-line explanation under a Room that the viewer cannot join. */
function joinHint(state: RoomJoinState): string | null {
  switch (state) {
    case "needs_check_in":
      return "Check in to the event to join this room";
    case "needs_invitation":
      return "You need an invite to join";
    case "needs_qr":
      return "Scan the room QR code to join";
    case "needs_group":
      return "For members of selected groups";
    case "full":
      return "This room has reached its member limit";
    case "opens_later":
      return "Opens closer to the event";
    case "archived":
      return "Read-only";
    default:
      return null;
  }
}

function memberLabel(count: number): string {
  return `${count} ${count === 1 ? "member" : "members"}`;
}

export function EventRoomRow({
  room,
  eventCoverUrl,
  eventFocalX,
  eventFocalY,
  onJoin,
  onOpen,
  pending
}: {
  room: RoomView;
  eventCoverUrl: string | null;
  eventFocalX: number;
  eventFocalY: number;
  onJoin: (roomId: string) => void;
  onOpen: (roomId: string) => void;
  pending: boolean;
}) {
  const actionable = isActionable(room.joinState);
  const hint = joinHint(room.joinState);

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 p-2.5">
      {/* IMAGE AUTHORITY (§7): a Room with no artwork of its own shows the
          EVENT's cover through the canonical EventArtwork component, which also
          owns the branded fallback. No grey placeholder rectangles, and no
          screen painting Event artwork its own way. */}
      <EventArtwork
        eventId={room.eventId ?? room.id}
        coverUrl={eventCoverUrl}
        focalX={eventFocalX}
        focalY={eventFocalY}
        alt=""
        className="h-14 w-14 shrink-0 rounded-lg"
      />

      <button
        type="button"
        onClick={() => onOpen(room.id)}
        // The whole row opens the Room for a member; for a non-member it opens
        // the Room's public face, which is where the join reason is explained.
        className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
      >
        <p className="truncate text-sm font-semibold text-foreground">{room.name}</p>
        {room.description ? (
          <p className="truncate text-xs text-muted-foreground">{room.description}</p>
        ) : null}
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="h-3 w-3" aria-hidden="true" />
          {memberLabel(room.memberCount)}
          {!room.listedInEvent ? (
            <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/80">
              <Lock className="h-3 w-3" aria-hidden="true" />
              Hidden
            </span>
          ) : null}
        </p>
        {hint && !room.isMember ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</p>
        ) : null}
      </button>

      {room.isMember ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onOpen(room.id)}
          disabled={pending}
          className="min-h-[2.25rem] shrink-0"
        >
          Open
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={() => (actionable ? onJoin(room.id) : onOpen(room.id))}
          // A non-actionable state is not a dead button: it is not a button at
          // all. It renders disabled with the reason as its label, and the row
          // itself still opens the Room so the reason can be read in full.
          disabled={pending || !actionable}
          aria-label={actionable ? `Join ${room.name}` : `${room.name}: ${joinLabel(room.joinState)}`}
          className="min-h-[2.25rem] shrink-0"
          variant={actionable ? "primary" : "secondary"}
        >
          {pending && actionable ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            joinLabel(room.joinState)
          )}
        </Button>
      )}
    </div>
  );
}

/**
 * The Rooms section on Event Detail.
 *
 * Shows the first few Rooms with a "See all (N)" affordance, exactly as the
 * reference does -- the Event page is not a Room directory, it is a doorway.
 */
export function EventRoomsSection({
  rooms,
  eventCoverUrl,
  eventFocalX,
  eventFocalY,
  canCreate,
  onJoin,
  onOpen,
  onSeeAll,
  onCreate,
  pending,
  limit = 3
}: {
  rooms: RoomView[];
  eventCoverUrl: string | null;
  eventFocalX: number;
  eventFocalY: number;
  canCreate: boolean;
  onJoin: (roomId: string) => void;
  onOpen: (roomId: string) => void;
  onSeeAll: () => void;
  onCreate: () => void;
  pending: boolean;
  limit?: number;
}) {
  const shown = rooms.slice(0, limit);

  return (
    <section className="space-y-2.5" aria-labelledby="event-rooms">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>
          <span id="event-rooms">Event Rooms</span>
        </SectionLabel>
        {rooms.length > limit ? (
          <button
            type="button"
            onClick={onSeeAll}
            className="inline-flex min-h-[2.75rem] items-center gap-0.5 text-xs font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg px-1"
          >
            See all ({rooms.length})
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {rooms.length === 0 ? (
        /* A REAL EMPTY STATE, not a blank panel (§38). It says what a Room is
           for, because someone seeing this has probably never used one. */
        <div className="rounded-xl border border-dashed border-border/70 p-4 text-center">
          <p className="text-sm font-medium text-foreground">No rooms yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Rooms are temporary spaces for people at this event to chat.
          </p>
          {canCreate ? (
            <Button size="sm" variant="secondary" onClick={onCreate} className="mt-3 min-h-[2.75rem]">
              Create a room
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((room) => (
            <EventRoomRow
              key={room.id}
              room={room}
              eventCoverUrl={eventCoverUrl}
              eventFocalX={eventFocalX}
              eventFocalY={eventFocalY}
              onJoin={onJoin}
              onOpen={onOpen}
              pending={pending}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Create Room -- reference: name, description, join mode, member limit.
 *
 * The join-mode labels are the user-facing vocabulary; the values sent to the
 * server are the existing internal ones. Nothing here invents a mode the
 * backend does not enforce -- each of these four is a real gate.
 */
export const ROOM_JOIN_MODES: Array<{
  value: "invite" | "check_in" | "qr" | "community";
  label: string;
  hint: string;
}> = [
  { value: "invite", label: "Invite only", hint: "Only invited people can join" },
  { value: "check_in", label: "People at the Event", hint: "People can join after they check in" },
  { value: "qr", label: "QR code", hint: "Scan the room QR to join" },
  { value: "community", label: "Group members", hint: "Members of selected Groups" }
];

export function CreateRoomForm({
  onSubmit,
  onCancel,
  pending,
  error,
  groupOptions
}: {
  onSubmit: (input: {
    name: string;
    description: string;
    joinMode: "invite" | "check_in" | "qr" | "community";
    maxMembers: number;
    listed: boolean;
    groupConversationIds: string[];
  }) => void;
  onCancel: () => void;
  pending: boolean;
  error: string;
  groupOptions: Array<{ id: string; name: string }>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [joinMode, setJoinMode] = useState<"invite" | "check_in" | "qr" | "community">("check_in");
  const [maxMembers, setMaxMembers] = useState("100");
  const [listed, setListed] = useState(true);
  const [groupIds, setGroupIds] = useState<string[]>([]);

  const needsGroups = joinMode === "community";
  const canSubmit = name.trim().length > 0 && (!needsGroups || groupIds.length > 0);

  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit || pending) return;
        onSubmit({
          name: name.trim(),
          description: description.trim(),
          joinMode,
          maxMembers: Number(maxMembers) || 100,
          listed,
          groupConversationIds: needsGroups ? groupIds : []
        });
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="room-name" className="text-sm font-medium">
          Room name
        </label>
        <input
          id="room-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          required
          placeholder="General Room"
          className="min-h-[2.75rem] w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="room-description" className="text-sm font-medium">
          Description
        </label>
        <input
          id="room-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={500}
          placeholder="Everyone at the event"
          className="min-h-[2.75rem] w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Join mode</legend>
        <div className="space-y-1.5">
          {ROOM_JOIN_MODES.map((mode) => (
            <label
              key={mode.value}
              className={cn(
                "flex min-h-[2.75rem] cursor-pointer items-start gap-3 rounded-xl border p-3 transition",
                joinMode === mode.value
                  ? "border-primary bg-primary/5"
                  : "border-border/70 hover:bg-secondary/40"
              )}
            >
              <input
                type="radio"
                name="join-mode"
                value={mode.value}
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

      {/* GROUP TARGETS ARE REQUIRED for a group-gated Room. The server refuses
          a community Room with no targets (it would admit nobody), so the form
          refuses it here too rather than letting the user discover it. */}
      {needsGroups ? (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Which groups?</legend>
          {groupOptions.length === 0 ? (
            <p className="rounded-xl bg-secondary/40 p-3 text-xs text-muted-foreground">
              You are not in any groups yet, so there is nobody to admit this way.
            </p>
          ) : (
            <div className="space-y-1.5">
              {groupOptions.map((group) => (
                <label
                  key={group.id}
                  className="flex min-h-[2.75rem] cursor-pointer items-center gap-3 rounded-xl border border-border/70 p-3 hover:bg-secondary/40"
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
              ))}
            </div>
          )}
        </fieldset>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="room-limit" className="text-sm font-medium">
          Member limit
        </label>
        <input
          id="room-limit"
          type="number"
          inputMode="numeric"
          min={1}
          max={5000}
          value={maxMembers}
          onChange={(event) => setMaxMembers(event.target.value)}
          className="min-h-[2.75rem] w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <p className="text-xs text-muted-foreground">
          Your plan sets the maximum. A higher number is capped to it.
        </p>
      </div>

      <label className="flex min-h-[2.75rem] cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/70 p-3">
        <span className="min-w-0">
          <span className="block text-sm font-medium">Show in event</span>
          <span className="block text-xs text-muted-foreground">Visible on the event page</span>
        </span>
        <input
          type="checkbox"
          checked={listed}
          onChange={(event) => setListed(event.target.checked)}
          className="h-5 w-5 shrink-0 accent-primary"
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
        <Button type="submit" disabled={!canSubmit || pending} className="flex-1">
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Create room
        </Button>
      </div>
    </form>
  );
}
