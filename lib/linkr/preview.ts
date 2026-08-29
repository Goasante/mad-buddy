import { orderedPhotos } from "@/lib/linkr/photos";
import type { LinkrCandidate } from "@/lib/linkr/candidate-service";
import type { LinkrOwnProfile } from "@/lib/linkr/profile-service";

/**
 * YOUR OWN LINKR CARD, AS A STRANGER SEES IT.
 *
 * "Preview my Linkr card" used to set a notice string -- "Your card is what
 * other people see on the left" -- from inside the profile editor, which is a
 * view that RETURNS EARLY before the notice element renders. So the tap set
 * state nothing displayed, on a screen with no "left" to look at. A dead
 * control with copy describing a layout that does not exist.
 *
 * This maps the viewer's own profile onto the SAME shape the discovery deck
 * uses, so the preview is rendered by the SAME CandidateCard component. There
 * is deliberately no second card design and no preview-only renderer: the
 * whole value of a preview is that it cannot drift from the real thing.
 *
 * NO INVENTED DATA. Every field is either the viewer's real value or an
 * honestly neutral one. In particular:
 *
 *   proximityLabel  "You" -- a preview has no distance to report, and showing
 *                   a fake band would be the one number this product refuses
 *                   to invent.
 *   activeNow       false. Presence is not something to assert about yourself.
 *   eventName       null. A preview is not inside an Event.
 *
 * Photos come from the profile projection that already applied the
 * stranger-safe rule, so a preview can never show an image a stranger would
 * not be shown.
 */

/** The viewer's own card, in the deck's shape. */
export function previewCandidateFrom(profile: LinkrOwnProfile): LinkrCandidate {
  return {
    // A preview is not a real candidate and must never be treated as one; the
    // id is a stable sentinel rather than the viewer's user id, so a stray
    // Connect could not address a real person.
    userId: PREVIEW_CANDIDATE_ID,
    displayName: profile.displayName,
    age: profile.age,
    intent: profile.intent,
    bio: profile.bio.trim() ? profile.bio : null,
    interests: profile.interests,
    photos: orderedPhotos(profile.photos).map((photo) => photo.url),
    proximityLabel: "You",
    activeNow: false,
    isVerifiedAccount: profile.isVerifiedAccount,
    eventName: null
  };
}

/**
 * The sentinel id a preview card carries.
 *
 * Exported so a caller can assert it never reaches a mutation: the preview
 * renders the real card component, which has Pass and Connect controls, and
 * those must be inert here rather than acting on a fabricated id.
 */
export const PREVIEW_CANDIDATE_ID = "linkr-preview";

/**
 * What is still missing before this card would be shown to anybody.
 *
 * The preview OPENS EITHER WAY. Somebody with an incomplete profile is exactly
 * the person who most needs to see what their card looks like -- refusing to
 * show it, or showing a card while silently hiding that it is undiscoverable,
 * both leave them guessing. `missingRequirements` is the canonical list the
 * profile service already computes; this only decides how to say it.
 */
export type PreviewReadiness = {
  discoverable: boolean;
  /** Empty when nothing is missing. */
  missing: string[];
  headline: string;
};

export function previewReadiness(profile: LinkrOwnProfile): PreviewReadiness {
  const missing = profile.missingRequirements ?? [];
  if (profile.discoverable && missing.length === 0) {
    return {
      discoverable: true,
      missing: [],
      headline: "This is your card. People discovering you see exactly this."
    };
  }
  return {
    discoverable: false,
    missing,
    headline:
      "This is how your card would look. It is not being shown to anyone yet:"
  };
}
