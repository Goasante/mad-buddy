"use client";

import { useRouter } from "next/navigation";
import { CalendarPlus, MapPin, Sparkles, Users } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import {
  checkInToEventAction,
  checkOutAction,
  createEventAction,
  getEventGlowAction,
  setEventGlowAction,
  type EventView
} from "@/app/(app)/event-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/auth/form-field";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { EventGlowMuddyList } from "@/lib/events/types";
import { cn } from "@/lib/utils";

type EventTab = "upcoming" | "live" | "mine";

const eventTabs: Array<{ id: EventTab; label: string }> = [
  { id: "upcoming", label: "Upcoming" },
  { id: "live", label: "Happening now" },
  { id: "mine", label: "Hosting" }
];

function eventDateLabel(startsAt: string): string {
  return new Date(startsAt).toLocaleString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

function isLive(event: EventView, nowMs: number): boolean {
  return Date.parse(event.startsAt) <= nowMs && nowMs < Date.parse(event.endsAt);
}

export function EventsPageContent({ initialEvents = [] }: { initialEvents?: EventView[] }) {
  const router = useRouter();
  const [events, setEvents] = useState<EventView[]>(initialEvents);
  const [activeTab, setActiveTab] = useState<EventTab>("upcoming");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [glowList, setGlowList] = useState<EventGlowMuddyList | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const nowMs = Date.now();
  const visibleEvents = useMemo(() => {
    if (activeTab === "mine") return events.filter((event) => event.isHost);
    if (activeTab === "live") return events.filter((event) => isLive(event, nowMs));
    return events.filter((event) => !isLive(event, nowMs));
  }, [events, activeTab, nowMs]);
  const selectedEvent = events.find((event) => event.id === selectedId) ?? null;

  function openDetails(eventId: string) {
    setSelectedId(eventId);
    setGlowList(null);
    startTransition(async () => {
      setGlowList(await getEventGlowAction(eventId));
    });
  }

  function checkIn(event: EventView) {
    startTransition(async () => {
      const result = await checkInToEventAction({ eventId: event.id });
      setFeedback(result.message);
      if (result.ok && result.checkInId) {
        setEvents((current) =>
          current.map((item) =>
            item.id === event.id
              ? { ...item, myCheckInId: result.checkInId ?? null, myGlowEnabled: true }
              : item
          )
        );
        setGlowList(await getEventGlowAction(event.id));
      }
    });
  }

  function checkOut(event: EventView) {
    if (!event.myCheckInId) return;
    const checkInId = event.myCheckInId;
    startTransition(async () => {
      const result = await checkOutAction(checkInId);
      setFeedback(result.message);
      if (result.ok) {
        setEvents((current) =>
          current.map((item) =>
            item.id === event.id ? { ...item, myCheckInId: null, myGlowEnabled: false } : item
          )
        );
        setGlowList(await getEventGlowAction(event.id));
      }
    });
  }

  function toggleGlow(event: EventView) {
    if (!event.myCheckInId) return;
    const next = !event.myGlowEnabled;
    startTransition(async () => {
      const result = await setEventGlowAction(event.myCheckInId as string, next);
      setFeedback(result.message);
      if (result.ok) {
        setEvents((current) =>
          current.map((item) => (item.id === event.id ? { ...item, myGlowEnabled: next } : item))
        );
        setGlowList(await getEventGlowAction(event.id));
      }
    });
  }

  function createEvent(input: {
    name: string;
    date: string;
    startTime: string;
    endTime: string;
    venueLabel: string;
    description: string;
  }) {
    const startsAt = new Date(`${input.date}T${input.startTime}`);
    const endsAt = new Date(`${input.date}T${input.endTime}`);
    startTransition(async () => {
      const result = await createEventAction({
        name: input.name,
        description: input.description || undefined,
        venueLabel: input.venueLabel || undefined,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString()
      });
      setFeedback(result.message);
      if (result.ok) {
        setCreateOpen(false);
        setActiveTab("mine");
        router.refresh();
        if (result.eventId) {
          setEvents((current) => [
            {
              id: result.eventId as string,
              name: input.name,
              description: input.description || null,
              venueLabel: input.venueLabel || null,
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
              status: "scheduled",
              hostName: "You",
              isHost: true,
              myCheckInId: null,
              myGlowEnabled: false
            },
            ...current
          ]);
        }
      }
    });
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 pt-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Events</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Check in to see which Muddies are at the same event. Venue names only — never exact location.
          </p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <CalendarPlus className="h-4 w-4" aria-hidden="true" />
          Create Event
        </Button>
      </header>

      {feedback ? (
        <p className="text-sm text-muted-foreground" role="status">
          {feedback}
        </p>
      ) : null}

      <nav className="overflow-x-auto border-b border-border/70" aria-label="Events tabs">
        <div className="flex min-w-max gap-1">
          {eventTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium",
                activeTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {visibleEvents.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {visibleEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              live={isLive(event, nowMs)}
              pending={isPending}
              onView={() => openDetails(event.id)}
              onCheckIn={() => checkIn(event)}
              onCheckOut={() => checkOut(event)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={CalendarPlus}
          className="!min-h-0 !shadow-none p-5"
          title={activeTab === "mine" ? "You're not hosting anything yet" : "No events here yet"}
          description="Create an event and Muddies who check in can find each other there."
          action={
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              Create Event
            </Button>
          }
        />
      )}

      <CreateEventModal open={createOpen} onOpenChange={setCreateOpen} pending={isPending} onCreate={createEvent} />
      <EventDetailsModal
        event={selectedEvent}
        glowList={glowList}
        pending={isPending}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onCheckIn={() => selectedEvent && checkIn(selectedEvent)}
        onCheckOut={() => selectedEvent && checkOut(selectedEvent)}
        onToggleGlow={() => selectedEvent && toggleGlow(selectedEvent)}
      />
    </div>
  );
}

function EventCard({
  event,
  live,
  pending,
  onView,
  onCheckIn,
  onCheckOut
}: {
  event: EventView;
  live: boolean;
  pending: boolean;
  onView: () => void;
  onCheckIn: () => void;
  onCheckOut: () => void;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold">{event.name}</h3>
            {live ? <Badge variant="violet">Happening now</Badge> : null}
            {event.myCheckInId ? <Badge>Checked in</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{eventDateLabel(event.startsAt)}</p>
          {event.venueLabel ? (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {event.venueLabel}
            </p>
          ) : null}
        </div>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Hosted by {event.hostName}
      </p>
      <div className="mt-4 flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onView}>
          View
        </Button>
        {event.myCheckInId ? (
          <Button type="button" variant="outline" className="flex-1" disabled={pending} onClick={onCheckOut}>
            Check out
          </Button>
        ) : (
          <Button type="button" className="flex-1" disabled={pending} onClick={onCheckIn}>
            Check in
          </Button>
        )}
      </div>
    </Card>
  );
}

function CreateEventModal({
  open,
  onOpenChange,
  pending,
  onCreate
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onCreate: (input: {
    name: string;
    date: string;
    startTime: string;
    endTime: string;
    venueLabel: string;
    description: string;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [venueLabel, setVenueLabel] = useState("");
  const [description, setDescription] = useState("");

  const complete = name.trim().length >= 2 && date && startTime && endTime;

  function resetFields() {
    setName("");
    setDate("");
    setStartTime("");
    setEndTime("");
    setVenueLabel("");
    setDescription("");
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) resetFields();
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Create Event"
      description="Visible to the community. Use a venue name, not an address."
    >
      <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
        <FormField htmlFor="event-name" label="Event name">
          <Input id="event-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Sunday Brunch" />
        </FormField>
        <FormField htmlFor="event-date" label="Date">
          <Input id="event-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor="event-start" label="Starts">
            <Input id="event-start" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
          </FormField>
          <FormField htmlFor="event-end" label="Ends">
            <Input id="event-end" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
          </FormField>
        </div>
        <FormField htmlFor="event-venue" label="Venue (label only)">
          <Input id="event-venue" value={venueLabel} onChange={(event) => setVenueLabel(event.target.value)} placeholder="e.g. Impact Hub, Accra" />
        </FormField>
        <FormField htmlFor="event-description" label="Description">
          <Textarea
            id="event-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What's this event about?"
          />
        </FormField>
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!complete || pending}
          onClick={() => {
            onCreate({
              name: name.trim(),
              date,
              startTime,
              endTime,
              venueLabel: venueLabel.trim(),
              description: description.trim()
            });
            resetFields();
          }}
        >
          Create Event
        </Button>
      </div>
    </Modal>
  );
}

function EventDetailsModal({
  event,
  glowList,
  pending,
  onOpenChange,
  onCheckIn,
  onCheckOut,
  onToggleGlow
}: {
  event: EventView | null;
  glowList: EventGlowMuddyList | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onCheckIn: () => void;
  onCheckOut: () => void;
  onToggleGlow: () => void;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <Modal
      open={Boolean(event)}
      onOpenChange={onOpenChange}
      title={event?.name ?? "Event"}
      description={event ? eventDateLabel(event.startsAt) : undefined}
    >
      {event ? (
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          {event.venueLabel ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
              {event.venueLabel}
            </p>
          ) : null}
          {event.description ? <p className="text-sm leading-6">{event.description}</p> : null}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Muddies here{glowList ? ` (${glowList.count})` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              {(glowList?.muddies ?? []).map((muddy) => (
                <div
                  key={muddy.userId}
                  className="flex items-center gap-2 rounded-full border border-border/70 bg-background/60 py-1 pl-1 pr-3"
                >
                  <GlowAvatar name={muddy.displayName} size="sm" reducedMotion={reducedMotion} />
                  <span className="text-xs font-medium">{muddy.displayName}</span>
                </div>
              ))}
              {glowList && glowList.muddies.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {glowList.count > 0
                    ? `${glowList.count} checked in privately.`
                    : "None of your Muddies are here yet."}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Hosted by {event.hostName}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
            {event.myCheckInId ? (
              <>
                <Button type="button" variant="outline" disabled={pending} onClick={onCheckOut}>
                  Check out
                </Button>
                <Button
                  type="button"
                  variant={event.myGlowEnabled ? "primary" : "outline"}
                  disabled={pending}
                  onClick={onToggleGlow}
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  {event.myGlowEnabled ? "Visible to Muddies here" : "Hidden at this event"}
                </Button>
              </>
            ) : (
              <Button type="button" disabled={pending} onClick={onCheckIn}>
                Check in
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
