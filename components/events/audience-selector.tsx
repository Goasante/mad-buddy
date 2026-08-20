"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, Globe, Link2, Lock, MapPin, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PeoplePicker, type PickerRow } from "@/components/events/people-picker";
import { AUDIENCE_EXPLANATION } from "@/lib/events/presentation";
import { cn } from "@/lib/utils";
import { getAudienceOptionsAction } from "@/app/(app)/event-actions";
import type { CommunityOption, InviteeOption } from "@/lib/events/audience-options";

/**
 * Who should know about this Event -- reference panels 5, 6A-6E.
 *
 * The one decision that governs distribution. Phrased as a question about
 * people rather than a setting, because "visibility" is a database word and the
 * creator is thinking about who they want at their party.
 *
 * The form CHANGES with the answer: invited people asks who, community asks
 * which, nearby asks where, and link/public explain what they mean. Showing all
 * of it at once would ask for four things when only one matters.
 *
 * ONE DELIBERATE DEPARTURE FROM THE REFERENCE. Panel 6B draws a draggable
 * "visibility radius" slider (1-10km). Event geography has a single canonical
 * eligibility distance (EVENT_LOCAL_DISCOVERY_MAX_METERS, 5km) and no
 * per-Event radius exists in the schema or the rules. A slider would be a
 * control that silently does nothing, so this shows the area coverage as a
 * statement of fact instead. The visual intent -- "this Event has a local
 * catchment" -- is kept; the unsupported mechanic is not invented.
 */

export type EventAudience = "invite" | "link" | "community" | "nearby" | "public";

export type AudienceValue = {
  visibility: EventAudience;
  targetIds: string[];
  location: { latitude: number; longitude: number; locality?: string } | null;
};

const OPTIONS: Array<{ id: EventAudience; label: string; detail: string; icon: typeof Globe }> = [
  { id: "invite", label: "Invited people", detail: "Choose specific Muddies.", icon: Lock },
  {
    id: "link",
    label: "Anyone with the link",
    detail: "Unlisted. Only people with the link can access.",
    icon: Link2
  },
  { id: "community", label: "My community", detail: "Visible to members of a community you choose.", icon: Users2 },
  { id: "nearby", label: "Nearby", detail: "People around your Event location can discover it.", icon: MapPin },
  { id: "public", label: "Public", detail: "Anyone on Mad Buddy can discover this.", icon: Globe }
];

/** The centred icon-and-copy treatment for link and public (panels 6D/6E). */
function AudienceExplanation({ visibility }: { visibility: "link" | "public" }) {
  const copy = AUDIENCE_EXPLANATION[visibility];
  const Icon = visibility === "link" ? Link2 : Globe;

  /* A CONFIRMATION, NOT A MARKETING PAGE (4J §28-29).
   *
   * This was a tall centred panel -- 56px icon, heading, three ticked lines --
   * shown every single time somebody chose Public or Link. It pushed Continue
   * off the sheet and made a routine choice feel like reading terms.
   *
   * The chosen CARD above already carries the icon, the name and the one-line
   * summary. All this needs to add is the consequence, stated once. The rest
   * of the copy stays in AUDIENCE_EXPLANATION for the surfaces that want it. */
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-secondary/40 px-3.5 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="text-sm leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{copy.title}. </span>
        {copy.lines[0]}
        {copy.lines[1] ? ` ${copy.lines[1]}` : ""}
      </p>
    </div>
  );
}

