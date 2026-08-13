"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus, Loader2, MapPin, Sparkles, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  checkInToEventAction,
  checkOutAction,
  createEventAction,
  getEventGlowAction,
  setEventGlowAction,
  setEventRsvpAction
} from "@/app/(app)/event-actions";
import { eventPhase, type EventPhase } from "@/lib/events/rules";
import type { EventRsvpStatus } from "@/lib/supabase/database.types";
import type { EventView } from "@/lib/events/mobile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { CheckInSuccessSheet } from "@/components/events/check-in-success-sheet";
import { EventCoverField, type EventCoverValue } from "@/components/events/event-cover-field";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { EventGlowMuddyList } from "@/lib/events/types";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { cn } from "@/lib/utils";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import { PageHeader } from "@/components/app-shell/page-header";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";

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

/**
 * THE BUG THIS REPLACES (Plans + Events lifecycle, Stage C). The Upcoming tab
 * used to be `events.filter((event) => !isLive(event, nowMs))`, which
 * logically includes PAST events too -- !live is true for both "hasn't
 * started" and "already ended". It only looked correct because listEvents
 * filters `ends_at >= now` in its own query, so a past event could never
 * reach this component to expose the bug. Upstream SQL hiding incorrect UI
 * logic is exactly the trap: any other caller of this component, or any
 * future change to that query, would have silently broken the tab.
 *
 * Every comparison now goes through the one canonical eventPhase -- no
 * component decides "upcoming" or "live" for itself.
 */
function phaseOf(event: EventView, nowMs: number): EventPhase {
  return eventPhase({ startsAtMs: Date.parse(event.startsAt), endsAtMs: Date.parse(event.endsAt) }, nowMs);
}

