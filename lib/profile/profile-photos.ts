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
  /**
   * The hints now say where each setting REACHES, not just who it excludes.
   *
   * Linkr shows strangers only `everyone` photos -- a picture kept for your
   * Muddies is not handed to people you have never met. That is the right
   * rule, but it was invisible: photos default to `approved_muddies`, so
   * people added showcase photos, saw them on their own Profile, and could not
   * work out why their Linkr card still showed one image. Saying so here is
   * the fix; widening the projection would not be.
   */
  { id: "everyone", label: "Everyone", hint: "Anyone who can see your profile, including on Linkr." },
  { id: "approved_muddies", label: "My Muddies", hint: "Only people you're connected to. Not shown on Linkr." },
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

// ---------------------------------------------------------------------------
// Adding several photos in one go (§10, §11)
// ---------------------------------------------------------------------------

/**
 * How many more photos this person may add.
 *
 * The picker needs this BEFORE the file dialog opens, because the honest
 * moment to say "you can add two more" is while choosing, not after.
 */
export function remainingPhotoSlots(photos: readonly ProfilePhoto[]): number {
  return Math.max(0, MAX_PROFILE_PHOTOS - photos.length);
}

/** What a batch selection means: what we will take, and what to say about it. */
export type BatchSelection = {
  /** The files that fit, in the order chosen. */
  accepted: File[];
  /** The files that did not fit. Never silently dropped -- always reported. */
  rejected: File[];
  /** Null when everything fit. */
  message: string | null;
};

/**
 * Decide what happens when somebody picks several files at once.
 *
 * OVER-SELECTION IS NOT SILENTLY TRIMMED. Taking the first N and discarding
 * the rest without a word means the person believes they added five photos and
 * finds three -- with no way to know which two are missing or why. The excess
 * is reported, and the message names the real limit rather than the remainder,
 * because "you can add up to 3" is the rule they need to understand.
 */
export function selectPhotoBatch(
  chosen: readonly File[],
  existing: readonly ProfilePhoto[]
): BatchSelection {
  const room = remainingPhotoSlots(existing);

  if (room === 0) {
    return {
      accepted: [],
      rejected: [...chosen],
      message: `You can add up to ${MAX_PROFILE_PHOTOS} showcase photos. Remove one first.`
    };
  }

  if (chosen.length <= room) {
    return { accepted: [...chosen], rejected: [], message: null };
  }

  return {
    accepted: chosen.slice(0, room),
    rejected: chosen.slice(room),
    message:
      `You can add up to ${MAX_PROFILE_PHOTOS} showcase photos. ` +
      `There is room for ${room} more, so ${chosen.length - room} were not included.`
  };
}

/** One file's progress through a batch upload. */
export type BatchItemStatus = "pending" | "uploading" | "done" | "failed";

/**
 * What to tell somebody once a batch finishes.
 *
 * A PARTIAL BATCH IS A SUCCESS PLUS A FAILURE, never a single verdict. Two of
 * three landing must not read as failure -- the two are really there -- and it
 * must not read as plain success either, because one is genuinely missing and
 * they need to know which.
 */
export function batchOutcomeMessage(succeeded: number, failed: number): string {
  if (failed === 0) {
    return succeeded === 1 ? "Photo added." : `${succeeded} photos added.`;
  }
  if (succeeded === 0) {
    return failed === 1 ? "That photo could not be added." : `${failed} photos could not be added.`;
  }
  return `${succeeded} added. ${failed} could not be added — you can retry ${failed === 1 ? "it" : "them"}.`;
}
