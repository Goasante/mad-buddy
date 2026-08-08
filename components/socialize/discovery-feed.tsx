"use client";

import Link from "next/link";
import { Bell, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DISCOVERY_PAGE_SIZE,
  orderDiscoveryPeople,
  searchDiscoveryPeople,
} from "@/lib/social/discovery-filters";
import type { SocializePerson } from "@/lib/social/socialize-mobile";
import type { GroupSummary } from "@/lib/groups/types";
import type { HomeUpcomingPlan } from "@/lib/social/upcoming-plans";
import { GroupsRail, PeopleRail, PlansRail } from "@/components/socialize/discovery-rails";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";

/**
 * The Socialize discovery feed.
 *
 * Replaces the radar entirely: one vertical scroll, header → search → filter
 * chips → cards. Everything here narrows a list the server already authorised;
 * no filter, search or page action can surface someone the viewer was not
 * already entitled to see.
 *
 * The card shows only what genuinely exists. There is no age, no interest
 * chips and no mutual count in the projection today, and a card that renders
 * empty rows for them would be advertising data the product does not have —
 * so those sections are absent rather than blank.
 */

export type DiscoveryFeedProps = {
  people: readonly SocializePerson[];
  feedRef?: React.Ref<HTMLDivElement>;
  exploreSignal?: number;
  unreadCount?: number;
  hero?: React.ReactNode;
  onJoinGroup?: (group: GroupSummary) => void;
  onJoinPlan?: (plan: HomeUpcomingPlan) => void;
  groups?: readonly GroupSummary[];
  plans?: readonly HomeUpcomingPlan[];
  onWave: (person: SocializePerson) => void;
  /** Left swipe: a private, expiring feed preference. Never a block. */
  onPass: (person: SocializePerson) => void;
  /** Absent when there is nothing to undo. */
  onUndoPass?: () => void;
  onInvite: (person: SocializePerson) => void;
  /** Present only for people the viewer can already message. */
  onMessage?: (person: SocializePerson) => void;
  pending?: boolean;
  /** Rendered when nothing matches — the caller owns the reason. */
  emptyState?: React.ReactNode;
};

export function DiscoveryFeed({
  people,
  /** Anchor the hero's Explore action scrolls to. */
  feedRef,
  /** Increments when the hero's Explore is pressed; clears all narrowing. */
  exploreSignal = 0,
  /** Unread notifications, from the canonical shell count. */
  unreadCount = 0,
  /** The hero, rendered between the chips and the rails. */
  hero,
  /** Canonical join action, supplied by the page. */
  onJoinGroup,
  /** Canonical RSVP action, supplied by the page. */
  onJoinPlan,
  groups = [],
  plans = [],
  onWave,
  onPass,
  onUndoPass,
  onInvite,
  onMessage,
  pending = false,
  emptyState
}: DiscoveryFeedProps) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(DISCOVERY_PAGE_SIZE);
  // Search + chips live behind the header's filter button, so the top of the
  // page stays the rails rather than a row of controls.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Explore clears the search so the feed shows everything again.
  // Derived during render rather than synced in an effect.
  const [trackedExplore, setTrackedExplore] = useState(exploreSignal);
  if (trackedExplore !== exploreSignal) {
    setTrackedExplore(exploreSignal);
    setQuery("");
    setVisibleCount(DISCOVERY_PAGE_SIZE);
  }

  // One derivation chain, memoised: order → search. Recomputed only
  // when its inputs change, never on every render.
  const results = useMemo(() => {
    const ordered = orderDiscoveryPeople(people);
    return searchDiscoveryPeople(ordered, query);
  }, [people, query]);

  const visible = results.slice(0, visibleCount);
  const hasMore = results.length > visible.length;

  return (
    <div ref={feedRef} className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] font-bold leading-none tracking-tight">Linkr</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Find people nearby who are open to connecting
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-pressed={filtersOpen}
            aria-label="Filters"
            title="Filters"
            className="focus-ring safe-motion grid h-11 w-11 place-items-center rounded-full border border-border/70 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
          </button>
          <Link
            href="/notifications"
            aria-label={
              unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
            }
            title="Notifications"
            className="focus-ring safe-motion relative grid h-11 w-11 place-items-center rounded-full border border-border/70 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <span className={unreadCount > 0 ? "bell-two-tone" : undefined}>
              <Bell className="h-5 w-5" aria-hidden="true" />
            </span>
            {unreadCount > 0 ? (
              <span
                aria-hidden="true"
                className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
              />
            ) : null}
          </Link>
        </div>
      </header>

      {/* Search, behind the header's filter button.
          The chip row that sat here ("Nearby", "Active", "Not connected yet")
          is gone: every chip narrowed a feed that is usually small enough to
          read in full, so they cost a permanent row of the screen to solve a
          problem that only exists when the feed is large. Search remains
          because it answers a different question — finding one person you
          already have in mind. */}
      {filtersOpen ? (
        <div data-tour-id={TOUR_TARGET_IDS.SOCIALIZE_FEED} className="space-y-3">
      {/* Search and filter share a row: the filter is a modifier OF the
            search, and separating them wasted a full row of vertical space at
            the top of a feed-first screen. */}
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(DISCOVERY_PAGE_SIZE);
              }}
              placeholder="Search by name or username"
              aria-label="Search people nearby"
              className="pl-9"
            />
          </div>
          <Link
            href="/settings/glow-visibility"
            aria-label="Discovery settings"
            title="Discovery settings"
            className="focus-ring safe-motion grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/70 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>

        </div>
      ) : null}

      <div className="pt-1">{hero}</div>

      {/* The rails: people, groups and plans, each from a projection the
          page already loaded. Hidden individually when empty. */}
      {/* Order: people, then plans, then groups. Plans carry a deadline, so
          they sit above groups — the thing you might miss comes before the
          thing that will still be there tomorrow. */}
      <PeopleRail
        people={visible}
        onWave={onWave}
        onPass={onPass}
        onUndoPass={onUndoPass}
        pending={pending}
      />
      <PlansRail plans={plans} onJoin={onJoinPlan ?? (() => {})} pending={pending} />
      <GroupsRail groups={groups} onJoin={onJoinGroup ?? (() => {})} pending={pending} />

      {/* The people rail IS the feed. When it has nothing to show, the
          caller's contextual empty state takes its place. */}
      {visible.length === 0 ? emptyState ?? null : null}

      {hasMore ? (
        <div className="flex justify-center pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => setVisibleCount((current) => current + DISCOVERY_PAGE_SIZE)}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

