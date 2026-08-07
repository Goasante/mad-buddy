import type { SocializePerson } from "@/lib/social/socialize-mobile";

/**
 * Discovery filters — the chip vocabulary, as data.
 *
 * A registry rather than a hardcoded row of buttons, because these chips are
 * meant to be reused by Socialize, Hangout and any later discovery surface.
 * Adding a filter should be adding an entry here, not editing three screens.
 *
 * Each filter is a PURE predicate over the already-authorised projection. That
 * matters: filtering never widens what the server returned, so no chip can
 * reveal someone the viewer was not already entitled to see. A filter can only
 * ever narrow a list that was authorised upstream.
 */

export type DiscoveryFilterId = "nearby" | "active" | "not_yet_connected";

export type DiscoveryFilter = {
  id: DiscoveryFilterId;
  label: string;
  /** Screen-reader description of what the chip narrows to. */
  description: string;
  matches: (person: SocializePerson) => boolean;
};

/**
 * The filters available today.
 *
 * Three, and every one names exactly what its field holds.
 *
 * "Verified" was REMOVED rather than renamed: it filtered on `plan !== "free"`,
 * so a paid membership was being presented as identity verification. There is
 * no identity-verification system in this product, and implying one is a
 * safety claim we cannot honour — the membership badge already says what a
 * paid plan means, in the one place it belongs.
 *
 * Future filters are ABSENT rather than disabled. A greyed-out chip advertises
 * a capability the data cannot support; see FUTURE_FILTER_IDS.
 */
export const DISCOVERY_FILTERS: readonly DiscoveryFilter[] = [
  {
    id: "nearby",
    label: "Nearby",
    // proximityTier, from the proximity engine's bucketing.
    description: "People closest to you",
    matches: (person) => person.proximityTier === "close" || person.proximityTier === "near"
  },
  {
    id: "active",
    label: "Active",
    // presenceState === "fresh": their device reported in recently.
    description: "People active right now",
    matches: (person) => person.presenceState === "fresh"
  },
  {
    id: "not_yet_connected",
    label: "Not connected yet",
    /**
     * waveState === "none": no Muddy request is pending in EITHER direction.
     *
     * Previously labelled "New", which implied recency — a newly joined
     * account, or someone newly nearby. The field says nothing about time; it
     * says nothing has passed between you yet. The label now says that.
     */
    description: "People you have not sent or received a request with",
    matches: (person) => person.waveState === "none"
  }
];

/**
 * Filters that will exist once their data does.
 *
 * Named here so the extension point is explicit and reviewable, and so nobody
 * has to guess whether omitting them was an oversight. Adding one means adding
 * its predicate above — no screen changes.
 */
export const FUTURE_FILTER_IDS = [
  "interests",
  "mutual_muddies",
  "spark",
  "public_groups",
  "hangouts",
  "plans_nearby",
  "plus_filters"
] as const;

/**
 * Apply the active chips.
 *
 * AND, not OR: chips narrow together, so "Nearby + Active" means both. That
 * matches how a chip row reads — each one you press asks for less, never more.
 * No chips selected means no narrowing.
 */
export function applyDiscoveryFilters(
  people: readonly SocializePerson[],
  active: ReadonlySet<DiscoveryFilterId>
): SocializePerson[] {
  if (active.size === 0) return [...people];
  const predicates = DISCOVERY_FILTERS.filter((filter) => active.has(filter.id));
  return people.filter((person) => predicates.every((filter) => filter.matches(person)));
}

/**
 * Free-text search over name and username.
 *
 * Client-side ON PURPOSE, and safe to be: the discovery projection is a single
 * authorised page (capped at 200 candidates upstream), already filtered for
 * blocks, existing friendships and visibility. Searching it is narrowing a
 * list the viewer already holds — not a query that could reach anyone new.
 *
 * A server-side people search would be a different capability with different
 * authorisation, and this is deliberately not that.
 */
export function searchDiscoveryPeople(
  people: readonly SocializePerson[],
  query: string
): SocializePerson[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...people];
  return people.filter(
    (person) =>
      person.displayName.toLowerCase().includes(needle) ||
      person.username.toLowerCase().includes(needle)
  );
}

/**
 * The feed's canonical order.
 *
 * Proximity first, then presence, then name. Membership tier is deliberately
 * NOT a term: ranking paid accounts higher would quietly sell position in a
 * discovery feed, which is the same rule the group member list follows.
 */
const TIER_RANK: Record<string, number> = { close: 0, near: 1, far: 2 };
const PRESENCE_RANK: Record<string, number> = { fresh: 0, grace: 1, expired: 2 };

export function orderDiscoveryPeople(people: readonly SocializePerson[]): SocializePerson[] {
  return [...people].sort((a, b) => {
    const tier = (TIER_RANK[a.proximityTier] ?? 99) - (TIER_RANK[b.proximityTier] ?? 99);
    if (tier !== 0) return tier;
    const presence = (PRESENCE_RANK[a.presenceState] ?? 99) - (PRESENCE_RANK[b.presenceState] ?? 99);
    if (presence !== 0) return presence;
    return a.displayName.localeCompare(b.displayName);
  });
}

/** How many cards a page shows before "Load more". */
export const DISCOVERY_PAGE_SIZE = 12;