export function EventsPageContent({
  initialEvents = [],
  currentUserPlan = "free"
}: {
  initialEvents?: EventView[];
  currentUserPlan?: SubscriptionPlan;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedEvent = initialEvents.find((event) => event.id === searchParams.get("event")) ?? null;
  const [events, setEvents] = useState<EventView[]>(initialEvents);
  const [activeTab, setActiveTab] = useState<EventTab>(() => requestedEvent?.isHost ? "mine" : "upcoming");
  const [createOpen, setCreateOpen] = useState(false);
  /* Bumped each time Create opens. Used as the modal's key so it remounts
     with empty state -- the parent closes it directly after a successful
     publish, which would otherwise leave the next Create pre-filled. */
  const [createSession, setCreateSession] = useState(0);
  const openCreate = () => {
    setCreateSession((n) => n + 1);
    setCreateOpen(true);
  };
  const [selectedId, setSelectedId] = useState<string | null>(() => requestedEvent?.id ?? null);
  const [glowList, setGlowList] = useState<EventGlowMuddyList | null>(null);
  // Set only by a server-confirmed check-in; drives the success sheet.
  const [checkedInEvent, setCheckedInEvent] = useState<
    { id: string; name: string; glowEnabled: boolean } | null
  >(null);
  const [feedback, setFeedback] = useState("");
  const [publishError, setPublishError] = useState("");
  const [cover, setCover] = useState<EventCoverValue>({ url: null, focalX: 0.5, focalY: 0.5 });
  const [isPending, startTransition] = useTransition();

  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    const updateClock = () => setNowMs(Date.now());
    const frame = window.requestAnimationFrame(updateClock);
    const interval = window.setInterval(updateClock, 30_000);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!requestedEvent) return;
    let cancelled = false;
    startTransition(async () => {
      const list = await getEventGlowAction(requestedEvent.id);
      if (!cancelled) setGlowList(list);
    });
    return () => {
      cancelled = true;
    };
  }, [requestedEvent]);

  const visibleEvents = useMemo(() => {
    if (activeTab === "mine") return events.filter((event) => event.isHost);
    if (nowMs === 0) return activeTab === "live" ? [] : events;
    if (activeTab === "live") return events.filter((event) => phaseOf(event, nowMs) === "live");
    // Upcoming means upcoming, not "not currently live". A past event that
    // somehow reached this list (see phaseOf's note) must not appear here.
    return events.filter((event) => phaseOf(event, nowMs) === "upcoming");
  }, [events, activeTab, nowMs]);
  const selectedEvent = events.find((event) => event.id === selectedId) ?? null;

  function openDetails(eventId: string) {
    setSelectedId(eventId);
    setGlowList(null);
    startTransition(async () => {
      setGlowList(await getEventGlowAction(eventId));
    });
  }

  /**
   * `sharePresence` is the answer to "Let my Muddies see I'm here", and it is
   * always passed explicitly -- the card check-in has no room for the choice
   * so it passes false, and the details modal passes whatever the person
   * actually ticked. Nothing here may default it to true (Stage E).
   */
  function checkIn(event: EventView, sharePresence: boolean) {
    startTransition(async () => {
      const result = await checkInToEventAction({ eventId: event.id, eventGlowEnabled: sharePresence });
      setFeedback(result.message);
      if (result.ok && result.checkInId) {
        setEvents((current) =>
          current.map((item) =>
            item.id === event.id
              ? { ...item, myCheckInId: result.checkInId ?? null, myGlowEnabled: sharePresence }
              : item
          )
        );
        setGlowList(await getEventGlowAction(event.id));
        // ONLY after the server confirmed. Never optimistic: claiming
        // "you're checked in" before the row exists would be a lie the user
        // acts on (§14).
        setCheckedInEvent({ id: event.id, name: event.name, glowEnabled: sharePresence });
      }
    });
  }

  /**
   * Publish a draft (§7).
   *
   * The server rule is authoritative: publishEventAction re-reads the asset
   * and refuses without a valid one. This surfaces that refusal as the real
   * message next to the cover control rather than as a generic error, and
   * nothing the host typed is lost either way.
   */
  function publish(event: EventView) {
    startTransition(async () => {
      const { publishEventAction } = await import("@/app/(app)/event-cover-actions");
      const result = await publishEventAction(event.id);
      if (result.ok) {
        setPublishError("");
        setFeedback(result.message);
        router.refresh();
        return;
      }
      setPublishError(result.message);
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

  /**
   * RSVP change (Plans + Events lifecycle, Stage C). Same shape as checkIn/
   * checkOut above: call the server action, trust its answer, update local
   * state only on success. The server is the one deciding whether this was
   * allowed -- blocked, cancelled, past, host -- this function never guesses.
   */
  function changeRsvp(event: EventView, status: EventRsvpStatus) {
    startTransition(async () => {
      const result = await setEventRsvpAction(event.id, status);
      setFeedback(result.message);
      if (result.ok) {
        setEvents((current) =>
          current.map((item) => (item.id === event.id ? { ...item, myRsvp: status } : item))
        );
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
    draft: boolean;
    /** Held in the form until an event id exists to attach it to. */
    coverFile: File | null;
    focalX: number;
    focalY: number;
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

      /**
       * ONE PUBLISH, THREE SERVER STEPS.
       *
       * Creation always yields a draft, so publishing means: upload the held
       * cover against the new id, then ask the server to publish -- which
       * re-reads the asset's owner, context, processing and moderation state
       * before allowing it.
       *
       * A failure at any step leaves the event as an unpublished draft and
       * the form intact, so nothing half-made reaches discovery and nothing
       * the creator typed is lost.
       */
      if (result.ok && result.eventId && !input.draft) {
        const eventId = result.eventId;
        if (input.coverFile) {
          const formData = new FormData();
          formData.append("eventId", eventId);
          formData.append("media", input.coverFile);
          const { uploadEventCoverAction, setEventCoverFocalAction, publishEventAction } = await import(
            "@/app/(app)/event-cover-actions"
          );
          const uploaded = await uploadEventCoverAction(formData);
          if (!uploaded.ok) {
            // One message, not a stack of technical ones. The draft exists and
            // is private, so retrying costs nothing.
            //
            // The draft is real and listed under Hosting, so the sheet closes
            // and the message explains where the Event went. Returning here
            // WITHOUT closing left the sheet open with its button stuck on
            // "Publishing…" and no way forward.
            setFeedback("Couldn't upload that cover. Your Event was saved as a draft — add a cover and publish it.");
            setCreateOpen(false);
            setActiveTab("mine");
            router.refresh();
            return;
          }
          if (input.focalX !== 0.5 || input.focalY !== 0.5) {
            await setEventCoverFocalAction({ eventId, focalX: input.focalX, focalY: input.focalY });
          }
          const published = await publishEventAction(eventId);
          setFeedback(
            published.ok
              ? published.message
              : "Your Event was saved as a draft. Check the details and publish again."
          );
        }
      }

      if (!result.ok || input.draft || !input.coverFile) setFeedback(result.message);

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
              status: input.draft || !input.coverFile ? "draft" : "scheduled",
              hostName: "You",
              hostPlan: currentUserPlan,
              isHost: true,
              myCheckInId: null,
              myGlowEnabled: false,
              // The host never carries an RSVP row -- hosting is derived from
              // isHost, not fabricated as intent to attend one's own event.
              myRsvp: null
            },
            ...current
          ]);
        }
      }
    });
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 md:pt-6">
      <PageHeader title="Events" />

      <header className="flex flex-col gap-4 pt-1 sm:flex-row sm:items-center sm:justify-between md:pt-0">
        <div>
          {/* Hidden on mobile: the shared header above carries the title
              there. Desktop has no mobile header, so it keeps this. */}
          <h1 className="hidden text-2xl font-semibold tracking-tight md:block sm:text-3xl">Events</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Check in to see which Muddies are at the same event. Venue names only, never exact location.
          </p>
        </div>
        <Button type="button" onClick={openCreate} data-tour-id={TOUR_TARGET_IDS.EVENTS_CREATE}>
          <CalendarPlus className="h-4 w-4" aria-hidden="true" />
          Create Event
        </Button>
      </header>

      {feedback ? (
        <p className="text-sm text-muted-foreground" role="status">
          {feedback}
        </p>
      ) : null}

      <nav
        data-tour-id={TOUR_TARGET_IDS.EVENTS_TABS}
        className="overflow-x-auto border-b border-border/70"
        aria-label="Events tabs"
      >
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
        <div data-tour-id={TOUR_TARGET_IDS.EVENTS_LIST} className="grid gap-3 lg:grid-cols-2">
          {visibleEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              phase={phaseOf(event, nowMs)}
              pending={isPending}
              onView={() => openDetails(event.id)}
              onCheckIn={() => checkIn(event, false)}
              onCheckOut={() => checkOut(event)}
            />
          ))}
        </div>
      ) : (
        <div data-tour-id={TOUR_TARGET_IDS.EVENTS_LIST}>
          <EmptyState
            icon={CalendarPlus}
            className="!min-h-0 !shadow-none p-5"
            title={activeTab === "mine" ? "You're not hosting anything yet" : "No events here yet"}
            description="Create an event and Muddies who check in can find each other there."
            action={
              <Button type="button" onClick={openCreate}>
                <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                Create Event
              </Button>
            }
          />
        </div>
      )}

      <CreateEventModal key={createSession} open={createOpen} onOpenChange={setCreateOpen} pending={isPending} onCreate={createEvent} />
      <EventDetailsModal
        event={selectedEvent}
        glowList={glowList}
        pending={isPending}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onCheckIn={(sharePresence) => selectedEvent && checkIn(selectedEvent, sharePresence)}
        onCheckOut={() => selectedEvent && checkOut(selectedEvent)}
        onToggleGlow={() => selectedEvent && toggleGlow(selectedEvent)}
        onRsvpChange={(status) => selectedEvent && changeRsvp(selectedEvent, status)}
        onPublish={() => selectedEvent && publish(selectedEvent)}
        publishError={publishError}
        cover={cover}
        setCover={setCover}
        setPublishError={setPublishError}
      />
      {checkedInEvent ? (
        <CheckInSuccessSheet
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setCheckedInEvent(null);
          }}
          eventId={checkedInEvent.id}
          eventName={checkedInEvent.name}
          glowEnabled={checkedInEvent.glowEnabled}
          onSeeMuddies={() => {
            // Routes into the EXISTING Stage E presence list, which already
            // lives in the details modal. No second attendee list.
            const eventId = checkedInEvent.id;
            setCheckedInEvent(null);
            openDetails(eventId);
          }}
        />
      ) : null}
    </div>
  );
}

