import { findFeatureGuide } from "@/lib/tours/registry";

export type ContextualTourCandidate = {
  tourVersionId: string;
  slug: string;
  steps: Array<{ route: string | null }>;
};

/**
 * Pure contextual offer selection. Server-side eligibility has already been
 * decided before candidates reach this function; it only matches the current
 * real route and, for shared routes such as Moments/Air, the selected target.
 */
export function selectContextualTour<T extends ContextualTourCandidate>(input: {
  tours: T[];
  pathname: string;
  activeTargetIds: ReadonlySet<string>;
  resolvedIds: ReadonlySet<string>;
}): T | null {
  const onThisRoute = input.tours.filter((tour) => {
    if (input.resolvedIds.has(tour.tourVersionId)) return false;
    const guide = findFeatureGuide(tour.slug);
    const entryRoute = guide?.entryRoute ?? tour.steps.find((step) => step.route)?.route;
    return entryRoute === input.pathname;
  });

  const active = onThisRoute.find((tour) => {
    const targetId = findFeatureGuide(tour.slug)?.activeTargetId;
    return targetId ? input.activeTargetIds.has(targetId) : false;
  });

  return active ?? onThisRoute.find((tour) => !findFeatureGuide(tour.slug)?.activeTargetId) ?? null;
}
