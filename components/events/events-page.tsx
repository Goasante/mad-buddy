"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  checkInToEventAction,
  checkOutAction,
  createEventAction,
  getEventGlowAction,
  setEventGlowAction,
  setEventRsvpAction,
  listEventUpdatesAction,
  getEventLinkrStateAction,
  getEventByIdAction,
  getEventDraftAction,
  updateEventDraftAction,
} from "@/app/(app)/event-actions";
import { eventPhase, type EventPhase } from "@/lib/events/rules";
import type { EventRsvpStatus } from "@/lib/supabase/database.types";
import type { EventDraft, EventView } from "@/lib/events/mobile";
import { Button } from "@/components/ui/button";
import { CheckInSuccessSheet } from "@/components/events/check-in-success-sheet";
import {
  EventCoverField,
  type EventCoverValue,
} from "@/components/events/event-cover-field";
import { EventUpdates } from "@/components/events/event-updates";
import { MeetPeopleSheet } from "@/components/events/meet-people-sheet";
import {
  AudienceSelector,
  type AudienceValue,
} from "@/components/events/audience-selector";
import { EventAdminManager } from "@/components/events/event-admin-manager";
import { EventsHome } from "@/components/events/events-home";
import { EventsDiscover } from "@/components/events/events-discover";
import { EventsYours } from "@/components/events/events-yours";
import { EventsHosting } from "@/components/events/events-hosting";
import { EventDetail } from "@/components/events/event-detail";
import { EventShare } from "@/components/events/event-share";
import { AudienceChip } from "@/components/events/event-badges";
import { focalObjectPosition } from "@/lib/events/cover";
import type { EventUpdateView } from "@/lib/events/updates";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import type { EventGlowMuddyList } from "@/lib/events/types";
import { cn } from "@/lib/utils";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import { PageHeader } from "@/components/app-shell/page-header";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";

type EventLinkrState = {
  eligible: boolean;
  reason: string;
  consented: boolean;
  poolLabel: string | null;
};

/* THE FOUR SURFACES.
 *
 * Not four filters over one list -- four different questions. Home summarises
 * what is happening, Discover is for browsing, Yours tracks what you answered,
 * Hosting is for what you run. The previous tab strip answered all four with
 * the same card grid, which is what made Events read as a table with filters
 * rather than as a place where something is going on.
 */
type EventSurface = "home" | "discover" | "yours" | "hosting";

const EVENT_SURFACES: Array<{ id: EventSurface; label: string }> = [
  { id: "home", label: "Home" },
  { id: "discover", label: "Discover" },
  // "Yours" rather than "Your events": four labels share one 360px row, and
  // the surrounding tablist already says these are Events.
  { id: "yours", label: "Yours" },
  { id: "hosting", label: "Hosting" },
];

function phaseOf(event: EventView, nowMs: number): EventPhase {
  return eventPhase(
    {
      startsAtMs: Date.parse(event.startsAt),
      endsAtMs: Date.parse(event.endsAt),
    },
    nowMs
  );
}

