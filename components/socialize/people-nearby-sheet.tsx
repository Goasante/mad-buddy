"use client";

import { useEffect, useRef } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import type { SocializePerson } from "@/lib/social/socialize-mobile";
import { SOCIALIZE_ACTIVITY_LABELS } from "@/lib/social/socialize";
import { proximityLabels } from "@/lib/proximity";
import { presenceLabel, presenceStateFor } from "@/lib/presence/freshness";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Button } from "@/components/ui/button";
import { useDismissOnBack } from "@/hooks/use-dismiss-on-back";
import { cn } from "@/lib/utils";

/**
 * People Nearby — the readable companion to the radar.
 *
 * Renders the SAME authorised list the radar is drawn from, in the order the
 * server returned it. It runs no query, holds no ranking and owns no
 * relationship model: the radar caps how many NODES it draws for legibility,
 * and this list is where the full authorised set stays reachable.
 *
 * Tapping a row hands selection back to the page, which opens the existing
 * selected-person card — there is deliberately no second profile sheet here.
 */

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function PeopleNearbySheet({
  open,
  people,
  nowMs,
  loading = false,
  error = false,
  offline = false,
  pending = false,
  onClose,
  onSelect,
  onWave,
  onRetry
}: {
  open: boolean;
  /** The canonical authorised list, already ordered by the server. */
  people: SocializePerson[];
  /** The page's clock, shared so radar and list hedge identically. */
  nowMs: number;
  loading?: boolean;
  error?: boolean;
  /** No connectivity. Server actions are disabled rather than silently failing. */
  offline?: boolean;
  pending?: boolean;
  onClose: () => void;
  onSelect: (person: SocializePerson) => void;
  onWave: (person: SocializePerson) => void;
  onRetry: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // Where focus came from, so closing returns it to the entry point.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Hardware/browser Back closes the sheet rather than leaving Socialize.
  useDismissOnBack(open, onClose);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="people-nearby-title">
      {/* The radar stays visible above the panel. */}
      <button
        type="button"
        aria-label="Close"
        className="socialize-card-backdrop absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      <div
        className={cn(
          "socialize-card absolute bottom-0 left-1/2 flex w-full max-w-[440px] -translate-x-1/2 flex-col",
          // Capped so the radar is never fully covered.
          "max-h-[62dvh] rounded-t-[1.75rem] border-t border-white/10 bg-[#141419]",
          "pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-12px_48px_hsl(var(--shadow)/0.45)]",
          "md:bottom-6 md:rounded-[1.75rem] md:border"
        )}
      >
        <span aria-hidden="true" className="mx-auto mb-3 block h-1 w-9 shrink-0 rounded-full bg-white/20" />

        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pb-3">
          <div className="min-w-0">
            <h2 id="people-nearby-title" className="text-[1.25rem] font-bold leading-tight">
              People nearby
            </h2>
            {/* States the ordering rather than offering a sort control: the
                order is the server's, and there is no second real option. */}
            <p className="mt-0.5 text-[0.75rem] text-muted-foreground">Sorted by proximity</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close people nearby"
            className="focus-ring safe-motion -mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              &times;
            </span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
          {loading ? (
            // Compact row skeletons, so the panel keeps its height.
            <ul className="space-y-3" aria-hidden="true">
              {[0, 1, 2].map((row) => (
                <li key={row} className="flex items-center gap-3 py-1.5">
                  <span className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-white/[0.06] motion-reduce:animate-none" />
                  <span className="flex-1 space-y-1.5">
                    <span className="block h-3 w-1/3 animate-pulse rounded bg-white/[0.06] motion-reduce:animate-none" />
                    <span className="block h-2.5 w-1/2 animate-pulse rounded bg-white/[0.04] motion-reduce:animate-none" />
                  </span>
                </li>
              ))}
            </ul>
          ) : offline ? (
            <div className="py-8 text-center">
              <p className="text-[0.875rem] font-medium">You&rsquo;re offline.</p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
                Nearby people will refresh when you reconnect.
              </p>
            </div>
          ) : error ? (
            <div className="py-8 text-center">
              <p className="text-[0.875rem] text-muted-foreground">We couldn&rsquo;t load people nearby.</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
                <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : people.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-[0.875rem] font-medium">No one is nearby right now.</p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
                Keep Linkr on and check again soon.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {people.map((person) => (
                <PersonRow
                  key={person.userId}
                  person={person}
                  pending={pending || offline}
                  nowMs={nowMs}
                  onSelect={onSelect}
                  onWave={onWave}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** One compact row. Separators rather than a card per person. */
function PersonRow({
  person,
  pending,
  nowMs,
  onSelect,
  onWave
}: {
  person: SocializePerson;
  pending: boolean;
  /** The page's clock, so rows hedge in step with the radar. */
  nowMs: number;
  onSelect: (person: SocializePerson) => void;
  onWave: (person: SocializePerson) => void;
}) {
  const name = capitalize(person.displayName || person.username);
  const proximity = proximityLabels[person.proximityTier];
  // Same derivation as the radar, so a person cannot read as confirmed in one
  // place and hedged in the other.
  const hedge = presenceLabel(presenceStateFor(person.lastPresenceUpdate, nowMs));
  const activity = SOCIALIZE_ACTIVITY_LABELS[person.activity].toLowerCase();
  const waveLabel =
    person.waveState === "sent" ? "Wave sent" : person.waveState === "received" ? "Accept & connect" : "Wave";

  return (
    <li className="socialize-row">
      {/* The row is the selection target; the Wave button sits beside it
          rather than inside it, so tapping Wave can never also select. */}
      <div className="flex items-center gap-3 py-2.5">
        <button
          type="button"
          onClick={() => onSelect(person)}
          // One summary for the whole row, so proximity is not announced twice.
          aria-label={`${name}, ${hedge ?? proximity}, up for ${activity}. ${waveLabel}.`}
          className="focus-ring safe-motion flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
        >
          <span className="relative shrink-0">
            <UserAvatar src={person.avatarUrl} name={name} size="md" decorative className="h-11 w-11 ring-2 ring-violet-500/60" />
            <span
              className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#141419] bg-emerald-500"
              aria-hidden="true"
            />
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[0.9375rem] font-semibold leading-tight">{name}</span>
              <PremiumPlanBadge plan={person.plan} compact />
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
              {/* Proximity BAND only — never a distance. */}
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 font-semibold",
                  hedge ? "bg-white/[0.05] text-muted-foreground" : "bg-white/[0.08] text-foreground"
                )}
              >
                {hedge ?? proximity}
              </span>
              <span className="truncate">Up for {activity}</span>
            </span>
          </span>
        </button>

        <Button
          type="button"
          size="sm"
          variant={person.waveState === "sent" ? "outline" : "primary"}
          disabled={pending || person.waveState === "sent"}
          aria-label={`${waveLabel} — ${name}`}
          onClick={(event) => {
            // Belt and braces: the button is a sibling, but stop the event
            // reaching any future row-level handler.
            event.stopPropagation();
            onWave(person);
          }}
          className="min-h-[44px] shrink-0"
        >
          {pending && person.waveState === "none" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : null}
          {waveLabel}
        </Button>
      </div>
    </li>
  );
}
