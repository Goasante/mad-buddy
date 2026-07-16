"use client";

import { Bookmark, CalendarPlus, MapPin, Share2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/auth/form-field";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PreviewNotice } from "@/components/ui/preview-notice";
import { Textarea } from "@/components/ui/textarea";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

type EventTab = "for-you" | "circles" | "nearby" | "saved";
type Rsvp = "going" | "maybe" | "none";

type EventItem = {
  id: string;
  title: string;
  dateLabel: string;
  location: string;
  description: string;
  audience: string;
  hostName: string;
  goingCount: number;
  attendees: string[];
  saved: boolean;
  myRsvp: Rsvp;
  tab: EventTab;
};

const seedEvents: EventItem[] = [
  {
    id: "evt-1",
    title: "Independence Weekend Jam",
    dateLabel: "Sat, 8 Mar · 6:00 PM",
    location: "Abelemkpe, Accra",
    description: "Live performances, food, games, and good vibes to celebrate our independence.",
    audience: "Your circle",
    hostName: "Yaw Boateng",
    goingCount: 12,
    attendees: ["Ama", "Kojo", "Sena", "Kweku"],
    saved: false,
    myRsvp: "none",
    tab: "for-you"
  },
  {
    id: "evt-2",
    title: "Art & Chill",
    dateLabel: "Sun, 9 Mar · 3:00 PM",
    location: "Labadi Beach",
    description: "Casual afternoon of art, music, and chilling by the beach.",
    audience: "Friends of friends",
    hostName: "Efua Yeboah",
    goingCount: 8,
    attendees: ["Ama", "Nana"],
    saved: true,
    myRsvp: "going",
    tab: "for-you"
  },
  {
    id: "evt-3",
    title: "Tech Talk: AI in Africa",
    dateLabel: "Tue, 11 Mar · 6:30 PM",
    location: "Impact Hub, Accra",
    description: "A community talk exploring AI's impact and opportunity in Africa.",
    audience: "Your circle",
    hostName: "Legon Entrepreneurs",
    goingCount: 25,
    attendees: ["Kofi", "Sena"],
    saved: false,
    myRsvp: "none",
    tab: "circles"
  },
  {
    id: "evt-4",
    title: "Sunday Brunch",
    dateLabel: "Sun, 16 Mar · 11:00 AM",
    location: "East Legon",
    description: "Relaxed Sunday brunch with the crew.",
    audience: "Close Friends",
    hostName: "Nana",
    goingCount: 7,
    attendees: ["Ama", "Kojo"],
    saved: false,
    myRsvp: "maybe",
    tab: "nearby"
  }
];

const eventTabs: Array<{ id: EventTab; label: string }> = [
  { id: "for-you", label: "For You" },
  { id: "circles", label: "Your Circles" },
  { id: "nearby", label: "Nearby" },
  { id: "saved", label: "Saved" }
];

export function EventsPageContent() {
  const [events, setEvents] = useState<EventItem[]>(seedEvents);
  const [activeTab, setActiveTab] = useState<EventTab>("for-you");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  const visibleEvents = useMemo(
    () => (activeTab === "saved" ? events.filter((event) => event.saved) : events.filter((event) => event.tab === activeTab)),
    [events, activeTab]
  );
  const selectedEvent = events.find((event) => event.id === selectedId) ?? null;

  function updateRsvp(id: string, rsvp: Rsvp) {
    setEvents((current) => current.map((event) => (event.id === id ? { ...event, myRsvp: rsvp } : event)));
  }

  function toggleSaved(id: string) {
    setEvents((current) => current.map((event) => (event.id === id ? { ...event, saved: !event.saved } : event)));
  }

  function createEvent(input: { title: string; dateLabel: string; location: string; description: string }) {
    const newEvent: EventItem = {
      id: `evt-${Date.now()}`,
      title: input.title,
      dateLabel: input.dateLabel,
      location: input.location,
      description: input.description,
      audience: "Your circle",
      hostName: "You",
      goingCount: 1,
      attendees: [],
      saved: false,
      myRsvp: "going",
      tab: "for-you"
    };
    setEvents((current) => [newEvent, ...current]);
    setActiveTab("for-you");
    setCreateOpen(false);
    setFeedback(`${input.title} created.`);
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 pt-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Events</h1>
          <p className="mt-2 text-sm text-muted-foreground">Discover events from your community and circles.</p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <CalendarPlus className="h-4 w-4" aria-hidden="true" />
          Create Event
        </Button>
      </header>

      <PreviewNotice />

      {feedback ? (
        <p className="text-sm text-muted-foreground" role="status">{feedback}</p>
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
                activeTab === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
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
            <EventCard key={event.id} event={event} onView={() => setSelectedId(event.id)} onToggleSaved={() => toggleSaved(event.id)} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={CalendarPlus}
          className="!min-h-0 !shadow-none p-5"
          title={activeTab === "saved" ? "No saved events" : "No events here yet"}
          description={activeTab === "saved" ? "Bookmark events to find them here later." : "Check back soon, or create your own event."}
          action={
            activeTab !== "saved" ? (
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                Create Event
              </Button>
            ) : undefined
          }
        />
      )}

      <CreateEventModal open={createOpen} onOpenChange={setCreateOpen} onCreate={createEvent} />
      <EventDetailsModal
        event={selectedEvent}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onRsvpChange={(rsvp) => selectedEvent && updateRsvp(selectedEvent.id, rsvp)}
      />
    </div>
  );
}

function EventCard({ event, onView, onToggleSaved }: { event: EventItem; onView: () => void; onToggleSaved: () => void }) {
  const reducedMotion = useReducedMotion();
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold">{event.title}</h3>
            <Badge variant="violet">{event.audience}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{event.dateLabel}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {event.location}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleSaved}
          aria-pressed={event.saved}
          aria-label={event.saved ? "Unsave event" : "Save event"}
          className="focus-ring safe-motion shrink-0 text-muted-foreground hover:text-primary"
        >
          <Bookmark className={cn("h-5 w-5", event.saved && "fill-primary text-primary")} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex -space-x-2">
          {event.attendees.slice(0, 4).map((name) => (
            <GlowAvatar key={name} name={name} size="sm" className="ring-2 ring-card"  reducedMotion={reducedMotion} />
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{event.goingCount} going</span>
      </div>
      <Button type="button" variant="outline" className="mt-4 w-full" onClick={onView}>
        View
      </Button>
    </Card>
  );
}

function CreateEventModal({
  open,
  onOpenChange,
  onCreate
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { title: string; dateLabel: string; location: string; description: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  function resetFields() {
    setTitle("");
    setDate("");
    setTime("");
    setLocation("");
    setDescription("");
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) resetFields();
  }

  return (
    <Modal open={open} onOpenChange={handleOpenChange} title="Create Event" description="Discoverable by your circles.">
      <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
        <FormField htmlFor="event-title" label="Event name">
          <Input id="event-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Sunday Brunch" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor="event-date" label="Date">
            <Input id="event-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </FormField>
          <FormField htmlFor="event-time" label="Time">
            <Input id="event-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </FormField>
        </div>
        <FormField htmlFor="event-location" label="Location">
          <Input id="event-location" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="e.g. East Legon" />
        </FormField>
        <FormField htmlFor="event-description" label="Description">
          <Textarea id="event-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What's this event about?" />
        </FormField>
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={title.trim().length < 2}
          onClick={() => {
            onCreate({
              title: title.trim(),
              dateLabel: date && time ? `${date} · ${time}` : "Date TBD",
              location: location.trim() || "Location TBD",
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
  onOpenChange,
  onRsvpChange
}: {
  event: EventItem | null;
  onOpenChange: (open: boolean) => void;
  onRsvpChange: (rsvp: Rsvp) => void;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <Modal open={Boolean(event)} onOpenChange={onOpenChange} title={event?.title ?? "Event"} description={event?.dateLabel}>
      {event ? (
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            {event.location}
          </p>
          <p className="text-sm leading-6">{event.description}</p>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Going ({event.goingCount})
            </p>
            <div className="flex flex-wrap gap-2">
              {event.attendees.map((name) => (
                <div key={name} className="flex items-center gap-2 rounded-full border border-border/70 bg-background/60 py-1 pl-1 pr-3">
                  <GlowAvatar name={name} size="sm"  reducedMotion={reducedMotion} />
                  <span className="text-xs font-medium">{name}</span>
                </div>
              ))}
              {event.attendees.length === 0 ? <p className="text-xs text-muted-foreground">Be the first to go.</p> : null}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Hosted by {event.hostName} · {event.audience}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
            <Button type="button" variant={event.myRsvp === "going" ? "primary" : "outline"} onClick={() => onRsvpChange("going")}>
              Going
            </Button>
            <Button type="button" variant={event.myRsvp === "maybe" ? "primary" : "outline"} onClick={() => onRsvpChange("maybe")}>
              Maybe
            </Button>
            <Button type="button" variant="outline">
              <Share2 className="h-4 w-4" aria-hidden="true" />
              Share
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
