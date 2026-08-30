"use client";

import { useEffect, useState } from "react";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  ChevronRight,
  Loader2,
  Megaphone,
  QrCode,
  Settings,
  Shield,
  SquareStack,
  Users
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventArtwork } from "@/components/events/event-artwork";
import { listEventGuestsAction } from "@/app/(app)/event-actions";
import { cn } from "@/lib/utils";

/**
 * Host Tools -- reference panel "HOST: EVENT TOOLS".
 *
 * EVERY ROW HERE WORKS. The reference shows six rows and an End Event action;
 * each one opens a real surface backed by a real action, and none is a card
 * that merely looks like a control:
 *
 *   QR check-in  -> mints a signed, expiring check-in token
 *   Event Rooms  -> the Room manager (create / edit / QR / archive)
 *   Updates      -> the EXISTING Event Updates architecture, not a second one
 *   Guest list   -> built from RSVP + live check-in truth
 *   Admins       -> the EXISTING EventAdminManager
 *   Settings     -> the EXISTING Event draft/edit authority
 *   End Event    -> a real, confirmed, authorized lifecycle transition
 *
 * Updates and Admins deliberately delegate. Event Updates are Event-wide and
 * official; Room Notices are room-scoped. Building a second composer here would
 * have created two sources of truth for what a host said.
 */

export type HostToolsRow = "qr" | "rooms" | "updates" | "guests" | "admins" | "settings";

