import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/api";
import { AudienceSelector, type AudienceValue } from "@/components/events/audience-selector";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";

type Event = {
  id: string;
  name: string;
  description: string | null;
  venueLabel: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  hostName: string;
  hostPlan: SubscriptionPlan;
  isHost: boolean;
  myCheckInId: string | null;
  /** null covers both never-answered and the host, who needs none. */
  myRsvp: "interested" | "going" | "not_going" | null;
};

type EventTab = "upcoming" | "live" | "going" | "mine";
const eventTabs: { id: EventTab; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "live", label: "Happening now" },
  // Answering yes has to lead somewhere on mobile too, or a committed Event is
  // findable only by scrolling the same discovery feed it was found in.
  { id: "going", label: "Going" },
  { id: "mine", label: "Hosting" }
];

export function EventsScreen() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<EventTab>("upcoming");
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await api.get<{ events: Event[] }>("/api/events");
    setLoading(false);
    if (result.ok) setEvents(result.data.events);
    else setFeedback(result.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * RSVP through the canonical server authority.
   *
   * No optimistic paint: visibility, blocks, host-cannot-RSVP and cancelled or
   * past Events are all decided server-side, so a refusal must never be shown
   * as success. The list reloads from what the server actually stored.
   */
  async function setRsvp(event: Event, status: "interested" | "going" | "not_going") {
    const result = await api.post<{ ok: boolean; message: string }>(
      `/api/events/${event.id}/rsvp`,
      { status }
    );
    if (!result.ok) {
      setFeedback(result.error);
      return;
    }
    setFeedback(result.data.message);
    if (result.data.ok) void load();
  }

  async function checkIn(event: Event) {
    const result = await api.post<{ ok: boolean; message: string }>(`/api/events/${event.id}/checkin`);
    setFeedback(result.ok ? result.data.message : result.error);
    if (result.ok) void load();
  }

  async function checkOut(event: Event) {
    if (!event.myCheckInId) return;
    const result = await api.del<{ ok: boolean; message: string }>(`/api/events/${event.id}/checkin`, {
      checkInId: event.myCheckInId
    });
    setFeedback(result.ok ? result.data.message : result.error);
    if (result.ok) void load();
  }

  const filteredEvents = events.filter((event) =>
    tab === "mine"
      ? event.isHost
      : tab === "going"
        ? // Interested belongs here too: a softer commitment, not a different
          // subject. Declining is an answer, not a plan, so it is excluded.
          !event.isHost && (event.myRsvp === "going" || event.myRsvp === "interested")
        : tab === "live"
          ? event.status === "active"
          : event.status === "scheduled"
  );

  return (
    <Screen
      title="Events"
      action={
        <Button size="sm" onClick={() => setCreating((value) => !value)}>
          <CalendarPlus className="h-4 w-4" aria-hidden="true" />
          New
        </Button>
      }
    >
      {creating ? (
        <CreateEvent
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      ) : null}

      <nav className="mb-4 overflow-x-auto border-b border-border/70" aria-label="Events tabs">
        <div className="flex min-w-max gap-1">
          {eventTabs.map((eventTab) => (
            <button
              key={eventTab.id}
              type="button"
              onClick={() => setTab(eventTab.id)}
              className={cn(
                "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium",
                tab === eventTab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
              )}
            >
              {eventTab.label}
            </button>
          ))}
        </div>
      </nav>

      {feedback ? <p className="mb-3 text-sm text-primary">{feedback}</p> : null}

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : filteredEvents.length === 0 ? (
        <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
          {tab === "mine"
            ? "You're not hosting any events."
            : tab === "going"
              ? "You haven't said yes to anything yet."
              : tab === "live"
                ? "Nothing happening right now."
                : "No upcoming events. Create one with “New”."}
        </p>
      ) : (
        <ul className="space-y-3">
          {filteredEvents.map((event) => (
            <li key={event.id} className="glass-panel rounded-2xl p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-base font-semibold">{event.name}</p>
                {event.status === "active" ? (
                  <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                    Live
                  </span>
                ) : null}
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span className="truncate">{new Date(event.startsAt).toLocaleString()} · {event.hostName}</span>
                <PremiumPlanBadge plan={event.hostPlan} compact />
              </div>
              {event.venueLabel ? (
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {event.venueLabel}
                </p>
              ) : null}
              {event.description ? <p className="mt-2 text-sm text-muted-foreground">{event.description}</p> : null}

              {/* RSVP first, check-in second. Going is a decision made in
                  advance; checking in is a claim about being somewhere now, so
                  they are separate controls rather than one escalating button.
                  Selected state is carried by variant AND by aria-pressed, so
                  it is not conveyed by colour alone. */}
              {!event.isHost ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(
                    [
                      { status: "interested", label: "Interested" },
                      { status: "going", label: "Going" },
                      { status: "not_going", label: "Can't go" }
                    ] as const
                  ).map((choice) => (
                    <Button
                      key={choice.status}
                      size="sm"
                      variant={event.myRsvp === choice.status ? "primary" : "outline"}
                      aria-pressed={event.myRsvp === choice.status}
                      onClick={() => void setRsvp(event, choice.status)}
                    >
                      {choice.label}
                    </Button>
                  ))}
                </div>
              ) : null}

              {!event.isHost ? (
                event.myCheckInId ? (
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => void checkOut(event)}>
                    Checked in · Check out
                  </Button>
                ) : (
                  <Button size="sm" className="mt-3" onClick={() => void checkIn(event)}>
                    Check in
                  </Button>
                )
              ) : (
                <p className="mt-3 text-xs font-medium text-primary">You're hosting</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

function CreateEvent({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [venue, setVenue] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /* MOBILE ASKS THE SAME QUESTION AS WEB.
   *
   * Creation here previously sent no audience at all, so every mobile Event
   * silently became the legacy default -- the one decision that governs who can
   * find it was made for the creator and never shown. The selector is the SAME
   * component the web form uses, so the two surfaces cannot drift into
   * different audience semantics. */
  const [audience, setAudience] = useState<AudienceValue>({
    visibility: "public",
    targetIds: [],
    location: null
  });

  async function create() {
    if (name.trim().length < 2) return setError("Give your event a name.");
    if (!starts || !ends) return setError("Set a start and end time.");
    setBusy(true);
    setError("");
    const result = await api.post<{ ok: boolean; message: string }>("/api/events", {
      name: name.trim(),
      description: description.trim() || undefined,
      venueLabel: venue.trim() || undefined,
      startsAt: new Date(starts).toISOString(),
      endsAt: new Date(ends).toISOString(),
      // The server re-validates that the audience points at something real,
      // so a client that skips the picker still cannot publish a private
      // Event with nobody invited.
      visibility: audience.visibility,
      audienceTargetIds: audience.targetIds,
      location: audience.location ?? undefined
    });
    setBusy(false);
    if (result.ok) onCreated();
    else setError(result.error);
  }

  return (
    <section className="glass-panel mb-4 space-y-3 rounded-2xl p-4">
      <Input placeholder="Event name" value={name} onChange={(e) => setName(e.target.value)} />
      <Textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <Input placeholder="Venue (optional)" value={venue} onChange={(e) => setVenue(e.target.value)} />
      <div className="space-y-1.5">
        <label htmlFor="starts" className="text-xs font-medium text-muted-foreground">Starts</label>
        <Input id="starts" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="ends" className="text-xs font-medium text-muted-foreground">Ends</label>
        <Input id="ends" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
      </div>
      <AudienceSelector value={audience} onChange={setAudience} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button className="w-full" onClick={create} disabled={busy}>
        {busy ? "Creating…" : "Create event"}
      </Button>
    </section>
  );
}
