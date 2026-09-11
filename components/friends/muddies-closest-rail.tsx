"use client";

import { Navigation } from "lucide-react";

import { ProximityGlowAvatar } from "@/components/glow/proximity-glow-avatar";
import { SWIPE_OPT_OUT_ATTRIBUTE } from "@/lib/navigation/swipe-tabs";
import {
  railDistanceLabel,
  railToneClass,
  type MuddyProximity
} from "@/lib/friends/muddies-presentation";
import { proximityBandRangeLabel } from "@/lib/proximity/bands";
import { cn } from "@/lib/utils";

/** "Who's closest to you" — the rail at the top of Muddies. */
export function MuddiesClosestRail({
  people,
  proximityByFriendId,
  glowColorByFriendId,
  reducedMotion,
  onSelect
}: {
  people: ReadonlyArray<{ id: string; displayName: string; avatarUrl: string | null }>;
  proximityByFriendId: Readonly<Record<string, MuddyProximity>>;
  glowColorByFriendId?: Readonly<Record<string, string>>;
  reducedMotion: boolean;
  onSelect: (id: string) => void;
}) {
  if (people.length === 0) return null;

  return (
    <section aria-labelledby="muddies-closest-heading" className="muddies-rail">
      <div className="muddies-section-head">
        <h2 id="muddies-closest-heading" className="muddies-section-title">
          Who&rsquo;s closest to you
          <Navigation className="h-[1.05em] w-[1.05em] shrink-0 text-primary" aria-hidden="true" />
        </h2>
      </div>

      <ul
        {...{ [SWIPE_OPT_OUT_ATTRIBUTE]: "" }}
        className="no-scrollbar muddies-rail-track"
      >
        {people.map((person) => {
          const proximity = proximityByFriendId[person.id];
          const level = proximity?.proximityLevel ?? "far";
          const band =
            proximity?.proximityBand && proximity.proximityBand !== "outside_range"
              ? proximity.proximityBand
              : null;
          const stateLabel = railDistanceLabel(proximity);
          const rangeLabel = band ? proximityBandRangeLabel(band) : null;

          return (
            <li key={person.id} className="muddies-rail-item">
              <button
                type="button"
                onClick={() => onSelect(person.id)}
                className="muddies-rail-button focus-ring"
                aria-label={[person.displayName, stateLabel.toLowerCase(), rangeLabel?.toLowerCase()]
                  .filter(Boolean)
                  .join(", ")}
              >
                <span className={cn("muddies-rail-glow", railToneClass(level))} aria-hidden="true">
                  <ProximityGlowAvatar
                    name={person.displayName}
                    src={person.avatarUrl}
                    band={proximity?.proximityBand ?? null}
                    decorative
                    glowColorId={glowColorByFriendId?.[person.id] ?? null}
                    reducedMotion={reducedMotion}
                    size="lg"
                  />
                </span>

                <span className="muddies-rail-name" aria-hidden="true">
                  {person.displayName}
                </span>
                <span className={cn("muddies-rail-distance", railToneClass(level))} aria-hidden="true">
                  <span className="block font-semibold">{stateLabel}</span>
                  {rangeLabel ? (
                    <span className="mt-0.5 block text-[10px] font-medium leading-3 text-muted-foreground/75">
                      {rangeLabel}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
