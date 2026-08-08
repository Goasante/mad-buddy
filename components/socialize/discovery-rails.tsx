"use client";

import { Users } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { SwipeDeck } from "@/components/socialize/swipe-deck";
import { SocializeGroupCard } from "@/components/socialize/socialize-group-card";
import { SocializePlanCard } from "@/components/socialize/socialize-plan-card";
import { Button } from "@/components/ui/button";
import type { GroupSummary } from "@/lib/groups/types";
import type { HomeUpcomingPlan } from "@/lib/social/upcoming-plans";
import type { SocializePerson } from "@/lib/social/socialize-mobile";
import { cn } from "@/lib/utils";

/**
 * The Socialize discovery rails.
 *
 * Three horizontally-scrolling sections — people, groups, plans — each reading
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

/** Shared scroller. Opts out of tab swiping and hides its scrollbar. */
function Rail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <ul
      aria-label={label}
      data-no-tab-swipe=""
      className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
    >
      {children}
    </ul>
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
  pending
}: {
  people: readonly SocializePerson[];
  onWave: (person: SocializePerson) => void;
  onPass: (person: SocializePerson) => void;
  onUndoPass?: () => void;
  pending: boolean;
}) {
  if (people.length === 0) return null;

  return (
    <RailSection id="people-rail-heading" title="People you might click with" first>
      <SwipeDeck
        people={people}
        onWave={onWave}
        onPass={onPass}
        onUndo={onUndoPass}
        pending={pending}
      />
    </RailSection>
  );
}

export function GroupsRail({
  groups,
  onJoin,
  pending = false
}: {
  groups: readonly GroupSummary[];
  onJoin: (group: GroupSummary) => void;
  pending?: boolean;
}) {
  return (
    <RailSection id="groups-rail-heading" title="Join a Group">

      {groups.length > 0 ? (
        <Rail label="Groups to join">
          {groups.map((group, index) => (
            <li
              key={group.id}
              className="socialize-card-in w-[calc((100%-1.5rem)/3)] min-w-[11rem] shrink-0 snap-start"
              style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
            >
              <SocializeGroupCard group={group} onJoin={onJoin} pending={pending} />
            </li>
          ))}
        </Rail>
      ) : (
        /* An empty rail is an invitation, not a dead end: there is nothing to
           browse yet, so the useful thing to offer is starting one. Routes
           into the EXISTING create-group flow rather than a second path. */
        <div className="linkr-empty">
          {/* An abstract mark rather than a stock illustration: three
              overlapping discs reading as a small group, drawn from the brand
              palette so it belongs to the page instead of sitting on it.
              Decorative, so it is hidden from screen readers. */}
          <span className="linkr-empty-art" aria-hidden="true">
            <span className="linkr-empty-disc linkr-empty-disc-a" />
            <span className="linkr-empty-disc linkr-empty-disc-b" />
            <span className="linkr-empty-disc linkr-empty-disc-c" />
          </span>

          <div className="linkr-empty-body">
            <p className="linkr-empty-title">No groups to discover yet</p>
            <p className="linkr-empty-copy">
              Linkr shows public groups as people create them. Start one and make it public so others can find it.
            </p>
          </div>

          <Button asChild type="button" className="linkr-empty-cta">
            <Link href={"/groups?create=1" as Route}>
              Create a group
              <Users className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      )}
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
        <Rail label="Upcoming plans">
          {plans.map((plan, index) => (
            <li
              key={plan.id}
              // Roughly 1.3 cards per viewport: a plan is the one thing here
              // with a deadline, and a card you can only half-read cannot make
              // someone feel they might miss it.
              className="socialize-card-in w-[78%] min-w-[16rem] shrink-0 snap-start sm:w-[22rem]"
              style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
            >
              <SocializePlanCard plan={plan} onJoin={onJoin} pending={pending} />
            </li>
          ))}
        </Rail>
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
