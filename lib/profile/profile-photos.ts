/**
 * Extra profile photos, and who may see each one.
 *
 * Three beyond the avatar. The avatar itself is untouched: it lives on
 * `profiles.avatar_url` and is the identity used everywhere in the product,
 * so folding it into this gallery would make every avatar read a second
 * table for no gain.
 *
 * Visibility is decided PER PHOTO. Someone may show one picture to everyone
 * and keep another for their Muddies, which is the whole reason the setting
 * is not a single gallery-wide switch.
 */

/** Slots, not a count: a photo occupies position 0, 1 or 2. */
export const PROFILE_PHOTO_SLOTS = [0, 1, 2] as const;
export const MAX_PROFILE_PHOTOS = PROFILE_PHOTO_SLOTS.length;

/**
 * The same vocabulary `profile_field_privacy` already uses for bio and
 * interests, minus the options that make no sense for a photo:
 * `close_friends` and `shared_communities` would add two more audiences to
 * explain for a feature whose value is that it is quick to set.
 */
export type PhotoVisibility = "everyone" | "approved_muddies" | "only_me";

export const PHOTO_VISIBILITY_OPTIONS: ReadonlyArray<{
  id: PhotoVisibility;
  label: string;
  hint: string;
}> = [
  { id: "everyone", label: "Everyone", hint: "Anyone who can see your profile." },
  { id: "approved_muddies", label: "My Muddies", hint: "Only people you're connected to." },
  { id: "only_me", label: "Only me", hint: "Nobody else can see it." }
];

export type ProfilePhoto = {
  id: string;
  position: number;
  url: string;
  visibility: PhotoVisibility;
};

/**
 * Which photos a given viewer may see.
 *
 * FAIL-CLOSED: anything not explicitly permitted is hidden. `only_me` never
 * leaves the owner, and an unrecognised visibility value — from a future
 * option, or a stale row — is treated as private rather than public.
 *
 * The owner always sees their own, including `only_me`: a photo you cannot
 * see is a photo you cannot manage.
 */
export function visiblePhotosFor(
  photos: readonly ProfilePhoto[],
  viewer: { isOwner: boolean; isApprovedMuddy: boolean }
): ProfilePhoto[] {
  if (viewer.isOwner) return [...photos];

  return photos.filter((photo) => {
    if (photo.visibility === "everyone") return true;
    if (photo.visibility === "approved_muddies") return viewer.isApprovedMuddy;
    // only_me, and anything unrecognised.
    return false;
  });
}

/**
 * The next free slot, or null when the gallery is full.
 *
 * Returns the lowest free position rather than appending, so deleting the
 * middle photo and adding another reuses that gap instead of leaving a hole
 * the carousel would have to reason about.
 */
export function nextPhotoSlot(photos: readonly ProfilePhoto[]): number | null {
  const taken = new Set(photos.map((photo) => photo.position));
  for (const slot of PROFILE_PHOTO_SLOTS) {
    if (!taken.has(slot)) return slot;
  }
  return null;
}

/** Whether this person can add another photo. */
export function canAddPhoto(photos: readonly ProfilePhoto[]): boolean {
  return nextPhotoSlot(photos) !== null;
}
