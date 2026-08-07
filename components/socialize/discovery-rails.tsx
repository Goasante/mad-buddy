"use client";

import type { Route } from "next";
import Link from "next/link";

import { SocializePersonCard } from "@/components/socialize/socialize-person-card";
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
 * People you might click with.
 *
 * Photo-led, matching the approved design. Age, interest chips and a verified
 * tick are ABSENT rather than faked: there is no age in the projection, no
 * interests table in the product, and no identity-verification system — only
 * membership badges, which the avatar ring already carries.
 */
export function PeopleRail({
  people,
  onWave,
  onMessage,
  pending
}: {
  people: readonly SocializePerson[];
  onWave: (person: SocializePerson) => void;
  onMessage: (person: SocializePerson) => void;
  pending: boolean;
}) {
  if (people.length === 0) return null;

  return (
    <RailSection id="people-rail-heading" title="People you might click with" first>
      <Rail label="People nearby">
        {people.map((person, index) => (
          <li
            key={person.userId}
            // Wider than the old 168px card: a portrait worth stopping for
            // needs room. Two fit at 430px, one and a peek at 320px, which is
            // the deliberate horizontal treatment rather than a cramped grid.
            // Three across the viewport with a peek of the fourth, so the rail
            // reads as scrollable rather than as a finished row.
            className="socialize-card-in w-[calc((100%-1.5rem)/3)] min-w-[9.5rem] shrink-0 snap-start"
            // Soft stagger, capped so the last card is never a long wait.
            style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
          >
            <SocializePersonCard
              person={person}
              onWave={onWave}
              onMessage={onMessage}
              pending={pending}
            />
          </li>
        ))}
      </Rail>
    </RailSection>
  );
}

/** Groups the viewer can join, from the existing discoverable-groups projection. */
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
        <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center">
          <p className="text-sm font-medium">No groups to discover yet</p>
          <p className="mx-auto mt-1 max-w-[22rem] text-xs leading-relaxed text-muted-foreground">
            Linkr surfaces public groups as people create them. Start one and make it public so others can find it.
          </p>
          <Button asChild type="button" variant="outline" size="sm" className="mt-3">
            <Link href={"/groups?create=1" as Route}>Create a group</Link>
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
