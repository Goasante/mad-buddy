"use client";

import { useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { ProximityBadge } from "@/components/glow/proximity-badge";
import { cn } from "@/lib/utils";
import type { ProximityLevel } from "@/lib/proximity";

type Audience = "Approved Muddies" | "Close Friends" | "Circles";
type Duration = "30m" | "1h" | "3h" | "until_hide";

const vibeOptions = ["Grab a drink / Chill", "Study session", "Sports", "Just chatting", "Food run"];
const audienceOptions: Audience[] = ["Approved Muddies", "Close Friends", "Circles"];
const durationOptions: Array<{ id: Duration; label: string }> = [
  { id: "30m", label: "30 mins" },
  { id: "1h", label: "1 hour" },
  { id: "3h", label: "3 hours" },
  { id: "until_hide", label: "Until I hide" }
];

const peopleAround: Array<{ name: string; proximityLevel: ProximityLevel }> = [
  { name: "Ama Serwaa", proximityLevel: "very_close" },
  { name: "Kojo Mensah", proximityLevel: "nearby" },
  { name: "Sena Quayson", proximityLevel: "around" },
  { name: "Kweku Boateng", proximityLevel: "nearby" }
];

export function HangoutModePage() {
  const [active, setActive] = useState(false);
  const [vibe, setVibe] = useState(vibeOptions[0]);
  const [audience, setAudience] = useState<Audience>("Approved Muddies");
  const [duration, setDuration] = useState<Duration>("1h");

  return (
    <div className="mx-auto max-w-[720px] space-y-6 pt-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Hangout Mode</h1>
          <p className="mt-2 text-sm text-muted-foreground">Let people know you&apos;re down to hang out right now.</p>
        </div>
        <label className="inline-flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">{active ? "Active now" : "Off"}</span>
          <button
            type="button"
            role="switch"
            aria-checked={active}
            onClick={() => setActive((current) => !current)}
            className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", active ? "bg-primary" : "bg-muted")}
          >
            <span className={cn("absolute top-1 h-4 w-4 rounded-full bg-white transition-transform", active ? "translate-x-6" : "translate-x-1")} />
          </button>
        </label>
      </div>

      <div className="relative mx-auto grid h-72 w-72 max-w-full place-items-center overflow-hidden">
        <div
          className={cn(
            "relative isolate grid h-40 w-40 place-items-center rounded-full text-4xl transition-all",
            active ? "proximity-halo proximity-halo-very-close proximity-halo-animate bg-primary/10" : "border border-dashed border-border text-muted-foreground"
          )}
          style={active ? ({ "--halo-active-opacity": 0.9, "--halo-rest-opacity": 0.5 } as CSSProperties) : undefined}
        >
          😎
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-border/70 bg-card/50 p-4">
        <div>
          <p className="mb-1.5 text-sm font-medium">What are you up to?</p>
          <select
            value={vibe}
            onChange={(event) => setVibe(event.target.value)}
            className="focus-ring safe-motion h-11 w-full rounded-md border border-border bg-card/70 px-3 text-sm"
          >
            {vibeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium">Who can see this?</p>
          <div className="flex flex-wrap gap-2">
            {audienceOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setAudience(option)}
                className={cn(
                  "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
                  audience === option ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium">For how long?</p>
          <div className="flex flex-wrap gap-2">
            {durationOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setDuration(option.id)}
                className={cn(
                  "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
                  duration === option.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <Button type="button" variant={active ? "danger" : "primary"} className="w-full" onClick={() => setActive((current) => !current)}>
          {active ? "End Hangout Mode" : "Turn on Hangout Mode"}
        </Button>
      </div>

      <div>
        <p className="mb-3 text-sm font-semibold">People who can see you ({peopleAround.length})</p>
        <div className="space-y-2">
          {peopleAround.map((person) => (
            <div key={person.name} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-3">
              <GlowAvatar name={person.name} proximityLevel={person.proximityLevel} glowStrength={70} confidence="medium" size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{person.name}</span>
              <ProximityBadge proximityLevel={person.proximityLevel} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
