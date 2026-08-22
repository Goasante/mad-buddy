"use client";

import { Navigation } from "lucide-react";

import { ProximityGlowAvatar } from "@/components/glow/proximity-glow-avatar";
import { SWIPE_OPT_OUT_ATTRIBUTE } from "@/lib/navigation/swipe-tabs";
import {
  isOnline,
  presenceLabel,
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
          const presence = presenceLabel(proximity);
          const online = isOnline(proximity);

          return (
            <li key={person.id} className="muddies-rail-item">
              <button
                type="button"
                onClick={() => onSelect(person.id)}
                className="muddies-rail-button focus-ring"
                /* ONE composed label for the whole card.
                   The visible text below is marked aria-hidden and the avatar
                   is passed no proximityLevel, so a screen reader hears this
                   sentence once instead of "Ama, close. Ama. Very close." --
                   the name twice, the distance twice, and in two different
                   vocabularies ("Close" from proximityLabels vs "Very close"
                   from the rail). */
                aria-label={[
                  person.displayName,
                  railDistanceLabel(proximity).toLowerCase(),
                  presence
                ]
                  .filter(Boolean)
                  .join(", ")}
              >
                {/* aria-hidden on the WRAPPER as well as on the avatar: the
                    button above already announces name, distance and presence
                    as one sentence, so nothing inside may speak again. */}
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
                  {/* Presence dot, anchored to the avatar rather than the
                      aura so it keeps its place while the halo breathes. */}
                  {presence ? (
                    <span
                      className={cn("muddies-rail-dot", online && "muddies-rail-dot-online")}
                      aria-hidden="true"
                    />
                  ) : null}
                </span>

                <span className="muddies-rail-name" aria-hidden="true">
                  {person.displayName}
                </span>
                <span className={cn("muddies-rail-distance", railToneClass(level))} aria-hidden="true">
                  {railDistanceLabel(proximity)}
                </span>
                {presence ? (
                  <span className="muddies-rail-presence" aria-hidden="true">
                    <span
                      className={cn("muddies-presence-dot", online && "muddies-presence-dot-online")}
                      aria-hidden="true"
                    />
                    {presence}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
