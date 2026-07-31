import { describe, expect, it } from "vitest";
import { selectContextualTour, type ContextualTourCandidate } from "@/lib/tours/context";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";

function candidate(
  tourVersionId: string,
  slug: string,
  route: string
): ContextualTourCandidate {
  return { tourVersionId, slug, steps: [{ route }] };
}

describe("contextual feature-guide selection", () => {
  const home = candidate("home-v1", "home-guide", "/dashboard");
  const moments = candidate("moments-v1", "moments-guide", "/moments");
  const air = candidate("air-v1", "air-guide", "/moments");

  it("offers only the guide for the first meaningful route", () => {
    expect(
      selectContextualTour({
        tours: [moments, home],
        pathname: "/dashboard",
        activeTargetIds: new Set(),
        resolvedIds: new Set()
      })
    ).toBe(home);
  });

  it("uses Moments normally and Air only while the real Air tab is active", () => {
    expect(
      selectContextualTour({
        tours: [air, moments],
        pathname: "/moments",
        activeTargetIds: new Set(),
        resolvedIds: new Set()
      })
    ).toBe(moments);

    expect(
      selectContextualTour({
        tours: [moments, air],
        pathname: "/moments",
        activeTargetIds: new Set([TOUR_TARGET_IDS.MOMENTS_AIR_TAB]),
        resolvedIds: new Set()
      })
    ).toBe(air);
  });

  it("does not select a locally resolved guide again", () => {
    expect(
      selectContextualTour({
        tours: [home],
        pathname: "/dashboard",
        activeTargetIds: new Set(),
        resolvedIds: new Set([home.tourVersionId])
      })
    ).toBeNull();
  });

  it("falls back to a step route for an admin-authored guide outside the code catalogue", () => {
    const authored = candidate("custom-v1", "custom-guide", "/events");
    expect(
      selectContextualTour({
        tours: [authored],
        pathname: "/events",
        activeTargetIds: new Set(),
        resolvedIds: new Set()
      })
    ).toBe(authored);
  });
});
