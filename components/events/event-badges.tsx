"use client";

import { Globe, Link2, Lock, MapPin, Users2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Status and audience vocabulary for Events.
 *
 * Two rules hold everywhere in here:
 *
 * 1. NO STATE IS CARRIED BY COLOUR ALONE. "LIVE" is orange, but it is also the
 *    word LIVE and a pulsing dot; the audience chips are icon plus label. A
 *    viewer who cannot separate orange from grey still reads every state.
 * 2. ORANGE IS RATIONED. It marks live, important and the single primary
 *    action -- not every clickable thing. Everything else stays in ink.
 */

/** LIVE NOW. The loudest thing on the surface, and the rarest. */
export function LiveBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-primary font-semibold uppercase tracking-wide text-primary-foreground shadow-sm",
        compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
      )}
    >
      {/* Pulse is decorative reinforcement; the word carries the meaning.
          motion-reduce halts it for anyone who asked for stillness. */}
      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-foreground/70 motion-reduce:animate-none" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary-foreground" />
      </span>
      Live{compact ? "" : " now"}
    </span>
  );
}

/** A restrained uppercase label: TODAY, UPCOMING, DRAFTS, NEAR YOU. */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2
      className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground",
        className
      )}
    >
      {children}
    </h2>
  );
}

const AUDIENCE: Record<string, { label: string; icon: typeof Globe; hint: string }> = {
  invite: { label: "Invite only", icon: Lock, hint: "Only invited Muddies can see this" },
  link: { label: "Unlisted", icon: Link2, hint: "Only people with the link can see this" },
  community: { label: "Community", icon: Users2, hint: "Visible to a community you chose" },
  nearby: { label: "Nearby", icon: MapPin, hint: "Visible to people near the location you set" },
  public: { label: "Public", icon: Globe, hint: "Anyone on Mad Buddy can discover this" }
};

/**
 * What the HOST chose. Shown on Hosting rows and the host's own detail view --
 * it answers "who can find this?", which is a question only the host asks.
 */
export function AudienceChip({ visibility, className }: { visibility: string; className?: string }) {
  const entry = AUDIENCE[visibility];
  if (!entry) return null;
  const Icon = entry.icon;
  return (
    <span
      title={entry.hint}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground",
        className
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {entry.label}
    </span>
  );
}

export function audienceHint(visibility: string): string | null {
  return AUDIENCE[visibility]?.hint ?? null;
}

/**
 * Social proof: "1.2K going".
 *
 * Returns null below a floor rather than printing "0 going". A brand-new Event
 * showing a zero reads as a failed Event; showing nothing reads as new. The
 * floor also blunts the inference "I am the only person who said yes", which a
 * literal count on a tiny private Event would otherwise broadcast.
 */
export function formatAttendance(count: number): string | null {
  if (count < 3) return null;
  if (count < 1000) return `${count} going`;
  const thousands = count / 1000;
  return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, "")}K going`;
}
