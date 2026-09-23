"use client";

import type { Route } from "next";
import Link from "next/link";

import { SwipeDeck } from "@/components/socialize/swipe-deck";
import { PlanStack } from "@/components/socialize/plan-stack";
import { Button } from "@/components/ui/button";
import type { HomeUpcomingPlan } from "@/lib/social/upcoming-plans";
import type { SocializePerson } from "@/lib/social/socialize-mobile";
import { deckCandidates } from "@/lib/social/swipe-deck";
import { cn } from "@/lib/utils";

/**
 * The Socialize discovery rails.
 *
 * Discovery sections for people and plans, each reading
 * a projection that already exists. Nothing here queries: the page loads the
 * data once and hands it down, so adding these rails costs no round trips.
 *
 * Every rail follows the same shape (heading, "See all", horizontal scroll of
 * cards) so the page reads as one system rather than three components that
 * happen to sit together. Each is marked `data-no-tab-swipe`, because a
 * horizontal drag inside a rail belongs to the rail.
 */

/**
 * One section shell for every rail.
 *
 * Previously each rail carried its own spacing and only Plans had a divider,
 * so the page read as three components that happened to sit together. The
 * separator lives here, on every section after the first, which is what turns
 * the transitions into a rhythm rather than an accident.
 */
function RailSection({
  id,
  title,
  first = false,
  children
}: {
  id: string;
  title: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn("space-y-3", !first && "border-t border-border/40 pt-7")}
    >
      <h2 id={id} className="text-base font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * People you might click with — the swipe deck.
 *
 * Photo-led, matching the approved design. Age, occupation chips and a
 * verified tick are ABSENT rather than faked: there is no age or occupation
 * in the projection, and no identity-verification system exists — only
 * membership, which the badge beside the name already carries.
 *
 * Distance is a phrase ("Close by"), never a number. Exact distances from
 * several vantage points reconstruct a location, which is the whole reason
 * the approximate labels exist.
 */
export function PeopleRail({
  people,
  onWave,
  onPass,
  onUndoPass,
  onOpenSkipped,
  pending
}: {
  people: readonly SocializePerson[];
  onWave: (person: SocializePerson) => void;
  onPass: (person: SocializePerson) => void;
  onUndoPass?: () => void;
  onOpenSkipped?: () => void;
  pending: boolean;
}) {
  // Only people whose wave can actually succeed. Someone already waved at
  // would produce a card that travels the full screen on a right swipe and
  // then springs back unexplained, because canWave refuses it inside endDrag.
  // They remain visible on the radar and in People Nearby, where their real
  // state has somewhere to show.
  const candidates = deckCandidates(people);
  if (candidates.length === 0) return null;

  return (
    <RailSection id="people-rail-heading" title="People you might click with" first>
      <SwipeDeck
        people={candidates}
        onWave={onWave}
        onPass={onPass}
        onUndo={onUndoPass}
        onOpenSkipped={onOpenSkipped}
        pending={pending}
      />
    </RailSection>
  );
}

/** Upcoming plans, from the existing home projection. */
export function PlansRail({
  plans,
  onJoin,
  pending = false
}: {
  plans: readonly HomeUpcomingPlan[];
  onJoin: (plan: HomeUpcomingPlan) => void;
  pending?: boolean;
}) {
  return (
    <RailSection id="plans-rail-heading" title="Upcoming Social Plans">

      {plans.length > 0 ? (
        // A stack, not a rail. A rail asks the user to scroll sideways before
        // discovering there is anything past the first card; a stack shows the
        // depth immediately. Chronology is preserved — see PlanStack.
        <PlanStack plans={plans} onJoin={onJoin} pending={pending} />
      ) : (
        <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center">
          <p className="text-sm font-medium">Nothing planned yet</p>
          <p className="mx-auto mt-1 max-w-[22rem] text-xs leading-relaxed text-muted-foreground">
            Linkr brings your upcoming plans here. Start one and invite the people you want to see.
          </p>
          <Button asChild type="button" variant="outline" size="sm" className="mt-3">
            <Link href={"/plans?create=1" as Route}>Create a plan</Link>
          </Button>
        </div>
      )}
    </RailSection>
  );
}
