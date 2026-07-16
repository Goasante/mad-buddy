"use client";

import { CalendarCheck2, Hand, PartyPopper, Search, Users2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type DiscoverTab = "people" | "circles" | "plans" | "events";

const discoverTabs: Array<{ id: DiscoverTab; label: string }> = [
  { id: "people", label: "People" },
  { id: "circles", label: "Circles" },
  { id: "plans", label: "Plans" },
  { id: "events", label: "Events" }
];

const suggestedPeople = [
  { name: "Ewurama K.", status: "Very Close" },
  { name: "Richmond A.", status: "Nearby" },
  { name: "Nana Yeboah", status: "Around You" },
  { name: "Grace Ampofo", status: "New to Mad Buddy" },
  { name: "Kofi Mensah", status: "Nearby" }
];

const popularCircles = [
  { name: "Legon Friends", members: 43, active: true },
  { name: "Law School '24", members: 28, active: true },
  { name: "Accra Creators", members: 156, active: false },
  { name: "Football Heads", members: 67, active: true }
];

export function DiscoverPageContent() {
  const [tab, setTab] = useState<DiscoverTab>("people");
  const [query, setQuery] = useState("");
  const [waved, setWaved] = useState<string[]>([]);
  const [joined, setJoined] = useState<string[]>([]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 pt-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Discover</h1>
        <p className="mt-2 text-sm text-muted-foreground">Find people, circles, plans, and events that matter.</p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people, school, workplace, or city" className="pl-9" />
      </div>

      <div className="flex gap-1 border-b border-border/70">
        {discoverTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium",
              tab === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "people" ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Suggested Muddies</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {suggestedPeople
              .filter((person) => person.name.toLowerCase().includes(query.trim().toLowerCase()))
              .map((person) => (
                <div key={person.name} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-3">
                  <GlowAvatar name={person.name} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{person.name}</p>
                    <p className="text-xs text-muted-foreground">{person.status}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={waved.includes(person.name) ? "outline" : "primary"}
                    disabled={waved.includes(person.name)}
                    onClick={() => setWaved((current) => [...current, person.name])}
                  >
                    <Hand className="h-4 w-4" aria-hidden="true" />
                    {waved.includes(person.name) ? "Waved" : "Wave"}
                  </Button>
                </div>
              ))}
          </div>
        </section>
      ) : null}

      {tab === "circles" ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Popular Circles</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {popularCircles
              .filter((circle) => circle.name.toLowerCase().includes(query.trim().toLowerCase()))
              .map((circle) => (
                <div key={circle.name} className="rounded-xl border border-border/70 bg-card/50 p-4 text-center">
                  <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                    <Users2 className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <p className="mt-2 text-sm font-semibold">{circle.name}</p>
                  <p className="text-xs text-muted-foreground">{circle.members} members {circle.active ? "· Active now" : ""}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant={joined.includes(circle.name) ? "outline" : "primary"}
                    className="mt-3 w-full"
                    disabled={joined.includes(circle.name)}
                    onClick={() => setJoined((current) => [...current, circle.name])}
                  >
                    {joined.includes(circle.name) ? "Joined" : "Join"}
                  </Button>
                </div>
              ))}
          </div>
        </section>
      ) : null}

      {tab === "plans" ? (
        <EmptyState icon={CalendarCheck2} className="!shadow-none" title="No public plans to discover" description="Plans your circles create will show up here." />
      ) : null}

      {tab === "events" ? (
        <EmptyState icon={PartyPopper} className="!shadow-none" title="No events to discover here" description="Browse events from your community." />
      ) : null}
    </div>
  );
}
