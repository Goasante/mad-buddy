import { describe, expect, it } from "vitest";

import {
  PREVIEW_CANDIDATE_ID,
  previewCandidateFrom,
  previewReadiness
} from "@/lib/linkr/preview";
import type { LinkrOwnProfile } from "@/lib/linkr/profile-service";

/**
 * "PREVIEW MY LINKR CARD" IS NOT A DEAD CONTROL.
 *
 * The defect these pin: the button called
 * `setNotice("Your card is what other people see on the left.")` from inside
 * the profile editor -- a view that RETURNS EARLY, before the notice element
 * is rendered. The tap set state nothing displayed, and the copy described a
 * left-hand pane that does not exist on a phone.
 *
 * The fix routes it to a real view that renders the SAME CandidateCard the
 * discovery deck uses. These assert the mapping that makes that possible, and
 * the honesty rules around it.
 */

const base: LinkrOwnProfile = {
  enabled: true,
  intent: "friends",
  bio: "Design student. Jollof purist.",
  discoveryDistance: "around_you",
  requirePhotos: false,
  onlyActiveNow: false,
  onlyNewToday: false,
  eventModeEnabled: true,
  photos: [
    { id: "p2", position: 1, url: "https://example.test/second.jpg" },
    { id: "p1", position: 0, url: "https://example.test/first.jpg" }
  ],
  interests: ["Design", "Beach"],
  displayName: "Adjoa",
  age: 24,
  isVerifiedAccount: true,
  missingRequirements: [],
  discoverable: true
};

describe("the preview shows the viewer's real card", () => {
  it("carries their own identity, not placeholder data", () => {
    const candidate = previewCandidateFrom(base);
    expect(candidate.displayName).toBe("Adjoa");
    expect(candidate.age).toBe(24);
    expect(candidate.bio).toBe("Design student. Jollof purist.");
    expect(candidate.interests).toEqual(["Design", "Beach"]);
    expect(candidate.intent).toBe("friends");
    expect(candidate.isVerifiedAccount).toBe(true);
  });

  it("orders photos by position, so the profile picture leads", () => {
    /* The profile stores them unordered; the card shows the primary first,
       exactly as the deck does. */
    const candidate = previewCandidateFrom(base);
    expect(candidate.photos).toEqual([
      "https://example.test/first.jpg",
      "https://example.test/second.jpg"
    ]);
  });

  it("treats an empty bio as absent rather than as an empty line", () => {
    expect(previewCandidateFrom({ ...base, bio: "   " }).bio).toBeNull();
    expect(previewCandidateFrom({ ...base, bio: "" }).bio).toBeNull();
  });

  it("survives a profile with no photos at all", () => {
    const candidate = previewCandidateFrom({ ...base, photos: [] });
    expect(candidate.photos).toEqual([]);
    // The preview must still open; the card renders its own empty state.
    expect(candidate.displayName).toBe("Adjoa");
  });
});

describe("a preview invents nothing", () => {
  /* THE ONE NUMBER THIS PRODUCT REFUSES TO INVENT. A preview has no distance
     to report, so it says "You" rather than fabricating a proximity band. */
  it("reports no proximity band", () => {
    const candidate = previewCandidateFrom(base);
    expect(candidate.proximityLabel).toBe("You");
    for (const band of ["Right Here", "Just Around", "Close By", "In Your Area", "Across Town"]) {
      expect(candidate.proximityLabel).not.toBe(band);
    }
  });

  it("claims no presence and no Event context", () => {
    const candidate = previewCandidateFrom(base);
    expect(candidate.activeNow).toBe(false);
    expect(candidate.eventName).toBeNull();
  });

  /* The card carries Pass and Connect. A preview addresses nobody, so the id
     must be a sentinel rather than the viewer's own user id -- a stray
     mutation cannot then act on a real person. */
  it("uses a sentinel id that is not a real user", () => {
    const candidate = previewCandidateFrom(base);
    expect(candidate.userId).toBe(PREVIEW_CANDIDATE_ID);
    expect(candidate.userId).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});

describe("an incomplete profile still gets a preview", () => {
  const incomplete: LinkrOwnProfile = {
    ...base,
    discoverable: false,
    missingRequirements: ["Add a profile photo", "Linkr is for people 18 and over"]
  };

  it("opens, and says plainly that nobody is seeing it", () => {
    const readiness = previewReadiness(incomplete);
    expect(readiness.discoverable).toBe(false);
    expect(readiness.headline).toMatch(/not being shown/i);
    expect(readiness.missing).toEqual([
      "Add a profile photo",
      "Linkr is for people 18 and over"
    ]);
  });

  it("still produces a card to look at", () => {
    /* Refusing to render would leave the person guessing about the very thing
       they asked to see. */
    const candidate = previewCandidateFrom(incomplete);
    expect(candidate.displayName).toBe("Adjoa");
  });

  it("says the opposite when everything is in place", () => {
    const readiness = previewReadiness(base);
    expect(readiness.discoverable).toBe(true);
    expect(readiness.missing).toEqual([]);
    expect(readiness.headline).toMatch(/see exactly this/i);
  });

  it("never claims discoverable while requirements are outstanding", () => {
    const contradictory = { ...base, discoverable: true, missingRequirements: ["Add a photo"] };
    expect(previewReadiness(contradictory).discoverable).toBe(false);
  });
});