export function AudienceSelector({
  value,
  onChange
}: {
  value: AudienceValue;
  onChange: (next: AudienceValue) => void;
}) {
  const [invitees, setInvitees] = useState<InviteeOption[]>([]);
  const [communities, setCommunities] = useState<CommunityOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    // Loaded once for the whole selector rather than per audience, so switching
    // between Invited and Community does not re-query.
    startTransition(async () => {
      const options = await getAudienceOptionsAction();
      setInvitees(options.invitees);
      setCommunities(options.communities);
      setLoaded(true);
    });
  }, []);

  function setVisibility(visibility: EventAudience) {
    // Targets belong to the audience that asked for them. Carrying an invite
    // list into a Public Event would attach people to something they were never
    // asked about.
    onChange({ visibility, targetIds: [], location: value.location });
  }

  function toggleTarget(id: string, single = false) {
    const selected = new Set(value.targetIds);
    if (single) {
      onChange({ ...value, targetIds: selected.has(id) ? [] : [id] });
      return;
    }
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    onChange({ ...value, targetIds: [...selected] });
  }

  function useCurrentArea() {
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError("Your browser cannot share a location. Add a venue name instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        /* This sets where the EVENT is, not where the creator is. It is
           published programme information, and it is not tracked afterwards. */
        onChange({
          ...value,
          location: { latitude: position.coords.latitude, longitude: position.coords.longitude }
        });
      },
      () => {
        setLocating(false);
        setLocationError("Could not get that area. Add a venue name instead.");
      }
    );
  }

  const inviteeRows = useMemo<PickerRow[]>(
    () => invitees.map((person) => ({ id: person.userId, name: person.name, avatarUrl: person.avatarUrl })),
    [invitees]
  );

  const communityRows = useMemo<PickerRow[]>(
    () =>
      communities.map((community) => ({
        id: community.conversationId,
        name: community.name,
        secondary: `${community.memberCount} member${community.memberCount === 1 ? "" : "s"}`
      })),
    [communities]
  );

  return (
    <fieldset className="space-y-4">
      <div className="space-y-1">
        <legend className="text-lg font-semibold leading-snug">Who should know about this event?</legend>
        <p className="text-sm text-muted-foreground">You can change this anytime before publishing.</p>
      </div>

      <div role="radiogroup" aria-label="Event audience" className="space-y-2">
        {OPTIONS.map((option) => {
          const active = value.visibility === option.id;
          const Icon = option.icon;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setVisibility(option.id)}
              className={cn(
                // py-2.5 and a smaller icon well: five options at py-3 pushed the last
                // one below the fold on a 360px sheet, so the choice could not be
                // scanned as a set. Still a comfortable target at 56px tall.
                "flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                // The selected card earns the accent; the rest stay quiet, so
                // which one is chosen is legible at a glance rather than needing
                // a hunt for a small filled dot.
                active
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border/70 bg-card hover:border-border hover:bg-secondary/30"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition",
                  active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-snug">{option.label}</span>
                <span className="block text-xs leading-snug text-muted-foreground">{option.detail}</span>
              </span>
              {/* A tick as well as the accent: selection must not be carried by
                  colour alone. */}
              {active ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      {value.visibility === "invite" ? (
        <div className="flex max-h-[24rem] flex-col gap-2 rounded-xl border border-border/70 p-3">
          <p className="text-sm font-medium">Invited people</p>
          {!loaded ? (
            <p className="py-4 text-sm text-muted-foreground">Loading your Muddies...</p>
          ) : (
            <PeoplePicker
              rows={inviteeRows}
              selectedIds={value.targetIds}
              onToggle={(id) => toggleTarget(id)}
              onConfirm={() => undefined}
              searchPlaceholder="Search your Muddies"
              confirmLabel={(count) => `${count} selected`}
              emptyMessage="You do not have any Muddies to invite yet."
            />
          )}
        </div>
      ) : null}

      {value.visibility === "community" ? (
        <div className="flex max-h-[24rem] flex-col gap-2 rounded-xl border border-border/70 p-3">
          <p className="text-sm font-medium">My community</p>
          {!loaded ? (
            <p className="py-4 text-sm text-muted-foreground">Loading your communities...</p>
          ) : (
            <PeoplePicker
              rows={communityRows}
              selectedIds={value.targetIds}
              onToggle={(id) => toggleTarget(id, true)}
              onConfirm={() => undefined}
              searchPlaceholder="Choose community"
              confirmLabel={(count) => (count === 1 ? "Community selected" : "Choose a community")}
              emptyMessage="You are not in a community to share this with yet. Choose another audience."
              single
              useAvatars={false}
            />
          )}
        </div>
      ) : null}

      {value.visibility === "nearby" ? (
        <div className="space-y-3 rounded-xl border border-border/70 p-3.5">
          <div className="space-y-1">
            <p className="text-sm font-medium">Event location</p>
            {/* TWO SIDES OF ONE SYSTEM, SAID PLAINLY (4K §15).
                Creating a Nearby Event anchors discovery to the VENUE the host
                publishes. Browsing "Near you" compares a viewer's own private
                position against that published venue. The host is not being
                asked to share where they are -- they are describing where the
                Event is, which is programme information. */}
            <p className="text-xs leading-relaxed text-muted-foreground">
              This uses the venue you set for the Event &mdash; not your personal location. People around
              that venue can discover it.
            </p>
          </div>

          {/* AREA SURFACE, NOT A MAP. No map provider is wired, and a fake map
              would misrepresent precision we do not have. This shows coverage
              as a soft field with the venue pinned at its centre. */}
          <div
            aria-hidden="true"
            className="relative h-28 overflow-hidden rounded-lg bg-gradient-to-br from-primary/15 via-secondary/40 to-secondary/10"
          >
            <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/30 bg-primary/10" />
            <div className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/50 bg-primary/20" />
            <span className="absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
              <MapPin className="h-3.5 w-3.5" />
            </span>
          </div>

          <Button type="button" size="sm" variant="outline" disabled={locating} onClick={useCurrentArea}>
            <MapPin className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {locating ? "Finding area..." : value.location ? "Change area" : "Use this area"}
          </Button>

          {value.location ? (
            <p role="status" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Area set for this event.
            </p>
          ) : null}
          {locationError ? (
            <p role="alert" className="text-xs text-destructive">
              {locationError}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Your exact coordinates are never shown to anyone; people see the venue you named.
          </p>
        </div>
      ) : null}

      {value.visibility === "link" ? <AudienceExplanation visibility="link" /> : null}
      {value.visibility === "public" ? <AudienceExplanation visibility="public" /> : null}
    </fieldset>
  );
}
