"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus, MapPin, Sparkles, Users } from "lucide-react";
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
import { FormField } from "@/components/auth/form-field";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { CheckInSuccessSheet } from "@/components/events/check-in-success-sheet";
import { EventCoverField, type EventCoverValue } from "@/components/events/event-cover-field";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { Input } from "@/components/ui/input";
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
  }) {
    const startsAt = new Date(`${input.date}T${input.startTime}`);
    const endsAt = new Date(`${input.date}T${input.endTime}`);
    startTransition(async () => {
      const result = await createEventAction({
        name: input.name,
        description: input.description || undefined,
        venueLabel: input.venueLabel || undefined,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        draft: input.draft
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
        <Button type="button" onClick={() => setCreateOpen(true)} data-tour-id={TOUR_TARGET_IDS.EVENTS_CREATE}>
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
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                Create Event
              </Button>
            }
          />
        </div>
      )}

      <CreateEventModal open={createOpen} onOpenChange={setCreateOpen} pending={isPending} onCreate={createEvent} />
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
  const coverRef = useRef<HTMLDivElement | null>(null);

  const complete = name.trim().length >= 2 && date && startTime && endTime;

  /**
   * Save draft / Publish (§7, §8).
   *
   * Publishing without a cover is caught HERE, before the request, so the
   * creator gets the real message and keeps everything they typed rather than
   * a generic server error. The server rule remains authoritative -- this is
   * the graceful front door to it, not a replacement for it.
   */
  function submit(asDraft: boolean) {
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
      draft: asDraft
    });
    resetFields();
  }

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

        {/* COVER step. The event row does not exist yet at this point, so the
            upload target does too: a cover is attached from the Event's own
            edit view once it has an id. Saving a draft first is therefore the
            path to publishing, and the copy says so plainly rather than
            offering a picker that could not work. */}
        <div ref={coverRef} className="space-y-2 border-t border-border/70 pt-4">
          <p className="text-sm font-medium">Event cover</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Use a portrait image. Keep important faces and text near the centre so it works across
            Event cards. Save this as a draft first, then add the cover and publish.
          </p>
          {coverError ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {coverError}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
          Cancel
        </Button>
        {/* Save draft stays available with no cover (§8). It is visually
            distinct from Publish rather than a second primary button. */}
        <Button
          type="button"
          variant="outline"
          disabled={!complete || pending}
          onClick={() => submit(true)}
        >
          Save draft
        </Button>
        <Button type="button" disabled={!complete || pending} onClick={() => submit(false)}>
          Publish event
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
