"use client";

import { CalendarCheck2, Eye, Ghost, ShieldCheck } from "lucide-react";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { ProximityBadge } from "@/components/glow/proximity-badge";
import { ConfidenceBadge } from "@/components/glow/confidence-badge";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { ProximityLevel } from "@/lib/proximity";
import { cn } from "@/lib/utils";

type DemoFriend = {
  name: string;
  username: string;
  proximityLevel: ProximityLevel;
  glowStrength: number;
  statusText: string;
  confidence: "high" | "medium" | "low";
};

const demoFriends: DemoFriend[] = [
  {
    name: "Amina",
    username: "amina_k",
    proximityLevel: "very_close",
    glowStrength: 88,
    statusText: "Open to plans",
    confidence: "high"
  },
  {
    name: "Kwame",
    username: "kwame_o",
    proximityLevel: "nearby",
    glowStrength: 68,
    statusText: "At the same event",
    confidence: "medium"
  },
  {
    name: "Yaa",
    username: "yaa_m",
    proximityLevel: "hidden",
    glowStrength: 0,
    statusText: "Ghost Mode on, not visible",
    confidence: "low"
  }
];

const demoPlan = {
  title: "Weekend Hangout",
  detail: "Sat, 2:00 PM",
  going: 6,
  maybe: 2
};

const demoUpForAPlan = [
  { name: "Kojo", proximityLevel: "nearby" as ProximityLevel },
  { name: "Aku", proximityLevel: "around" as ProximityLevel }
];

export function HeroDemo() {
  const reducedMotion = useReducedMotion();

  return (
    <div
      className="mx-auto mt-10 w-full max-w-lg lg:mt-0 lg:max-w-none"
      aria-label="Product preview: how Muddies appear when nearby"
    >
      <div className="relative mx-auto max-w-md lg:max-w-none">
        <div
          className="landing-demo-panel rounded-2xl border border-border/80 bg-card/90 p-4 shadow-[0_24px_60px_hsl(var(--shadow)/0.12)] backdrop-blur-sm sm:p-5"
          role="img"
          aria-labelledby="hero-demo-heading"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-4">
            <div>
              <p id="hero-demo-heading" className="text-sm font-semibold text-foreground">
                Nearby Muddies
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">No map, just glow levels</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-100">
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              Visible
            </span>
          </div>

          <ul className="mt-4 space-y-3" aria-label="Example approved friends">
            {demoFriends.map((friend) => (
              <li
                key={friend.username}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3",
                  friend.proximityLevel === "very_close" &&
                    "border-orange-400/45 bg-orange-400/10 shadow-[0_12px_32px_rgba(249,115,22,0.16)]",
                  friend.proximityLevel === "nearby" && "border-orange-400/25 bg-orange-400/[0.06]",
                  friend.proximityLevel === "hidden" && "border-border/70 bg-muted/30 opacity-90"
                )}
              >
                <GlowAvatar
                  name={friend.name}
                  proximityLevel={friend.proximityLevel}
                  glowStrength={friend.glowStrength}
                  confidence={friend.confidence}
                  size="md"
                  reducedMotion={reducedMotion}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold">{friend.name}</span>
                    <ProximityBadge proximityLevel={friend.proximityLevel} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">@{friend.username}</p>
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{friend.statusText}</p>
                  {friend.proximityLevel !== "hidden" ? (
                    <div className="mt-2">
                      <ConfidenceBadge confidence={friend.confidence} />
                    </div>
                  ) : (
                    <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Ghost className="h-3.5 w-3.5" aria-hidden="true" />
                      Paused visibility
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div
          className="landing-demo-panel mt-4 rounded-2xl border border-border/80 bg-card/90 p-4 shadow-[0_24px_60px_hsl(var(--shadow)/0.12)] backdrop-blur-sm sm:p-5"
          role="img"
          aria-labelledby="hero-demo-plan-heading"
        >
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <CalendarCheck2 className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p id="hero-demo-plan-heading" className="text-sm font-semibold text-foreground">
                {demoPlan.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {demoPlan.detail} · {demoPlan.going} going · {demoPlan.maybe} maybe
              </p>
            </div>
          </div>

          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Muddies up for a plan
          </p>
          <ul className="mt-2 space-y-2" aria-label="Muddies open to plans nearby">
            {demoUpForAPlan.map((muddy) => (
              <li
                key={muddy.name}
                className="flex items-center gap-3 rounded-lg border border-border/70 bg-background/70 px-3 py-2"
              >
                <GlowAvatar
                  name={muddy.name}
                  proximityLevel={muddy.proximityLevel}
                  glowStrength={muddy.proximityLevel === "nearby" ? 60 : 35}
                  confidence="medium"
                  size="sm"
                  reducedMotion={reducedMotion}
                />
                <span className="text-sm font-medium text-foreground">{muddy.name}</span>
                <ProximityBadge proximityLevel={muddy.proximityLevel} className="ml-auto" />
              </li>
            ))}
          </ul>
        </div>

        <aside
          className="mt-4 rounded-xl border border-border/70 bg-background/80 p-4 text-sm leading-6 text-muted-foreground sm:mt-5"
          aria-label="Proximity level guide"
        >
          <p className="font-semibold text-foreground">What the glow levels mean</p>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="font-medium text-foreground">Very close</dt>
              <dd>A strong glow when a Muddy is very near.</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Nearby</dt>
              <dd>A clear signal that someone is in the area.</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Around you</dt>
              <dd>A softer signal, still nearby, less intense.</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Not glowing</dt>
              <dd>No active proximity signal right now.</dd>
            </div>
          </dl>
          <p className="mt-3 inline-flex items-start gap-2 text-xs">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
            <span>Friends never see coordinates, maps, or exact distance.</span>
          </p>
        </aside>
      </div>
    </div>
  );
}