function ToolRow({
  icon,
  title,
  subtitle,
  count,
  onClick
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count?: number | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[3.5rem] w-full items-center gap-3 rounded-xl bg-secondary/40 px-3.5 py-3 text-left transition hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="shrink-0 text-muted-foreground" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      {typeof count === "number" ? (
        <span className="shrink-0 text-sm font-semibold text-muted-foreground">{count}</span>
      ) : null}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

export function EventHostTools({
  eventId,
  eventName,
  eventWhen,
  eventCoverUrl,
  eventFocalX,
  eventFocalY,
  roomCount,
  updateCount,
  adminCount,
  goingCount,
  checkedInCount,
  canEndEvent,
  eventEnded,
  onOpen,
  onEndEvent,
  pending
}: {
  eventId: string;
  eventName: string;
  eventWhen: string;
  eventCoverUrl: string | null;
  eventFocalX: number;
  eventFocalY: number;
  roomCount: number;
  updateCount: number;
  adminCount: number;
  goingCount: number;
  checkedInCount: number;
  canEndEvent: boolean;
  eventEnded: boolean;
  onOpen: (row: HostToolsRow) => void;
  onEndEvent: () => void;
  pending: boolean;
}) {
  const [confirmEnd, setConfirmEnd] = useState(false);

  return (
    <div className="space-y-4">
      {/* Event identity strip, as the reference shows above the tool rows. */}
      <div className="flex items-center gap-3">
        <EventArtwork
          eventId={eventId}
          coverUrl={eventCoverUrl}
          focalX={eventFocalX}
          focalY={eventFocalY}
          alt=""
          className="h-14 w-14 shrink-0 rounded-lg"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{eventName}</p>
          <p className="truncate text-xs text-muted-foreground">{eventWhen}</p>
        </div>
      </div>

      <div className="space-y-2">
        <ToolRow
          icon={<QrCode className="h-5 w-5" />}
          title="QR check-in"
          subtitle="Let people scan to check in"
          onClick={() => onOpen("qr")}
        />
        <ToolRow
          icon={<SquareStack className="h-5 w-5" />}
          title="Event Rooms"
          subtitle="Create and manage rooms"
          count={roomCount}
          onClick={() => onOpen("rooms")}
        />
        <ToolRow
          icon={<Megaphone className="h-5 w-5" />}
          title="Updates"
          subtitle="Publish updates"
          count={updateCount}
          onClick={() => onOpen("updates")}
        />
        <ToolRow
          icon={<Users className="h-5 w-5" />}
          title="Guest list"
          subtitle={`${goingCount} going · ${checkedInCount} checked in`}
          onClick={() => onOpen("guests")}
        />
        <ToolRow
          icon={<Shield className="h-5 w-5" />}
          title="Admins"
          subtitle={`${adminCount} ${adminCount === 1 ? "admin" : "admins"} & co-hosts`}
          onClick={() => onOpen("admins")}
        />
        <ToolRow
          icon={<Settings className="h-5 w-5" />}
          title="Event settings"
          subtitle="Privacy, visibility & more"
          onClick={() => onOpen("settings")}
        />
      </div>

      {/* END EVENT. Only the host, always confirmed, and honest about what it
          does to Rooms: they move toward closing, they are not deleted. */}
      {canEndEvent && !eventEnded ? (
        <div className="border-t border-border/60 pt-4">
          {confirmEnd ? (
            <div className="space-y-2">
              <p className="text-sm">
                End {eventName}? Check-in stops and rooms begin closing. Nothing anyone posted is
                deleted.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setConfirmEnd(false)}
                  disabled={pending}
                  className="flex-1 min-h-[2.75rem]"
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={onEndEvent}
                  disabled={pending}
                  className="flex-1 min-h-[2.75rem]"
                >
                  {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  End event
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              onClick={() => setConfirmEnd(true)}
              className="min-h-[2.75rem] w-full text-destructive"
            >
              End Event
            </Button>
          )}
        </div>
      ) : eventEnded ? (
        <p className="border-t border-border/60 pt-4 text-center text-xs text-muted-foreground">
          This event has ended.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Guest List -- reference panel "Guest list: 128 going / 86 checked in".
 *
 * Built from existing participation truth (event_rsvps + live check_ins). Shows
 * display identity ONLY: a host needs to know who is coming and who has
 * arrived, which is not the same as an export of their guests' account records.
 * No email, no phone, no location.
 */
export function EventGuestList({ eventId }: { eventId: string }) {
  const [filter, setFilter] = useState<"all" | "going" | "checked_in" | "invited">("all");
  const [data, setData] = useState<Awaited<ReturnType<typeof listEventGuestsAction>> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void listEventGuestsAction(eventId).then((result) => {
      if (active) {
        setData(result);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [eventId]);

  const guests = (data?.guests ?? []).filter((guest) => {
    if (filter === "going") return guest.rsvp === "going";
    if (filter === "checked_in") return guest.checkedIn;
    if (filter === "invited") return guest.invited;
    return true;
  });

  const filters: Array<{ id: typeof filter; label: string }> = [
    { id: "all", label: "All" },
    { id: "going", label: "Going" },
    { id: "checked_in", label: "Checked in" },
    { id: "invited", label: "Invited" }
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-4">
        <div>
          <p className="text-xl font-bold">{data?.going ?? 0}</p>
          <p className="text-xs text-muted-foreground">going</p>
        </div>
        <div>
          <p className="text-xl font-bold">{data?.checkedIn ?? 0}</p>
          <p className="text-xs text-muted-foreground">checked in</p>
        </div>
      </div>

      <div role="tablist" aria-label="Guest filters" className="flex gap-1.5 overflow-x-auto pb-1">
        {filters.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={filter === entry.id}
            onClick={() => setFilter(entry.id)}
            className={cn(
              "min-h-[2.25rem] shrink-0 rounded-full px-3 text-xs font-medium transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              filter === entry.id
                ? "bg-primary text-primary-foreground"
                : "bg-secondary/60 text-muted-foreground hover:text-foreground"
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      ) : guests.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {filter === "all" ? "Nobody has responded yet." : "Nobody in this list yet."}
        </p>
      ) : (
        <div className="space-y-1">
          {guests.map((guest) => (
            <div key={guest.userId} className="flex items-center gap-3 rounded-xl px-1 py-2">
              <UserAvatar name={guest.displayName} src={guest.avatarUrl} size="sm" decorative className="border-2 border-background shadow-[inset_0_0_0_1px_hsl(var(--border)),0_8px_24px_hsl(var(--shadow)/0.16)]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{guest.displayName}</p>
                <p className="text-xs text-muted-foreground">
                  {guest.checkedIn
                    ? "Checked in"
                    : guest.rsvp === "going"
                      ? "Going"
                      : guest.rsvp === "interested"
                        ? "Interested"
                        : guest.rsvp === "not_going"
                          ? "Not going"
                          : "Invited"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