function EventCard({
  event,
  phase,
  pending,
  onView,
  onCheckIn,
  onCheckOut
}: {
  event: EventView;
  phase: EventPhase;
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
            {phase === "live" ? <Badge variant="violet">Happening now</Badge> : null}
            {event.myCheckInId ? <Badge>Checked in</Badge> : null}
            {event.isHost ? (
              <Badge variant="blue">Hosting</Badge>
            ) : event.myRsvp === "going" ? (
              <Badge variant="green">Going</Badge>
            ) : event.myRsvp === "interested" ? (
              <Badge>Interested</Badge>
            ) : null}
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
        <span className="truncate">Hosted by {event.hostName}</span>
        <PremiumPlanBadge plan={event.hostPlan} compact />
      </p>
      <div data-tour-id={TOUR_TARGET_IDS.EVENTS_ACTIONS} className="mt-4 flex gap-2">
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
    draft: boolean;
    coverFile: File | null;
    focalX: number;
    focalY: number;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [venueLabel, setVenueLabel] = useState("");
  const [description, setDescription] = useState("");
  const [cover, setCover] = useState<EventCoverValue>({ url: null, focalX: 0.5, focalY: 0.5 });
  const [coverError, setCoverError] = useState("");
  /**
   * The chosen cover, held locally until an event id exists.
   *
   * The upload pipeline attaches assets to an event, so nothing can be
   * uploaded before one exists. Rather than making the creator save first and
   * come back, the file waits here and is uploaded during Publish.
   */
  const [pendingCover, setPendingCover] = useState<File | null>(null);
  const coverRef = useRef<HTMLDivElement | null>(null);

  /**
   * End-after-start, checked here so the creator sees it while typing rather
   * than after a round trip. createEvent enforces the same rule server-side
   * and remains authoritative.
   */
  const scheduleInvalid = Boolean(date && startTime && endTime && endTime <= startTime);
  const complete = name.trim().length >= 2 && date && startTime && endTime && !scheduleInvalid;

  /**
   * Save draft / Publish (§7, §8).
   *
   * Publishing without a cover is caught HERE, before the request, so the
   * creator gets the real message and keeps everything they typed rather than
   * a generic server error. The server rule remains authoritative -- this is
   * the graceful front door to it, not a replacement for it.
   */
  function submit(asDraft: boolean) {
    // One publish at a time, whatever the button is tapped twice.
    if (pending) return;
    if (!asDraft && !cover.url) {
      setCoverError("Add an Event cover before publishing.");
      coverRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setCoverError("");
    onCreate({
      name: name.trim(),
      date,
      startTime,
      endTime,
      venueLabel: venueLabel.trim(),
      description: description.trim(),
      draft: asDraft,
      coverFile: pendingCover,
      focalX: cover.focalX,
      focalY: cover.focalY
    });
  }

  function resetFields() {
    setName("");
    setDate("");
    setStartTime("");
    setEndTime("");
    setVenueLabel("");
    setDescription("");
    // The cover is part of the draft too: leaving it behind would show the
    // previous Event's artwork the next time this opens.
    setCover({ url: null, focalX: 0.5, focalY: 0.5 });
    setPendingCover(null);
    setCoverError("");
  }

  /**
   * Cleared when the sheet is dismissed, and again as it opens.
   *
   * Resetting only on dismissal was not enough: the parent closes this
   * directly after a successful publish without routing through here, so the
   * next Create opened pre-filled with the previous Event. Clearing on open
   * covers every path, and deliberately leaves a FAILED publish untouched --
   * that sheet stays open and everything typed must survive.
   */
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
      {/* One continuous sheet, not a stack of bordered cards.
          Every field used to sit in its own FormField box with its own label,
          which made creating an Event read as an admin form. Hierarchy now
          comes from type scale, spacing and two hairline dividers; the
          artwork carries the personality. */}
      <div className="-mx-1 max-h-[70vh] space-y-5 overflow-y-auto px-1 pb-1">
        {/* COVER, first and large.
            The upload needs an event id, but that is an implementation
            detail: the picker takes the image here, holds it, and uploads it
            during Publish once a provisional draft exists. */}
        <div ref={coverRef}>
          <EventCoverField
            eventId={null}
            value={cover}
            onChange={(next) => {
              setCover(next);
              if (next.url) setCoverError("");
            }}
            onPendingFile={setPendingCover}
            invalid={Boolean(coverError)}
            disabled={pending}
          />
          {coverError ? (
            <p role="alert" className="mt-1.5 text-xs font-medium text-destructive">
              {coverError}
            </p>
          ) : null}
        </div>

        {/* NAME + DESCRIPTION as writing, not inputs. Borderless so the
            creator sees their words at the size they will be read. */}
        <div className="space-y-1">
          <input
            id="event-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Event name"
            aria-label="Event name"
            className="w-full bg-transparent text-xl font-semibold leading-tight outline-none placeholder:text-muted-foreground/60 focus-visible:outline-none"
          />
          <Textarea
            id="event-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add a description"
            aria-label="Description"
            rows={2}
            className="min-h-0 resize-none border-0 bg-transparent px-0 text-sm leading-relaxed shadow-none focus-visible:ring-0"
          />
        </div>

        {/* WHEN: one section, three tappable values.
            This was a full-width Date box plus a two-column grid of Starts
            and Ends -- three separate bordered inputs for one idea. The
            native pickers still sit underneath, so timezone handling and
            validation are untouched; only the presentation changed. */}
        <div className="border-t border-border/60 pt-4">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">When</p>
          <div className="mt-2 space-y-2">
            <label className="flex min-h-11 items-center justify-between gap-3" htmlFor="event-date">
              <span className="text-sm text-muted-foreground">Date</span>
              <input
                id="event-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="min-w-0 bg-transparent text-right text-[0.9375rem] font-medium outline-none"
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <label className="flex min-h-11 flex-1 items-center gap-2" htmlFor="event-start">
                <span className="text-sm text-muted-foreground">Starts</span>
                <input
                  id="event-start"
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-right text-[0.9375rem] font-medium outline-none"
                />
              </label>
              <span aria-hidden="true" className="shrink-0 text-muted-foreground/60">
                →
              </span>
              <label className="flex min-h-11 flex-1 items-center gap-2" htmlFor="event-end">
                <span className="sr-only">Ends</span>
                <input
                  id="event-end"
                  type="time"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-right text-[0.9375rem] font-medium outline-none"
                />
              </label>
            </div>
            {/* End-after-start, stated before the server has to refuse it.
                The server rule remains authoritative. */}
            {scheduleInvalid ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                The Event must end after it starts.
              </p>
            ) : null}
          </div>
        </div>

        {/* WHERE: one row. Long venue names wrap rather than overflow. */}
        <div className="border-t border-border/60 pt-4">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Where</p>
          <input
            id="event-venue"
            value={venueLabel}
            onChange={(event) => setVenueLabel(event.target.value)}
            placeholder="Add location"
            aria-label="Location"
            className="mt-1 min-h-11 w-full bg-transparent text-[0.9375rem] outline-none placeholder:text-muted-foreground/60"
          />
          <p className="text-xs text-muted-foreground">A venue name, not a street address.</p>
        </div>
      </div>
      {/* ONE primary action.
          Cancel, Save draft and Publish previously sat in a row as three
          similar buttons, which made saving a draft look like a required
          step. Publish is now full-width and alone; Save draft is a quiet
          text link beneath it, and Cancel is the sheet's own dismiss. */}
      <div className="mt-5 space-y-3 pb-[max(0px,env(safe-area-inset-bottom))]">
        <Button
          type="button"
          className="h-12 w-full text-base"
          disabled={!complete || pending}
          onClick={() => submit(false)}
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Publishing…
            </>
          ) : (
            "Publish event"
          )}
        </Button>
        <div className="flex items-center justify-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={!complete || pending}
            className="focus-ring rounded px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
            className="focus-ring rounded px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
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
  onToggleGlow,
  onRsvpChange,
  onPublish,
  publishError,
  cover,
  setCover,
  setPublishError
}: {
  event: EventView | null;
  glowList: EventGlowMuddyList | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onCheckIn: (sharePresence: boolean) => void;
  onCheckOut: () => void;
  onToggleGlow: () => void;
  onRsvpChange: (status: EventRsvpStatus) => void;
  onPublish: () => void;
  publishError: string;
  cover: EventCoverValue;
  setCover: (next: EventCoverValue) => void;
  setPublishError: (message: string) => void;
}) {
  const reducedMotion = useReducedMotion();
  // Starts OFF every time the modal is opened for a different event: a person
  // who shared their presence at one event has not agreed to share it at the
  // next one, so this consent is never carried over (Stage E).
  //
  // Reset during render off a changed key rather than in an effect: an effect
  // would leave one render where the previous event's ticked box is on screen
  // against the new event, and that frame is exactly the wrong thing to show
  // for a consent control.
  const [sharePresence, setSharePresence] = useState(false);
  const [presenceEventId, setPresenceEventId] = useState(event?.id ?? null);
  if (presenceEventId !== (event?.id ?? null)) {
    setPresenceEventId(event?.id ?? null);
    setSharePresence(false);
  }
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
                  <GlowAvatar
                    name={muddy.displayName}
                    src={muddy.avatarUrl}
                    size="sm"
                    reducedMotion={reducedMotion}
                    membershipTier={publicMembershipTier(muddy.plan)}
                  />
                  <span className="text-xs font-medium">{muddy.displayName}</span>
                  <PremiumPlanBadge plan={muddy.plan} compact />
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

          {/*
            RSVP (Plans + Events lifecycle, Stage C). Hosting and RSVPing are
            different concepts: the host sees their own standing stated
            plainly rather than being offered Interested/Going on their own
            event, which setEventRsvp's server-side check would refuse anyway
            -- this mirrors that rule in the UI rather than showing a control
            that would always fail.

            Selected state uses the same variant="primary" vs "outline"
            pattern the Plans RSVP buttons already use (components/plans/
            plans-page.tsx), not a new segmented control -- one selected-state
            language across the app's two RSVP surfaces.
          */}
          {event.isHost ? (
            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-sm">
              <Users className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              You&apos;re hosting this event.
            </div>
          ) : (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your RSVP</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={event.myRsvp === "interested" ? "primary" : "outline"}
                  disabled={pending}
                  onClick={() => onRsvpChange("interested")}
                >
                  Interested
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={event.myRsvp === "going" ? "primary" : "outline"}
                  disabled={pending}
                  onClick={() => onRsvpChange("going")}
                >
                  Going
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={event.myRsvp === "not_going" ? "primary" : "outline"}
                  disabled={pending}
                  onClick={() => onRsvpChange("not_going")}
                >
                  Not going
                </Button>
              </div>
            </div>
          )}

          {/* HOST: cover + publish. Only here, because only here does the
              event have an id to attach media to (§6, §7). */}
          {event.isHost ? (
            <div className="space-y-3 border-t border-border/70 pt-4">
              <EventCoverField
                eventId={event.id}
                value={cover}
                onChange={(next) => {
                  setCover(next);
                  if (next.url) setPublishError("");
                }}
                invalid={Boolean(publishError)}
                disabled={pending}
              />
              {event.status === "draft" ? (
                <div className="space-y-2">
                  <Button type="button" disabled={pending} onClick={onPublish}>
                    Publish event
                  </Button>
                  {publishError ? (
                    <p role="alert" className="text-xs font-medium text-destructive">
                      {publishError}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      This Event is a draft. Add a cover, then publish it.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

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
              <div className="flex w-full flex-col gap-3">
                <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    checked={sharePresence}
                    disabled={pending}
                    onChange={(changeEvent) => setSharePresence(changeEvent.target.checked)}
                  />
                  <span>
                    <span className="font-medium text-foreground">Let my Muddies see I&apos;m here</span>
                    <span className="block text-xs">
                      Off by default. Only Muddies who are also checked in can see you, and you can turn
                      it off any time.
                    </span>
                  </span>
                </label>
                <Button
                  type="button"
                  className="self-start"
                  disabled={pending}
                  onClick={() => onCheckIn(sharePresence)}
                >
                  Check in
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
