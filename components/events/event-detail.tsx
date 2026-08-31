"use client";

import { useState } from "react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { ArrowRight, Check, ChevronRight, Loader2, LogOut, MapPin, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventCoverField, type EventCoverValue } from "@/components/events/event-cover-field";
import { EventArtwork } from "@/components/events/event-artwork";
import { EventShare } from "@/components/events/event-share";
import { AudienceChip, LiveBadge, SectionLabel, audienceHint, formatAttendance } from "@/components/events/event-badges";
import { describeEvent } from "@/lib/events/presentation";
import type { EventView } from "@/lib/events/mobile";
import type { EventGlowMuddyList } from "@/lib/events/types";
import type { EventUpdateView } from "@/lib/events/updates";
import type { RoomView } from "@/lib/events/rooms";
import { EventRoomsSection } from "@/components/events/event-rooms";
import type { EventRsvpStatus } from "@/lib/supabase/database.types";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import { cn } from "@/lib/utils";

/**
 * Event detail -- reference panels 7A, 7B, 7C, 7D.
 *
 * This file holds the hierarchy the redesign is really about, so the ordering
 * below is load-bearing rather than incidental:
 *
 *   hero -> latest important Update -> your people here -> meet people here
 *   -> your attendance -> your presence -> check out -> event info
 *
 * PRESENCE OUTRANKS INTENT. Once someone is checked in, "am I going" is
 * settled, so the three RSVP buttons collapse to a state with a Change
 * affordance, and what is actually live -- who is here, whether to meet
 * anyone -- moves above it.
 *
 * THREE SEPARATE PERMISSIONS, three separate controls, never merged:
 *   check-in      -- I am here
 *   Event Glow    -- my existing Muddies may see I am here
 *   Event Linkr   -- strangers at this Event may discover my profile
 * Each is asked for on its own terms. Granting one grants nothing else.
 */

export type EventLinkrState = {
  eligible: boolean;
  reason: string;
  /** Stored opt-in. Separate from `eligible`, which is derived live. */
  consented: boolean;
  poolLabel: string | null;
};

/** The one Update worth interrupting the hero for. */
function ImportantUpdate({ update, onOpenUpdates }: { update: EventUpdateView; onOpenUpdates: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpenUpdates}
      className="w-full rounded-xl border-l-2 border-primary bg-primary/5 p-3.5 text-left transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">Important update</p>
          <p className="line-clamp-3 text-sm leading-relaxed text-foreground">{update.body}</p>
        </div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      </div>
    </button>
  );
}

/**
 * "Your people here" -- reference §36.
 *
 * Existing Muddies who are checked in AND glowing. Never a count-only database
 * label like "MUDDIES HERE (0)": with nobody present it says so in words, and
 * an empty roster is not a failure state worth a red box.
 *
 * This list is fed by getEventGlowAction, which is Glow-gated server-side. A
 * Muddy who is here but has Glow off does not appear -- that is the whole point
 * of Glow being a separate permission.
 */
