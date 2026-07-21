import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/api";

type Event = {
  id: string;
  name: string;
  description: string | null;
  venueLabel: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  hostName: string;
  isHost: boolean;
  myCheckInId: string | null;
};

export function EventsScreen() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
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

      {feedback ? <p className="mb-3 text-sm text-primary">{feedback}</p> : null}

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : events.length === 0 ? (
        <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
          No upcoming events. Create one with “New”.
        </p>
      ) : (
        <ul className="space-y-3">
          {events.map((event) => (
            <li key={event.id} className="glass-panel rounded-2xl p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-base font-semibold">{event.name}</p>
                {event.status === "active" ? (
                  <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                    Live
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(event.startsAt).toLocaleString()} · {event.hostName}
              </p>
              {event.venueLabel ? (
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {event.venueLabel}
                </p>
              ) : null}
              {event.description ? <p className="mt-2 text-sm text-muted-foreground">{event.description}</p> : null}

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
      endsAt: new Date(ends).toISOString()
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
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button className="w-full" onClick={create} disabled={busy}>
        {busy ? "Creating…" : "Create event"}
      </Button>
    </section>
  );
}