export function EventsPageContent({
  initialEvents = [],
  currentUserPlan = "free",
  serverNowMs,
}: {
  initialEvents?: EventView[];
  currentUserPlan?: SubscriptionPlan;
  /** The server's render time, so the first paint is not stuck at the epoch. */
  serverNowMs?: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("event");
  /* The discovery list is only the FIRST place to look for a linked Event.
   *
   * listEvents is discovery-filtered, so an unlisted "anyone with the link"
   * Event is never in it -- which meant a shared link opened nothing at all,
   * silently. Same for a past Event and for an invite the viewer had not
   * loaded. The effect below fetches anything missing through the direct-access
   * authority instead. */
  const requestedEvent =
    initialEvents.find((event) => event.id === requestedId) ?? null;
  const [events, setEvents] = useState<EventView[]>(initialEvents);
  const [surface, setSurface] = useState<EventSurface>(() =>
    requestedEvent?.isHost ? "hosting" : "home"
  );
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [adminsOpen, setAdminsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  /* Bumped each time Create opens. Used as the modal's key so it remounts
     with empty state -- the parent closes it directly after a successful
     publish, which would otherwise leave the next Create pre-filled. */
  const [createSession, setCreateSession] = useState(0);
  /* RESUMING A DRAFT.
   *
   * Held as state rather than passed through the modal's key, because the
   * draft has to be FETCHED before the sheet can show anything: opening an
   * empty creation flow and filling it in afterwards is what produced a blank
   * overlay. The sheet opens only once there is something to open it with. */
  const [resumeDraft, setResumeDraft] = useState<EventDraft | null>(null);
  const [resumeState, setResumeState] = useState<"idle" | "loading" | "failed">("idle");

  const openCreate = () => {
    setResumeDraft(null);
    setResumeState("idle");
    setPublishFailure(null);
    setCreateSession((n) => n + 1);
    setCreateOpen(true);
  };

  /* CONTINUE ON A DRAFT.
   *
   * Never opens the Event detail -- that is a viewer's projection, and for a
   * draft with no cover it renders almost nothing, which is exactly the dimmed
   * empty panel the user hit. Every outcome here is explicit: the editor, a
   * loading state, or a failure with a way out. */
  function continueDraft(eventId: string) {
    setResumeState("loading");
    setPublishFailure(null);
    void (async () => {
      const draft = await getEventDraftAction(eventId);
      if (!draft) {
        setResumeState("failed");
        return;
      }
      setResumeDraft(draft);
      setResumeState("idle");
      setCreateSession((n) => n + 1);
      setCreateOpen(true);
    })();
  }
  const [selectedId, setSelectedId] = useState<string | null>(
    () => requestedEvent?.id ?? null
  );
  const [glowList, setGlowList] = useState<EventGlowMuddyList | null>(null);
  // Set only by a server-confirmed check-in; drives the success sheet.
  const [checkedInEvent, setCheckedInEvent] = useState<{
    id: string;
    name: string;
    glowEnabled: boolean;
  } | null>(null);
  /* THE PUBLISH MOMENT (4K §12).
   *
   * Creation used to end by closing the sheet, which left a host who had just
   * chosen "anyone with the link" holding an Event nobody could reach -- the
   * audience existed, the link never appeared. This is the one moment they are
   * certain to be looking, so it is where the link is offered. */
  const [publishedEvent, setPublishedEvent] = useState<{
    id: string;
    name: string;
    visibility: string;
  } | null>(null);
  /* WHY A PUBLISH FAILED, kept on the sheet rather than behind it.
   *
   * A failed publish leaves a real draft, so nothing is lost -- but the person
   * has to be told, in the place they are looking, with the actual reason. The
   * old flow closed the sheet and set a page-level message that the freshly
   * rendered Hosting surface then scrolled past. */
  const [publishFailure, setPublishFailure] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [publishError, setPublishError] = useState("");
  const [cover, setCover] = useState<EventCoverValue>({
    url: null,
    focalX: 0.5,
    focalY: 0.5,
  });
  const [isPending, startTransition] = useTransition();
  /* MUTATIONS THAT MUST FINISH.
   *
   * startTransition marks work as interruptible, and React really does abandon
   * it -- that is how the deep-link Server Action was aborted mid-flight. For a
   * READ that is merely wasteful; for a WRITE it is data loss: a publish that
   * uploads a cover and flips a status cannot be half-abandoned.
   *
   * So writes run as plain async work with their own pending flag, and this
   * combines with the transition flag wherever the UI just needs to know
   * something is in progress. */
  const [isWriting, setIsWriting] = useState(false);
  const busy = isPending || isWriting;

  /* Updates and Event Linkr state for the open Event.
   *
   * Loaded when a detail opens rather than for every card in the list: a
   * discovery feed does not need every Event's announcements, and fetching
   * them per card is exactly the N+1 shape this avoids. */
  const [updates, setUpdates] = useState<EventUpdateView[]>([]);
  const [canPublishUpdates, setCanPublishUpdates] = useState(false);
  const [linkrState, setLinkrState] = useState<EventLinkrState | null>(null);
  const [meetPeopleOpen, setMeetPeopleOpen] = useState(false);

  function loadEventContext(eventId: string, isHost: boolean) {
    startTransition(async () => {
      const [nextUpdates, nextLinkr] = await Promise.all([
        listEventUpdatesAction(eventId),
        getEventLinkrStateAction(eventId),
      ]);
      setUpdates(nextUpdates);
      setLinkrState(nextLinkr);
      // The composer is gated on the server too; this only decides whether to
      // render it. Admin delegation is resolved there, not guessed here.
      setCanPublishUpdates(isHost);
    });
  }

  function refreshUpdates() {
    if (!selectedId) return;
    startTransition(async () =>
      setUpdates(await listEventUpdatesAction(selectedId))
    );
  }

  /* Seeded from the server's render time rather than 0.
   *
   * A 0 here means "the epoch", under which EVERY Event is already over -- so
   * the first paint dropped the hero and every live badge until hydration
   * corrected it. Seeding keeps the server and client markup agreeing on one
   * instant; the effect below then owns the clock and refreshes it.
   *
   * The fallback keeps the component renderable without the prop (tests, and
   * any caller that has no server time to give). */
  const [nowMs, setNowMs] = useState(() => serverNowMs ?? Date.now());

  useEffect(() => {
    const updateClock = () => setNowMs(Date.now());
    const frame = window.requestAnimationFrame(updateClock);
    const interval = window.setInterval(updateClock, 30_000);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
    };
  }, []);

  const [linkedEventPending, setLinkedEventPending] = useState(false);
  /** The Event id whose request is currently authoritative. */
  const inFlightLinkRef = useRef<string | null>(null);
  const [linkedEventMissing, setLinkedEventMissing] = useState(false);
  /* OPENING /events?event=<id> -- ONE EFFECT, ONE AUTHORITY.
   *
   * This was two effects fighting over the same job, and the fight was the bug:
   * one loaded context for Events already in the discovery list, the other
   * fetched the ones that were not. Each wrote state the other depended on, so
   * whichever landed second reset the first, and the sheet sometimes never
   * settled -- the blank Event the user hit.
   *
   * Now a single effect keyed on the ID does the whole job:
   *
   *   1. select the requested Event, because the URL is what the person asked
   *      for and the open sheet must agree with the address bar;
   *   2. find it in the discovery list, or fetch it through the direct-access
   *      authority when it is not there -- an unlisted "anyone with the link"
   *      Event never is, by definition;
   *   3. load its context, identically either way, so a tapped card and a
   *      shared link produce the same screen;
   *   4. on refusal, say so recoverably rather than leaving a blurred shell.
   *
   * Nothing here widens access: getEventByIdAction answers through
   * getEventForViewer (block check, then canViewEvent) and returns null for
   * every refusal, disclosing nothing about why. */
  useEffect(() => {
    if (!requestedId) return;

    /* STALE-RESPONSE GUARD, KEYED ON THE ID -- not on a closure flag.
     *
     * Two earlier attempts failed here, both for the same underlying reason:
     * React invokes effects twice in development, so pass one starts a request
     * and its cleanup immediately marks that closure cancelled. A `cancelled`
     * boolean then makes pass one skip clearing the pending flag it had already
     * set, and the UI sits on "Opening event..." forever. A ref that marked the
     * id "already fetched" was worse: pass two returned early, so the only live
     * request was the cancelled one.
     *
     * Comparing against the ref at RESOLUTION time fixes both: whichever
     * response belongs to the id currently being requested is applied, and any
     * other is dropped. Double invocation becomes harmless rather than fatal,
     * and switching Events mid-flight cannot let an older response overwrite a
     * newer one. */
    inFlightLinkRef.current = requestedId;
    const isCurrent = () => inFlightLinkRef.current === requestedId;

    const known = initialEvents.find((event) => event.id === requestedId);

    /* ONE queued state write, not six synchronous ones.
     *
     * Setting each piece separately at the top of an effect triggers a cascade
     * of renders before anything has loaded, which the lint rule flags and is
     * right to. Everything the newly requested Event needs in order to start
     * clean is decided here and applied together. */
    queueMicrotask(() => {
      if (!isCurrent()) return;
      setSelectedId(requestedId);
      setGlowList(null);
      setUpdates([]);
      setLinkrState(null);
      setLinkedEventMissing(false);
      setLinkedEventPending(!known);
    });

    if (known) {
      loadEventContext(known.id, known.isHost);
      void (async () => {
        const list = await getEventGlowAction(known.id);
        if (isCurrent()) setGlowList(list);
      })();
      return;
    }

    /* NOT INSIDE startTransition.
     *
     * A transition is interruptible by design: React may abandon the work it
     * wraps, and when it did, the Server Action request was aborted mid-flight
     * (visible in the dev log as `Error: aborted`). The fetch never resolved,
     * so `setLinkedEventPending(false)` never ran and the screen sat on
     * "Opening event..." indefinitely -- the blank Event the user hit.
     *
     * This load is not optional background work; it is the whole reason the
     * page was opened. It runs as a plain async effect, and the id-keyed guard
     * below is what makes a superseded response harmless. */
    void (async () => {
      const linked = await getEventByIdAction(requestedId);
      if (!isCurrent()) return;
      setLinkedEventPending(false);
      if (!linked) {
        setLinkedEventMissing(true);
        setSelectedId(null);
        return;
      }
      setEvents((current) =>
        current.some((event) => event.id === linked.id)
          ? current
          : [linked, ...current]
      );
      loadEventContext(linked.id, linked.isHost);
      const list = await getEventGlowAction(linked.id);
      if (isCurrent()) setGlowList(list);
    })();
    // initialEvents is intentionally absent: it is a fresh array on every
    // render, and depending on it re-runs this per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedId]);

  const selectedEvent = events.find((event) => event.id === selectedId) ?? null;

  function openDetails(eventId: string) {
    setSelectedId(eventId);
    setGlowList(null);
    setUpdates([]);
    setLinkrState(null);
    const target = events.find((event) => event.id === eventId);
    loadEventContext(eventId, Boolean(target?.isHost));
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
      const result = await checkInToEventAction({
        eventId: event.id,
        eventGlowEnabled: sharePresence,
      });
      setFeedback(result.message);
      if (result.ok && result.checkInId) {
        setEvents((current) =>
          current.map((item) =>
            item.id === event.id
              ? {
                  ...item,
                  myCheckInId: result.checkInId ?? null,
                  myGlowEnabled: sharePresence,
                }
              : item
          )
        );
        setGlowList(await getEventGlowAction(event.id));
        // ONLY after the server confirmed. Never optimistic: claiming
        // "you're checked in" before the row exists would be a lie the user
        // acts on (§14).
        setCheckedInEvent({
          id: event.id,
          name: event.name,
          glowEnabled: sharePresence,
        });
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
      const { publishEventAction } = await import(
        "@/app/(app)/event-cover-actions"
      );
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
            item.id === event.id
              ? { ...item, myCheckInId: null, myGlowEnabled: false }
              : item
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
      const result = await setEventGlowAction(
        event.myCheckInId as string,
        next
      );
      setFeedback(result.message);
      if (result.ok) {
        setEvents((current) =>
          current.map((item) =>
            item.id === event.id ? { ...item, myGlowEnabled: next } : item
          )
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
          current.map((item) =>
            item.id === event.id ? { ...item, myRsvp: status } : item
          )
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
    audience: AudienceValue;
    /** The existing draft this publish belongs to, or null for a new Event. */
    draftId?: string | null;
    /** Lets the sheet release its own submit lock when this finishes. */
    onSettled?: () => void;
  }) {
    const startsAt = new Date(`${input.date}T${input.startTime}`);
    const endsAt = new Date(`${input.date}T${input.endTime}`);
    /* NOT a transition: publishing is three dependent server steps (create the
     * draft, upload the cover against its new id, then publish). Abandoning it
     * halfway leaves an Event with no artwork and the person with no share
     * link -- exactly what the journey test caught. */
    setIsWriting(true);
    void (async () => {
      /* try/finally, because the flow returns early on a failed cover upload.
       * Without it that path would leave the button disabled forever -- the
       * "Publishing…" dead end this file has hit before. */
      try {
        /* RESUME UPDATES, IT DOES NOT RE-CREATE.
         *
         * Publishing a resumed draft used to call create again, inserting a
         * SECOND Event and leaving the original in Drafts. The draft already
         * has an identity; finishing it is an update. */
        const payload = {
          name: input.name,
          description: input.description || undefined,
          venueLabel: input.venueLabel || undefined,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          // The creator's actual answer to "who should know about this". The
          // server re-validates that the audience points at something real.
          visibility: input.audience.visibility,
          audienceTargetIds: input.audience.targetIds,
          /* A resumed draft's stored location is already on the server, and the
           * placeholder the form carries for it (0,0) must never be written
           * back over it. Only a location the person actually set this session
           * is sent. */
          location:
            input.audience.location && input.audience.location.latitude !== 0
              ? input.audience.location
              : undefined,
        };

        const result = input.draftId
          ? await updateEventDraftAction(input.draftId, payload)
          : await createEventAction(payload);
        // A resumed draft keeps its own id; a new Event gets one from create.
        const eventId = input.draftId ?? result.eventId;

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
        /* ONE LIFECYCLE, AND THE DATABASE DECIDES.
         *
         * THE BUG. Creation always makes a DRAFT, then publishing is two more
         * server steps: upload the held cover against the new id, then publish.
         * The old code treated those as side quests -- a failed upload returned
         * early (skipping the success block entirely, so no confirmation ever
         * appeared), while a failed PUBLISH set a message and then fell through
         * into the success block anyway, announcing "Event published" over an
         * Event still sitting in draft. That is exactly what the user saw: a
         * publish that looked done and an Event under Hosting -> Drafts.
         *
         * Now every path resolves to one honest outcome, and `published` is
         * read from the server's answer rather than inferred from the fact that
         * we navigated. */
        let published = false;
        let failure: string | null = null;

        if (result.ok && eventId && !input.draft) {
          const { uploadEventCoverAction, setEventCoverFocalAction, publishEventAction } =
            await import("@/app/(app)/event-cover-actions");

          if (input.coverFile) {
            const formData = new FormData();
            formData.append("eventId", eventId);
            formData.append("media", input.coverFile);
            const uploaded = await uploadEventCoverAction(formData);
            if (!uploaded.ok) {
              /* The draft is real and private, so nothing typed is lost -- but
               * this is a FAILURE and must read as one. It is not narrowed to
               * the cover: an upload can fail for storage, moderation, rate
               * limiting or size, and uploaded.message says which. */
              failure = uploaded.message;
            } else if (input.focalX !== 0.5 || input.focalY !== 0.5) {
              await setEventCoverFocalAction({ eventId, focalX: input.focalX, focalY: input.focalY });
            }
          }

          if (!failure) {
            const publishResult = await publishEventAction(eventId);
            published = publishResult.ok;
            if (!publishResult.ok) failure = publishResult.message;
          }
        }


        if (failure) {
          /* PUBLISH FAILED. The sheet stays open on Review with everything the
           * person entered, and the message says what actually went wrong --
           * rate limit, storage, validation, permission. Closing the sheet here
           * is what previously made a failure look like a success. */
          setPublishFailure(failure);
          return;
        }

        if (!result.ok) {
          setPublishFailure(result.message);
          return;
        }

        // From here the create succeeded. Draft or published, the sheet closes.
        setPublishFailure(null);
        setFeedback(input.draft ? result.message : published ? "Event published." : result.message);
        setCreateOpen(false);
        setSurface("hosting");
        router.refresh();

        /* The share moment is offered ONLY for an Event the server confirmed
         * as published. A draft has no shareable identity yet, and offering a
         * link to one would hand out a URL that refuses everybody. */
        if (eventId && published) {
          setPublishedEvent({
            id: eventId,
            name: input.name,
            visibility: input.audience.visibility
          });
        }

        if (eventId) {
          setEvents((current) => [
            {
              id: eventId,
              name: input.name,
              description: input.description || null,
              venueLabel: input.venueLabel || null,
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
              // The server's answer, not a guess from what we sent.
              status: published ? "scheduled" : "draft",
              hostName: "You",
              hostPlan: currentUserPlan,
              isHost: true,
              myCheckInId: null,
              myGlowEnabled: false,
              // The host never carries an RSVP row -- hosting is derived from
              // isHost, not fabricated as intent to attend one's own event.
              myRsvp: null,
              /* PRESENTATION FACTS, at their true starting values. The cover
               * arrives on the next refresh; counts start at zero because
               * nobody has answered yet. */
              coverUrl: null,
              focalX: input.focalX,
              focalY: input.focalY,
              locality: null,
              visibility: input.audience?.visibility ?? "community",
              goingCount: 0,
              interestedCount: 0,
              isInvited: false
            },
            ...current
          ]);
        }
      } finally {
        setIsWriting(false);
        input.onSettled?.();
      }
    })();
  }

  /* THE SURFACE ROUTER.
   *
   * Four surfaces, not four filters over one list. Home summarises, Discover
   * browses, Yours tracks commitments, Hosting manages -- each is a different
   * question, and the old shared card grid answered all of them the same way,
   * which is what made the product read as a table with tabs.
   *
   * Detail opens as a sheet over whichever surface launched it, so browsing
   * position survives a look at an Event. */
  const surfaceContent =
    surface === "discover" ? (
      <EventsDiscover events={events} nowMs={nowMs} onOpen={openDetails} />
    ) : surface === "yours" ? (
      <EventsYours
        events={events}
        nowMs={nowMs}
        onOpen={openDetails}
        onBrowse={() => setSurface("discover")}
      />
    ) : surface === "hosting" ? (
      <EventsHosting
        events={events}
        nowMs={nowMs}
        onOpen={openDetails}
        onCreate={openCreate}
        onResumeDraft={continueDraft}
      />
    ) : (
      <EventsHome
        events={events}
        nowMs={nowMs}
        onOpen={openDetails}
        onCreate={openCreate}
        onSeeAll={() => setSurface("discover")}
      />
    );

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 md:pt-6">
      <PageHeader title="Events" />

      {/* COMPACT HEADER (4J §10-12).
       *
       * The desktop h1 is hidden on phones (the shared PageHeader carries the
       * title there), so Create event used to sit alone in a header row of its
       * own -- an empty band above the tabs that made the whole screen look
       * stretched before any content began.
       *
       * The title row now renders only where it has a title, and Create event
       * rides the same line as the surface tabs: still reachable, no longer
       * floating in its own empty section, and no longer competing with the
       * page title for attention. */}
      {/* The `hidden` stays ON THE H1, not only on this wrapper: the shared
          PageHeader already carries the title on mobile, and
          mobile-page-header.test.ts checks the heading itself so the rule
          cannot be satisfied by a wrapper that a later refactor removes. */}
      <header className="hidden md:flex md:items-center md:justify-between md:gap-3">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block sm:text-3xl">
          Events
        </h1>
      </header>

      {feedback ? (
        <p className="text-sm text-muted-foreground" role="status">
          {feedback}
        </p>
      ) : null}

      {/* FOUR DESTINATIONS, ONE ACTION (4J §28-29).
       *
       * Create used to sit inside the tab row, and at 360px it took the space
       * Hosting needed -- so a canonical destination disappeared behind a
       * horizontal scroll nobody could see. Create is a VERB, not a place:
       * it belongs beside the surface as an action, not among the nouns.
       *
       * The tabs now get the full width and share it evenly, so all four fit
       * at 360px without scrolling. Create sits above them as a compact
       * icon-and-label button. */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {surface === "hosting"
            ? "Events you run."
            : surface === "yours"
            ? "What you are going to, and what you host."
            : "What is happening around you."}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={openCreate}
          data-tour-id={TOUR_TARGET_IDS.EVENTS_CREATE}
          className="shrink-0 px-3"
        >
          <CalendarPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Create
        </Button>
      </div>

      <nav
        data-tour-id={TOUR_TARGET_IDS.EVENTS_TABS}
        aria-label="Events sections"
      >
        <div
          role="tablist"
          aria-label="Events sections"
          className="flex gap-1 rounded-xl bg-secondary/50 p-1"
        >
          {EVENT_SURFACES.map((entry) => {
            const active = surface === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSurface(entry.id)}
                className={cn(
                  // flex-1 + min-w-0: four equal shares, and the label may
                  // shrink rather than push a sibling off the row.
                  // min-h-11 (44px) is the app-wide minimum touch target; this row was
                  // 2.25rem (36px).
                  "min-h-11 min-w-0 flex-1 truncate rounded-lg px-1.5 text-[0.8125rem] font-medium transition sm:text-sm",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* RESUMING A DRAFT: never a bare overlay (4L §12).
          Loading and failure are both stated. The failure offers a way back
          rather than leaving the person on a dimmed screen. */}
      {resumeState === "loading" ? (
        <p role="status" className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Opening your draft…
        </p>
      ) : null}

      {resumeState === "failed" ? (
        <div role="alert" className="space-y-2 rounded-xl bg-secondary/40 p-3.5">
          <p className="text-sm font-medium">We couldn&apos;t open that draft.</p>
          <p className="text-xs text-muted-foreground">
            It may have been published or removed. Your other drafts are unaffected.
          </p>
          <Button size="sm" variant="secondary" onClick={() => setResumeState("idle")}>
            Back to Hosting
          </Button>
        </div>
      ) : null}

      {/* A LINKED EVENT THAT WOULD NOT OPEN (4J §7, §9).
          Every outcome is explicit: still loading, or unavailable with a way
          back. The one state that must never happen is the blurred app with
          nothing in it, which is what a silent failure produced. */}
      {linkedEventPending ? (
        <p
          role="status"
          className="flex items-center gap-2 px-1 text-sm text-muted-foreground"
        >
          <Loader2
            className="h-4 w-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          Opening event…
        </p>
      ) : null}

      {linkedEventMissing ? (
        <div
          role="alert"
          className="space-y-2 rounded-xl bg-secondary/40 p-3.5"
        >
          <p className="text-sm font-medium">
            We couldn&apos;t open this event.
          </p>
          {/* Deliberately does not distinguish "deleted" from "you are blocked"
              from "not invited": saying which would disclose the Event, or the
              block, to somebody who may not see either. */}
          <p className="text-xs text-muted-foreground">
            It may have been removed, or it is not shared with you.
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setLinkedEventMissing(false);
              router.replace("/events");
            }}
          >
            Browse events
          </Button>
        </div>
      ) : null}

      <div data-tour-id={TOUR_TARGET_IDS.EVENTS_LIST}>{surfaceContent}</div>

      <CreateEventModal
        key={createSession}
        open={createOpen}
        onOpenChange={setCreateOpen}
        pending={busy}
        onCreate={createEvent}
        failure={publishFailure}
        onDismissFailure={() => setPublishFailure(null)}
        draft={resumeDraft}
      />

      {/* DETAIL AS A SHEET. Constrained content width on desktop rather than a
          390px column stretched across the viewport. */}
      <Modal
        open={Boolean(selectedEvent)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        variant="sheet"
        title={selectedEvent?.name ?? "Event"}
        hideTitle
        widthClassName="sm:max-w-xl"
      >
        {selectedEvent ? (
          <EventDetail
            event={selectedEvent}
            nowMs={nowMs}
            glowList={glowList}
            updates={updates}
            linkrState={linkrState}
            canCheckIn={phaseOf(selectedEvent, nowMs) === "live"}
            pending={busy}
            onRsvp={(status) => changeRsvp(selectedEvent, status)}
            onCheckIn={(sharePresence) => checkIn(selectedEvent, sharePresence)}
            onCheckOut={() => checkOut(selectedEvent)}
            onToggleGlow={() => toggleGlow(selectedEvent)}
            onOpenConsent={() => setMeetPeopleOpen(true)}
            onOpenLinkr={() => router.push("/discover")}
            onTurnOffLinkr={() => setMeetPeopleOpen(true)}
            onOpenUpdates={() => setUpdatesOpen(true)}
            onManageAdmins={() => setAdminsOpen(true)}
            draftCover={
              selectedEvent.isHost && selectedEvent.status === "draft"
                ? {
                    value: cover,
                    onChange: (next) => {
                      setCover(next);
                      // A new cover clears the previous refusal: the reason it
                      // was refused may no longer apply.
                      setPublishError("");
                    },
                    onPublish: () => publish(selectedEvent),
                    error: publishError,
                  }
                : null
            }
          />
        ) : null}
      </Modal>

      {/* Updates and admins are their own surfaces rather than accordions
          inside the detail sheet: each is a place you go to do one thing, and
          nesting them made the detail view scroll past its own actions. */}
      <Modal
        open={updatesOpen && Boolean(selectedEvent)}
        onOpenChange={setUpdatesOpen}
        variant="sheet"
        title="Updates"
        hideTitle
      >
        {selectedEvent ? (
          <EventUpdates
            eventId={selectedEvent.id}
            updates={updates}
            canPublish={canPublishUpdates}
            onChanged={refreshUpdates}
          />
        ) : null}
      </Modal>

      <Modal
        open={adminsOpen && Boolean(selectedEvent?.isHost)}
        onOpenChange={setAdminsOpen}
        variant="sheet"
        title="Event admins"
      >
        {selectedEvent?.isHost ? (
          <EventAdminManager eventId={selectedEvent.id} />
        ) : null}
      </Modal>

      {selectedEvent && linkrState ? (
        <MeetPeopleSheet
          eventId={selectedEvent.id}
          eventName={selectedEvent.name}
          open={meetPeopleOpen}
          consented={linkrState.consented}
          poolLabel={linkrState.poolLabel}
          onOpenChange={setMeetPeopleOpen}
          onConsentChange={(enabled) =>
            setLinkrState((current) =>
              current ? { ...current, consented: enabled } : current
            )
          }
        />
      ) : null}

      {/* EVENT PUBLISHED (4K §12). The share link is offered here because this
          is the one moment the host is certainly looking -- and for a Link
          Event it is the only way anybody reaches it. */}
      <Modal
        open={Boolean(publishedEvent)}
        onOpenChange={(open) => {
          if (!open) setPublishedEvent(null);
        }}
        variant="sheet"
        title="Event published"
        /* AUDIENCE-SPECIFIC (4L §19, §22). What happens next genuinely differs:
           a Public Event is discoverable, an unlisted one is reachable only
           through its link, and an invited one is already waiting for the
           people who were named. Saying "it is live" for all three would be
           wrong for two of them. */
        description={
          publishedEvent?.visibility === "link"
            ? "Only people with this link can open your event."
            : publishedEvent?.visibility === "nearby"
              ? "People around your event location can discover it."
              : publishedEvent?.visibility === "invite"
                ? "Your event is ready. The people you invited can now open it."
                : publishedEvent?.visibility === "community"
                  ? "Members of the community you chose can now find it."
                  : "Your event is live."
        }
      >
        {publishedEvent ? (
          <div className="space-y-4">
            <EventShare
              eventId={publishedEvent.id}
              eventName={publishedEvent.name}
              visibility={publishedEvent.visibility}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  const eventId = publishedEvent.id;
                  setPublishedEvent(null);
                  openDetails(eventId);
                }}
              >
                View event
              </Button>
              <Button variant="ghost" onClick={() => setPublishedEvent(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

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
            // Routes into the EXISTING presence list in the detail sheet.
            // No second attendee list.
            const eventId = checkedInEvent.id;
            setCheckedInEvent(null);
            openDetails(eventId);
          }}
        />
      ) : null}
    </div>
  );
}

function CreateEventModal({
  open,
  onOpenChange,
  pending,
  onCreate,
  failure,
  onDismissFailure,
  draft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  /** Why the last publish attempt failed, or null. */
  failure?: string | null;
  onDismissFailure?: () => void;
  /** An existing draft being resumed, or null for a fresh Event. */
  draft?: EventDraft | null;
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
    audience: AudienceValue;
    /** The existing draft this publish belongs to, or null for a new Event. */
    draftId?: string | null;
    /** Lets this sheet release its submit lock when the publish finishes. */
    onSettled: () => void;
  }) => void;
}) {
  /* SEEDED FROM THE DRAFT, IF THERE IS ONE.
   *
   * The sheet is remounted for every Create (see createSession as its key), so
   * seeding initial state is enough -- no effect writing into fields after the
   * first paint, which is how a resumed draft would flicker empty before
   * filling in. A fresh Event seeds the same defaults as before. */
  const [name, setName] = useState(draft?.name ?? "");
  /* Public is the default because most Events are, but it is a VISIBLE default
     the creator can see and change -- not the invisible hardcoded `community`
     that made this decision unaskable. */
  const [audience, setAudience] = useState<AudienceValue>({
    visibility: (draft?.visibility as AudienceValue["visibility"]) ?? "public",
    targetIds: draft?.targetIds ?? [],
    /* A draft's saved coordinates stay on the server. What matters to the form
     * is whether a location EXISTS, so validateAudienceRequirements is not
     * re-triggered for a Nearby Event that already has one. */
    location: draft?.hasLocation ? { latitude: 0, longitude: 0 } : null,
  });
  const [date, setDate] = useState(draft?.date ?? "");
  const [startTime, setStartTime] = useState(draft?.startTime ?? "");
  const [endTime, setEndTime] = useState(draft?.endTime ?? "");
  const [venueLabel, setVenueLabel] = useState(draft?.venueLabel ?? "");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [cover, setCover] = useState<EventCoverValue>({
    url: draft?.coverUrl ?? null,
    focalX: draft?.focalX ?? 0.5,
    focalY: draft?.focalY ?? 0.5,
  });
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
  const scheduleInvalid = Boolean(
    date && startTime && endTime && endTime <= startTime
  );
  const complete =
    name.trim().length >= 2 && date && startTime && endTime && !scheduleInvalid;

  /* A GUIDED FLOW, NOT ONE LONG FORM (4J §21-24).
   *
   * Everything used to render at once inside a single scrolling sheet:
   * audience, its sub-form, the cover, name, description, date, times and
   * venue. That is an administrative form, and it made a happy occasion feel
   * like filing something.
   *
   * The stages below hold the SAME state and the same submit -- nothing about
   * validation or the server contract changed. Only how much is asked at once.
   *
   * Audience stays first, deliberately: it is the decision that changes what
   * the rest of the flow means, and asking it last would let someone dress an
   * Event for the public before deciding whether it is public at all. */
  const STAGES = ["audience", "basics", "when", "review"] as const;
  type Stage = (typeof STAGES)[number];

  /* RESUME WHERE THE WORK ACTUALLY STOPPED (4L §11).
   *
   * Sending somebody back to the audience question to re-answer four stages
   * they already completed is its own kind of failure. This walks forward to
   * the first stage that is genuinely missing something; when nothing is
   * missing, it opens Review, where the only thing left to do is publish.
   *
   * A fresh Event always starts at the beginning. */
  const [stage, setStage] = useState<Stage>(() => {
    if (!draft) return "audience";
    const audienceDone =
      (draft.visibility !== "invite" && draft.visibility !== "community") || draft.targetIds.length > 0;
    if (!audienceDone) return "audience";
    // A cover is required to publish, so a draft without one is incomplete.
    if (draft.name.trim().length < 2 || !draft.coverUrl) return "basics";
    if (!draft.date || !draft.startTime || !draft.endTime) return "when";
    return "review";
  });
  const stageIndex = STAGES.indexOf(stage);

  /** Audience needs its own targets; the rest is checked at Review. */
  const audienceReady =
    (audience.visibility !== "invite" && audience.visibility !== "community") ||
    audience.targetIds.length > 0;
  const basicsReady = name.trim().length >= 2;
  const whenReady = Boolean(date && startTime && endTime && !scheduleInvalid);

  const canAdvance =
    stage === "audience"
      ? audienceReady
      : stage === "basics"
      ? basicsReady
      : stage === "when"
      ? whenReady
      : true;

  const STAGE_TITLE: Record<Stage, string> = {
    audience: "Create Event",
    basics: "Event basics",
    when: "When & where",
    review: "Review your Event",
  };

  function goNext() {
    const next = STAGES[Math.min(STAGES.length - 1, stageIndex + 1)];
    setStage(next);
  }

  function goBack() {
    setStage(STAGES[Math.max(0, stageIndex - 1)]);
  }

  /**
   * Save draft / Publish (§7, §8).
   *
   * Publishing without a cover is caught HERE, before the request, so the
   * creator gets the real message and keeps everything they typed rather than
   * a generic server error. The server rule remains authoritative -- this is
   * the graceful front door to it, not a replacement for it.
   */
  /** True only while THIS sheet's own publish is running. */
  const [submitting, setSubmitting] = useState(false);

  function submit(asDraft: boolean) {
    /* GUARDED ON THIS SHEET'S OWN SUBMISSION, not on `pending`.
     *
     * `pending` is the page-wide busy flag, and it is set by unrelated work --
     * including the cover upload that happens two stages earlier in this very
     * flow. Guarding on it meant that by the time somebody reached Review and
     * tapped Publish, the flag could still be true from something else, and
     * this returned immediately: the button showed "Publishing…" forever and
     * no Event was ever created.
     *
     * A dedicated flag still gives the duplicate-tap protection the original
     * guard was for, without borrowing an unrelated signal. */
    if (submitting) return;
    setSubmitting(true);
    if (!asDraft && !cover.url) {
      /* SEND THEM WHERE THE PROBLEM IS.
       *
       * This used to set the error and scroll to the cover field -- which is on
       * the BASICS stage. From Review that control is not rendered at all, so
       * scrollIntoView did nothing and the message appeared on a screen the
       * person could not see. Publish simply appeared dead.
       *
       * Now the flow returns to Basics, where the error and the control are
       * together and the fix is one tap away. */
      setCoverError("Add an Event cover before publishing.");
      setStage("basics");
      // After the stage renders, put the field in view.
      queueMicrotask(() => coverRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
      setSubmitting(false);
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
      focalY: cover.focalY,
      audience,
      /* The draft being resumed, if any. Without this, publishing a resumed
       * draft CREATES A SECOND EVENT and leaves the original in Drafts -- two
       * rows with the same name, one of them unreachable. */
      draftId: draft?.id ?? null,
      onSettled: () => setSubmitting(false)
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
    // An audience belongs to one Event. Carrying a wedding guest list into the
    // next Event would attach people to something nobody asked them about.
    setAudience({ visibility: "public", targetIds: [], location: null });
    setCoverError("");
    // Back to the first stage too: reopening mid-flow would strand the person
    // on a Review step for an Event that no longer exists.
    setStage("audience");
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
      title={STAGE_TITLE[stage]}
      /* NO STALE AUDIENCE COPY (4J §18-19). The subtitle used to read "Visible
         to the community", which was true back when creation hardcoded that
         audience -- and stayed on screen while somebody had Public selected.
         The sheet must not answer the question it is asking. */
      description={
        stage === "audience"
          ? "Bring people together around something happening."
          : undefined
      }
    >
      {/* PROGRESS: four dots, no "Step 2 of 4" admin label. The current dot is
          wider rather than merely coloured, so position is not carried by
          colour alone; the live region announces it for anyone who cannot see
          the dots at all. */}
      <div className="mb-4 flex items-center gap-1.5" aria-hidden="true">
        {STAGES.map((entry, index) => (
          <span
            key={entry}
            className={cn(
              "h-1 rounded-full transition-all",
              index === stageIndex
                ? "w-6 bg-primary"
                : index < stageIndex
                ? "w-3 bg-primary/45"
                : "w-3 bg-border"
            )}
          />
        ))}
      </div>
      <p className="sr-only" role="status">
        Step {stageIndex + 1} of {STAGES.length}: {STAGE_TITLE[stage]}
      </p>

      <div className="-mx-1 min-w-0 max-w-[calc(100%+0.5rem)] space-y-5 overflow-x-hidden px-1 pb-1">
        {/* STAGE 1 -- AUDIENCE.
            First because it is the decision that changes what the rest of the
            flow means. Its sub-flow (invitees, community, location) renders
            inside the selector, so this stage asks one question at a time. */}
        {stage === "audience" ? (
          <AudienceSelector value={audience} onChange={setAudience} />
        ) : null}

        {/* STAGE 2 -- BASICS: cover, name, description. */}
        <div className={cn(stage === "basics" ? "space-y-5" : "hidden")}>
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
              <p
                role="alert"
                className="mt-1.5 text-xs font-medium text-destructive"
              >
                {coverError}
              </p>
            ) : null}
          </div>

          {/* NAME + DESCRIPTION: label above, filled field below (4J §38-40).
            These were borderless and transparent, on the theory that the
            creator should see their words at reading size. In practice a
            transparent field with muted placeholder text is indistinguishable
            from a caption -- people could not tell what was editable. A soft
            filled surface says "type here" without the heavy outlined-box look
            the rest of the sheet avoids. */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="event-name" className="text-sm font-medium">
                Event name
              </label>
              <input
                id="event-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Give your Event a name"
                className="min-h-11 w-full rounded-xl bg-secondary/50 px-3.5 text-base font-medium leading-tight outline-none ring-1 ring-inset ring-border/40 transition placeholder:font-normal placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="event-description"
                className="text-sm font-medium"
              >
                Description
              </label>
              <Textarea
                id="event-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Tell people what it's about"
                rows={2}
                className="resize-none rounded-xl border-0 bg-secondary/50 px-3.5 py-2.5 text-sm leading-relaxed shadow-none ring-1 ring-inset ring-border/40 placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
          </div>
        </div>

        {/* STAGE 3 -- WHEN & WHERE.
            Kept mounted but hidden rather than unmounted, so a half-typed time
            survives a step back. */}
        <div className={cn(stage === "when" ? "space-y-5" : "hidden")}>
          {/* WHEN: one section, three tappable values.
            This was a full-width Date box plus a two-column grid of Starts
            and Ends -- three separate bordered inputs for one idea. The
            native pickers still sit underneath, so timezone handling and
            validation are untouched; only the presentation changed. */}
          <div className="border-t border-border/60 pt-4">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              When
            </p>
            {/* ROWS, NOT RAW INPUTS (4J §41-43). Three transparent native
              controls in a row rendered as "--:-- --  clock  →  --:-- --",
              which reads as technical input rather than as a product. Each
              value now sits in its own labelled row on a soft surface; the
              native picker still opens on tap, so timezone handling and
              validation are untouched. */}
            <div className="mt-2 space-y-1.5">
              <label
                className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-secondary/50 px-3.5 ring-1 ring-inset ring-border/40 focus-within:ring-2 focus-within:ring-primary"
                htmlFor="event-date"
              >
                <span className="text-sm text-muted-foreground">Date</span>
                <input
                  id="event-date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="min-w-0 bg-transparent text-right text-[0.9375rem] font-medium outline-none"
                />
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <label
                  className="flex min-h-12 items-center justify-between gap-2 rounded-xl bg-secondary/50 px-3.5 ring-1 ring-inset ring-border/40 focus-within:ring-2 focus-within:ring-primary"
                  htmlFor="event-start"
                >
                  <span className="shrink-0 text-sm text-muted-foreground">
                    Starts
                  </span>
                  <input
                    id="event-start"
                    type="time"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-right text-[0.9375rem] font-medium outline-none"
                  />
                </label>
                <label
                  className="flex min-h-12 items-center justify-between gap-2 rounded-xl bg-secondary/50 px-3.5 ring-1 ring-inset ring-border/40 focus-within:ring-2 focus-within:ring-primary"
                  htmlFor="event-end"
                >
                  <span className="shrink-0 text-sm text-muted-foreground">
                    Ends
                  </span>
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
                <p
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  The Event must end after it starts.
                </p>
              ) : null}
            </div>
          </div>

          {/* WHERE: one row. Long venue names wrap rather than overflow. */}
          <div className="border-t border-border/60 pt-4">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Where
            </p>
            <input
              id="event-venue"
              value={venueLabel}
              onChange={(event) => setVenueLabel(event.target.value)}
              placeholder="Where is it happening?"
              aria-label="Location"
              className="mt-2 min-h-12 w-full rounded-xl bg-secondary/50 px-3.5 text-[0.9375rem] outline-none ring-1 ring-inset ring-border/40 transition placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-primary"
            />
            {/* The privacy principle stays: a venue is programme information the
              host published, a street address is closer to somebody's
              whereabouts. */}
            <p className="mt-1.5 text-xs text-muted-foreground">
              A venue name, not a street address.
            </p>
          </div>
        </div>

        {/* STAGE 4 -- REVIEW.
            Reads back exactly what was entered, including the audience, so the
            distribution decision is confirmed rather than assumed. Nothing is
            invented here: every line renders only when it has a value. */}
        {stage === "review" ? (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl ring-1 ring-border/50">
              {cover.url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={cover.url}
                  alt=""
                  className="h-36 w-full object-cover"
                  style={{
                    objectPosition: focalObjectPosition(
                      cover.focalX,
                      cover.focalY
                    ),
                  }}
                />
              ) : (
                /* Says what to DO about it, and where. "No cover yet" was a
                   status with no next step -- and publishing without one is
                   refused, so this is the last chance to fix it. */
                <div className="flex h-24 flex-col items-center justify-center gap-0.5 bg-secondary/50 text-center">
                  <span className="text-sm font-medium">No cover yet</span>
                  <span className="text-xs text-muted-foreground">
                    Add one in Basics to publish.
                  </span>
                </div>
              )}
              <div className="space-y-1 p-3.5">
                <p className="text-base font-semibold leading-snug">
                  {name.trim() || "Untitled Event"}
                </p>
                {date && startTime ? (
                  <p className="text-sm text-muted-foreground">
                    {new Date(`${date}T${startTime}`).toLocaleDateString([], {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                    {" · "}
                    {new Date(`${date}T${startTime}`).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                ) : null}
                {venueLabel.trim() ? (
                  <p className="text-sm text-muted-foreground">
                    {venueLabel.trim()}
                  </p>
                ) : null}
              </div>
            </div>

            <dl className="divide-y divide-border/40 text-sm">
              <div className="flex items-start justify-between gap-4 py-2.5">
                <dt className="text-muted-foreground">Who can find it</dt>
                <dd className="text-right font-medium">
                  <AudienceChip visibility={audience.visibility} />
                </dd>
              </div>
              {/* WHERE DISCOVERY IS ANCHORED (4K §17). A Nearby host has just
                  agreed that people around a place can find their Event, so
                  Review states WHICH place. Never coordinates, and never a
                  radius: the venue is what they chose and what attendees will
                  see. */}
              {audience.visibility === "nearby" ? (
                <div className="flex items-start justify-between gap-4 py-2.5">
                  <dt className="text-muted-foreground">Around</dt>
                  <dd className="text-right font-medium">
                    {venueLabel.trim() ||
                      (audience.location ? "The area you set" : "Not set yet")}
                  </dd>
                </div>
              ) : null}
              {audience.targetIds.length > 0 ? (
                <div className="flex items-start justify-between gap-4 py-2.5">
                  <dt className="text-muted-foreground">
                    {audience.visibility === "community"
                      ? "Community"
                      : "Invited"}
                  </dt>
                  <dd className="text-right font-medium">
                    {audience.visibility === "community"
                      ? "1 community"
                      : `${audience.targetIds.length} ${
                          audience.targetIds.length === 1 ? "person" : "people"
                        }`}
                  </dd>
                </div>
              ) : null}
              {description.trim() ? (
                <div className="py-2.5">
                  <dt className="text-muted-foreground">About</dt>
                  <dd className="mt-1 whitespace-pre-wrap leading-relaxed">
                    {description.trim()}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}
      </div>
      {/* ONE PRIMARY ACTION PER STAGE (4J §47).
          The action area never scrolls away: on a phone a CTA below the fold
          is a CTA nobody finds. Continue carries the flow forward; Publish
          exists only at Review, so it cannot be pressed before the person has
          seen what they are publishing. */}
      <div className="mt-5 space-y-3 pb-[max(0px,env(safe-area-inset-bottom))]">
        {/* PUBLISH FAILED (4L §7). The sheet stays open with everything the
            person entered, the draft is safe, and the message says what
            actually went wrong -- rate limit, storage, validation, permission.
            Navigating away as though it worked is the bug this replaces. */}
        {failure ? (
          <div role="alert" className="space-y-2 rounded-xl bg-destructive/10 p-3.5">
            <p className="text-sm font-medium text-destructive">
              We couldn&apos;t publish your Event. Your draft is safe.
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">{failure}</p>
            <div className="flex flex-wrap gap-2 pt-0.5">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  onDismissFailure?.();
                  submit(false);
                }}
                disabled={pending}
              >
                Try again
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  onDismissFailure?.();
                  handleOpenChange(false);
                }}
                disabled={pending}
                className="text-muted-foreground"
              >
                Back to draft
              </Button>
            </div>
          </div>
        ) : null}

        {stage === "review" ? (
          <Button
            type="button"
            className="h-12 w-full text-base"
            disabled={!complete || pending}
            onClick={() => submit(false)}
          >
            {pending ? (
              <>
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                Publishing…
              </>
            ) : (
              "Publish event"
            )}
          </Button>
        ) : (
          <Button
            type="button"
            className="h-12 w-full text-base"
            disabled={!canAdvance || pending}
            onClick={goNext}
          >
            Continue
          </Button>
        )}
        <div className="flex items-center justify-center gap-4 text-sm">
          {stageIndex > 0 ? (
            <button
              type="button"
              onClick={goBack}
              disabled={pending}
              className="focus-ring rounded px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Back
            </button>
          ) : null}
          {/* Save draft stays available from any stage once there is enough to
              save -- an unfinished Event is exactly what a draft is for. */}
          {/* SAVING A DRAFT NEEDS ONLY A NAME.
            *
            * This was disabled until the Event was `complete` -- the same bar
            * publishing has to clear. A draft exists precisely for the
            * unfinished state, so requiring completeness made the control a
            * contradiction: the only Events you could save as drafts were ones
            * you could already publish.
            *
            * A name is the one thing needed, because it is how the draft is
            * identified in Hosting. Everything else can be filled in later,
            * which is the entire point of Continue. */}
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={name.trim().length < 2 || !date || !startTime || !endTime || pending}
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