function YourPeopleHere({ glowList }: { glowList: EventGlowMuddyList | null }) {
  const muddies = glowList?.muddies ?? [];
  const shown = muddies.slice(0, 5);
  const overflow = muddies.length - shown.length;

  return (
    <section className="space-y-2" aria-labelledby="event-people-here">
      <SectionLabel>
        <span id="event-people-here">Your people here</span>
      </SectionLabel>
      {muddies.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None of your Muddies are showing they are here yet.
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex items-center">
            {shown.map((muddy, index) => (
              <div
                key={muddy.userId}
                // Overlap reads as a group rather than a queue. The ring is the
                // surface colour so avatars separate on any background.
                className={cn("rounded-full ring-2 ring-background", index > 0 && "-ml-2.5")}
              >
                {/* This plain avatar carries no proximity signal. Presence here
                    means "checked in", never "3 metres". */}
                <UserAvatar
                  name={muddy.displayName}
                  src={muddy.avatarUrl}
                  size="sm"
                  decorative
                  className="border-2 border-background shadow-[inset_0_0_0_1px_hsl(var(--border)),0_8px_24px_hsl(var(--shadow)/0.16)]"
                />
              </div>
            ))}
            {overflow > 0 ? (
              <span className="-ml-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground ring-2 ring-background">
                +{overflow}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {muddies.length === 1 ? "1 Muddy is here" : `${muddies.length} Muddies are here`}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * "Meet people here" -- reference §37, panels 10A/10B.
 *
 * TWO STATES THAT NEVER MIX. Before consent this is an invitation with the
 * reasons attached; after consent it is a door plus a way out. Showing "Open
 * Linkr" to someone who has not opted in would imply they are already
 * discoverable, which is exactly backwards.
 *
 * The caller decides whether to render this at all -- see the check-in gate in
 * EventDetail. This component never renders itself into existence.
 */
function MeetPeopleCard({
  consented,
  poolLabel,
  onOpenConsent,
  onOpenLinkr,
  onTurnOff,
  pending
}: {
  consented: boolean;
  poolLabel?: string | null;
  onOpenConsent: () => void;
  onOpenLinkr: () => void;
  onTurnOff: () => void;
  pending: boolean;
}) {
  return (
    <section className="space-y-2.5 rounded-xl bg-secondary/40 p-4" aria-labelledby="event-meet-people">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 id="event-meet-people" className="text-sm font-semibold">
          Meet people here
        </h3>
      </div>

      {consented ? (
        <>
          <p className="text-sm text-muted-foreground">
            You are open to connecting with people at this event.
          </p>
          {poolLabel ? <p className="text-xs text-muted-foreground">{poolLabel}</p> : null}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" onClick={onOpenLinkr} disabled={pending}>
              Open Linkr
            </Button>
            {/* Tertiary, not destructive: turning discovery off is a normal,
                reversible choice and should not look like a warning. */}
            <Button
              size="sm"
              variant="ghost"
              onClick={onTurnOff}
              disabled={pending}
              className="text-muted-foreground"
            >
              Turn off event discovery
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Discover people at this event who are also open to connecting.
          </p>
          <Button size="sm" onClick={onOpenConsent} disabled={pending} className="mt-1">
            I am open to meeting people
          </Button>
        </>
      )}
    </section>
  );
}

const RSVP_CHOICES: { status: EventRsvpStatus; label: string }[] = [
  { status: "interested", label: "Interested" },
  { status: "going", label: "Going" },
  { status: "not_going", label: "Not going" }
];

export function EventDetail({
  event,
  nowMs,
  glowList,
  updates,
  linkrState,
  canCheckIn,
  pending,
  onRsvp,
  onCheckIn,
  onCheckOut,
  onToggleGlow,
  onOpenConsent,
  onOpenLinkr,
  onTurnOffLinkr,
  onOpenUpdates,
  onManageAdmins,
  rooms,
  onJoinRoom,
  onOpenRoom,
  onSeeAllRooms,
  onCreateRoom,
  onOpenHostTools,
  draftCover = null
}: {
  event: EventView;
  nowMs: number;
  glowList: EventGlowMuddyList | null;
  updates: EventUpdateView[];
  linkrState: EventLinkrState | null;
  canCheckIn: boolean;
  pending: boolean;
  onRsvp: (status: EventRsvpStatus) => void;
  onCheckIn: (sharePresence: boolean) => void;
  onCheckOut: () => void;
  onToggleGlow: () => void;
  onOpenConsent: () => void;
  onOpenLinkr: () => void;
  onTurnOffLinkr: () => void;
  onOpenUpdates: () => void;
  onManageAdmins: () => void;
  /* EVENT ROOMS. Passed in rather than fetched here so the detail stays a
     presentational surface and the page keeps one loader for Event context. */
  rooms: RoomView[];
  onJoinRoom: (roomId: string) => void;
  onOpenRoom: (roomId: string) => void;
  onSeeAllRooms: () => void;
  onCreateRoom: () => void;
  onOpenHostTools: () => void;
  /* Draft publishing, host-only. Absent for anyone who cannot publish, which
   * keeps the cover uploader from mounting for a viewer who has no use for
   * it. */
  draftCover?: {
    value: EventCoverValue;
    onChange: (next: EventCoverValue) => void;
    onPublish: () => void;
    error: string;
  } | null;
}) {
  /* STARTS UNTICKED, ALWAYS. Local to this sheet, which unmounts when the
   * Event closes, so the answer given at one Event cannot leak into the next
   * one opened. */
  const [sharePresence, setSharePresence] = useState(false);
  const described = describeEvent(event, nowMs);
  const checkedIn = Boolean(event.myCheckInId);
  const attendance = formatAttendance(event.goingCount);
  const importantUpdate = updates.find((update) => update.priority === "high") ?? null;

  /* THE EVENT LINKR GATE.
   *
   * A live check-in row is required before this surface is even MENTIONED --
   * not before it works, before it is named. "Meet people here" appearing to
   * someone who has not arrived implies a discovery pool they are not in.
   *
   * Note the ordering: `checkedIn` is checked FIRST and independently of the
   * server's eligibility answer. Deriving the gate from linkrState alone would
   * let a stale reason imply a check-in that does not exist.
   *
   * "no_consent" means eligible-but-not-yet-asked -- exactly the person who
   * should see the invitation. Any other reason (event not live, checked out)
   * renders nothing at all. */
  const linkrOffered = checkedIn && (linkrState?.eligible === true || linkrState?.reason === "no_consent");
  /* CONSENT IS THE STORED OPT-IN, read from its own field rather than inferred
   * from eligibility. The two differ legitimately: someone who opted in and
   * then checked out is consented but no longer eligible. Collapsing them would
   * show the first-time invitation to somebody who had already agreed. */
  const linkrConsented = checkedIn && linkrState?.consented === true;

  return (
    <div className="space-y-6">
      {/* HERO. Edge-to-edge inside the sheet: negative margins pull it past the
          container padding so artwork meets the edges as the reference shows. */}
      <div className="relative -mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
        <EventArtwork
          eventId={event.id}
          coverUrl={event.coverUrl}
          focalX={event.focalX}
          focalY={event.focalY}
          alt={event.name}
          scrim="strong"
          className="aspect-[16/10] w-full"
        />
        <div className="absolute inset-x-0 bottom-0 space-y-1.5 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            {described.isLive ? <LiveBadge /> : null}
            {event.status === "draft" ? (
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                Draft
              </span>
            ) : null}
          </div>
          <h2 className="text-balance text-2xl font-bold leading-tight text-white drop-shadow-sm sm:text-3xl">
            {event.name}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-white/85">
            {event.venueLabel || event.locality ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {[event.venueLabel, event.locality].filter(Boolean).join(", ")}
              </span>
            ) : null}
            <span>{described.whenLabel}</span>
          </div>
          <p className="text-sm text-white/70">
            {[event.isHost ? "You are hosting" : `Hosted by ${event.hostName}`, attendance]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      {importantUpdate ? <ImportantUpdate update={importantUpdate} onOpenUpdates={onOpenUpdates} /> : null}

      {/* DRAFT PUBLISHING. A draft is unfinished work only its host can see, so
          finishing it is the single most important thing on this screen when
          one is open -- above attendance, which nobody can answer yet.
          publishEventAction re-reads the asset and refuses without a valid
          cover; publishError carries that refusal back here rather than
          surfacing as a generic failure. */}
      {event.isHost && event.status === "draft" && draftCover ? (
        <section className="space-y-3 rounded-xl border border-border/70 p-3.5" aria-labelledby="event-publish">
          <div className="space-y-1">
            <h3 id="event-publish" className="text-sm font-semibold">
              Finish this event
            </h3>
            <p className="text-xs text-muted-foreground">
              Only you can see it until it is published. A cover image is required.
            </p>
          </div>
          <EventCoverField
            eventId={event.id}
            value={draftCover.value}
            onChange={draftCover.onChange}
            invalid={Boolean(draftCover.error)}
            disabled={pending}
          />
          {draftCover.error ? (
            <p role="alert" className="text-sm text-destructive">
              {draftCover.error}
            </p>
          ) : null}
          <Button className="w-full" disabled={pending} onClick={draftCover.onPublish}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Publish event
          </Button>
        </section>
      ) : null}

      {/* LIVE BLOCK. Only for someone actually here: who is present and whether
          to meet anyone are questions that only exist once you have arrived. */}
      {checkedIn ? (
        <>
          <YourPeopleHere glowList={glowList} />

          {linkrOffered ? (
            <MeetPeopleCard
              consented={linkrConsented}
              poolLabel={linkrState?.poolLabel}
              onOpenConsent={onOpenConsent}
              onOpenLinkr={onOpenLinkr}
              onTurnOff={onTurnOffLinkr}
              pending={pending}
            />
          ) : null}
        </>
      ) : null}

      {/* ATTENDANCE. Collapsed once checked in -- being here answers the
          question that the three buttons were asking.
          The tour target rides the participation controls, which is where it
          pointed on the old card: this is the block a tour means by "how you
          take part". */}
      {event.isHost ? null : checkedIn ? (
        <section
          data-tour-id={TOUR_TARGET_IDS.EVENTS_ACTIONS}
          className="space-y-2"
          aria-labelledby="event-attendance"
        >
          <SectionLabel>
            <span id="event-attendance">Your attendance</span>
          </SectionLabel>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/40 px-3.5 py-3">
            <p role="status" className="inline-flex items-center gap-2 text-sm font-medium">
              <Check className="h-4 w-4 text-primary" aria-hidden="true" />
              You are here and going
            </p>
            {/* Changing your mind requires checking out first: "not going"
                while physically checked in is a contradiction the product
                should not let someone assert by accident. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onCheckOut}
              disabled={pending}
              className="shrink-0 text-muted-foreground"
            >
              Change
            </Button>
          </div>
        </section>
      ) : (
        // Same tour target on both branches: whichever attendance control this
        // viewer actually has is the one a tour should point at.
        <section data-tour-id={TOUR_TARGET_IDS.EVENTS_ACTIONS} className="space-y-2" aria-labelledby="event-rsvp">
          <SectionLabel>
            <span id="event-rsvp">Your RSVP</span>
          </SectionLabel>
          <div role="radiogroup" aria-labelledby="event-rsvp" className="grid grid-cols-3 gap-2">
            {RSVP_CHOICES.map((choice) => {
              const selected = event.myRsvp === choice.status;
              return (
                <button
                  key={choice.status}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={pending}
                  onClick={() => onRsvp(choice.status)}
                  className={cn(
                    "min-h-[2.75rem] rounded-xl px-2 text-sm font-medium transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60",
                    selected
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* PRESENCE. Exists only with a check-in, because Glow is a property of
          being here -- there is nothing to share otherwise. */}
      {checkedIn ? (
        <section className="space-y-2" aria-labelledby="event-presence">
          <SectionLabel>
            <span id="event-presence">Your presence</span>
          </SectionLabel>
          <div className="space-y-2 rounded-xl bg-secondary/40 p-3.5">
            <div className="flex items-center justify-between gap-3">
              {/* ONE label, identical in both states. Renaming it per state
                  ("Hidden at this event" / "Visible") made the switch read as
                  two different settings. */}
              <span id="event-glow-label" className="text-sm font-medium">
                Let my Muddies see I am here
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={event.myGlowEnabled}
                aria-labelledby="event-glow-label"
                disabled={pending}
                onClick={onToggleGlow}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60",
                  event.myGlowEnabled ? "bg-primary" : "bg-muted-foreground/30"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none",
                    event.myGlowEnabled ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Only Muddies who are also checked in can see you here. Your exact location is never shown.
            </p>
          </div>
        </section>
      ) : null}

      {/* PRIMARY ACTION. Check in is the one orange fill on this screen for a
          live attendee who has not arrived yet. */}
      {!event.isHost && !checkedIn && canCheckIn ? (
        <div className="space-y-2.5">
          {/* THE PRESENCE CHOICE IS ASKED BEFORE IT IS TAKEN.
            *
            * Unticked by default and re-mounted per Event (the sheet unmounts
            * on close), so sharing presence at one Event never carries into
            * the next. checkIn() receives this value explicitly -- nothing
            * downstream may default it to true. */}
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-secondary/40 p-3">
            <input
              type="checkbox"
              checked={sharePresence}
              onChange={(changeEvent) => setSharePresence(changeEvent.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">Let my Muddies see I am here</span>
              <span className="block text-xs text-muted-foreground">
                Only Muddies who are also checked in. You can change this after you arrive.
              </span>
            </span>
          </label>
          <Button className="w-full" size="lg" disabled={pending} onClick={() => onCheckIn(sharePresence)}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Check in
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Checking in never shares your location or shows you to strangers.
          </p>
        </div>
      ) : null}

      {checkedIn ? (
        <Button
          variant="outline"
          className="w-full text-muted-foreground"
          disabled={pending}
          onClick={onCheckOut}
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Check out
        </Button>
      ) : null}

      {/* SHARE, FOR EVERYONE (4L §13, §15, §26).
          Sharing is transport, not permission: whoever opens the link still
          meets canViewEvent, so an attendee passing on an invite-only Event
          grants nobody anything. That is why it need not be host-only.

          It stays recoverable at any time -- creation was previously the only
          moment a link could be obtained, so a host who closed that sheet had
          published an unlisted Event with no way to invite anybody. A DRAFT is
          excluded: it has no shareable identity yet. */}
      {/* EVENT ROOMS -- the reference treats Rooms as a primary tab, so the
          section sits directly under the participation block, above sharing and
          the Event info table. At a live Event, joining a room is the thing
          people came to do; the venue address is reference material. */}
      <EventRoomsSection
        rooms={rooms}
        eventCoverUrl={event.coverUrl}
        eventFocalX={event.focalX ?? 0.5}
        eventFocalY={event.focalY ?? 0.5}
        canCreate={event.isHost}
        onJoin={onJoinRoom}
        onOpen={onOpenRoom}
        onSeeAll={onSeeAllRooms}
        onCreate={onCreateRoom}
        pending={pending}
      />

      <EventShare
        eventId={event.id}
        eventName={event.name}
        visibility={event.visibility}
        shareable={event.status !== "draft"}
      />

      {/* EVENT INFO. Every row is conditional: the design shows optional
          metadata the schema does not have, and an empty row is worse than an
          absent one. Nothing here is invented to fill the space. */}
      <section className="space-y-2" aria-labelledby="event-info">
        <SectionLabel>
          <span id="event-info">Event info</span>
        </SectionLabel>
        <dl className="divide-y divide-border/40 text-sm">
          {event.description ? (
            <div className="py-2.5">
              <dt className="sr-only">About</dt>
              <dd className="whitespace-pre-wrap leading-relaxed text-muted-foreground">{event.description}</dd>
            </div>
          ) : null}
          {event.venueLabel ? (
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-muted-foreground">Venue</dt>
              <dd className="text-right font-medium">{event.venueLabel}</dd>
            </div>
          ) : null}
          {event.locality ? (
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-muted-foreground">Area</dt>
              <dd className="text-right font-medium">{event.locality}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 py-2.5">
            <dt className="text-muted-foreground">Host</dt>
            <dd className="text-right font-medium">{event.hostName}</dd>
          </div>
          {/* Audience is the host's own business: another attendee has no reason
              to be told how this Event is distributed. */}
          {event.isHost ? (
            <div className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-muted-foreground">Who can find it</dt>
              <dd className="flex flex-col items-end gap-1">
                <AudienceChip visibility={event.visibility} />
                <span className="text-right text-xs text-muted-foreground">{audienceHint(event.visibility)}</span>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <div className="flex flex-col gap-1">
        {/* HOST TOOLS. The single door to everything a host operates -- QR
            check-in, Rooms, Updates, Guest list, Admins, Settings, End Event.
            Shown only to the host, whose authority the server re-checks on
            every action behind it. */}
        {event.isHost ? (
          <Button variant="ghost" onClick={onOpenHostTools} className="justify-between">
            <span>Host tools</span>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onOpenUpdates} className="justify-between">
          <span>Updates{updates.length > 0 ? ` (${updates.length})` : ""}</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        {/* Host-only. An attendee never sees a route to admin management --
            addEventAdmin is isEventOwner-gated server-side, and the UI must not
            offer a door the server will slam. */}
        {event.isHost ? (
          <Button variant="ghost" onClick={onManageAdmins} className="justify-between">
            <span>Event admins</span>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
