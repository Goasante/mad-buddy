"use client";

import { Navigation } from "lucide-react";

import { ProximityGlowAvatar } from "@/components/glow/proximity-glow-avatar";
import { SWIPE_OPT_OUT_ATTRIBUTE } from "@/lib/navigation/swipe-tabs";
import {
  railDistanceLabel,
  railToneClass,
  type MuddyProximity
} from "@/lib/friends/muddies-presentation";
import { cn } from "@/lib/utils";

/**
 * "Who's closest to you" — the rail at the top of Muddies.
 *
 * The glow is the existing proximity halo, not a new treatment: same classes,
 * same breathing, same privacy model. Only two things are page-specific — the
 * intensity is raised (the rail is the one surface whose whole job is showing
 * distance, so the aura carries it) and the hue tracks the distance band.
 */
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

      {/* Marked swipe-exempt: dragging this strip sideways must scroll it,
          never change tab under the finger. */}
      <ul
        {...{ [SWIPE_OPT_OUT_ATTRIBUTE]: "" }}
        className="no-scrollbar muddies-rail-track"
      >
        {people.map((person) => {
          const proximity = proximityByFriendId[person.id];
          const level = proximity?.proximityLevel ?? "far";

          return (
            <li key={person.id} className="muddies-rail-item">
              <button
                type="button"
                onClick={() => onSelect(person.id)}
                className="muddies-rail-button focus-ring"
                /* ONE composed label for the whole card. The visible text
                   below is aria-hidden and the avatar is decorative, so a
                   screen reader hears this sentence once rather than the name
                   and the state twice over. */
                aria-label={[person.displayName, railDistanceLabel(proximity).toLowerCase()]
                  .filter(Boolean)
                  .join(", ")}
              >
                {/* aria-hidden on the WRAPPER as well as on the avatar: the
                    button above already announces name and proximity as one
                    sentence, so nothing inside may speak again. */}
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
                  {railDistanceLabel(proximity)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
