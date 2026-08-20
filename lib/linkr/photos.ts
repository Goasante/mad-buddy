/**
 * The Linkr photo model. Pure: slot arithmetic and ordering, no storage.
 *
 * Four slots, and slot 0 is load-bearing. The primary photo is the one a
 * stranger decides about, so it is a position rather than a flag -- there is
 * no state in which a card has two primaries or none.
 */

export const LINKR_PHOTO_SLOTS = [0, 1, 2, 3] as const;
export const MAX_LINKR_PHOTOS = LINKR_PHOTO_SLOTS.length;
export const PRIMARY_SLOT = 0;

export type LinkrPhoto = {
  id: string;
  position: number;
  url: string;
};

export const PHOTO_SLOT_LABELS: Record<number, string> = {
  0: "Main photo",
  1: "Showcase 1",
  2: "Showcase 2",
  3: "Showcase 3"
};

/**
 * Guidance shown next to the primary slot.
 *
 * The product rule is "the main photo should be you". It is enforced by
 * telling people, not by running a face detector over their pictures --
 * scanning someone's photo to decide whether their face is in it is a
 * surveillance capability, and it is not worth building to prevent somebody
 * leading with a picture of an elephant.
 */
export const PRIMARY_PHOTO_GUIDANCE =
  "Use a clear photo of you. Save the scenery and the rest for your showcase.";

/** Photos in display order, primary first. Defensive: never mutates input. */
export function orderedPhotos(photos: readonly LinkrPhoto[]): LinkrPhoto[] {
  return [...photos].sort((a, b) => a.position - b.position);
}

export function primaryPhoto(photos: readonly LinkrPhoto[]): LinkrPhoto | null {
  return photos.find((photo) => photo.position === PRIMARY_SLOT) ?? null;
}

/** The lowest free slot, or null when full. Reuses gaps rather than appending. */
export function nextLinkrPhotoSlot(photos: readonly LinkrPhoto[]): number | null {
  const taken = new Set(photos.map((photo) => photo.position));
  for (const slot of LINKR_PHOTO_SLOTS) {
    if (!taken.has(slot)) return slot;
  }
  return null;
}

/**
 * Slot assignments after promoting one photo to primary.
 *
 * A SWAP, not a shuffle. Promoting showcase 2 sends the old primary to slot 2,
 * so the other photos keep the positions their owner chose. Returns the full
 * intended arrangement so the caller can apply it as one atomic update rather
 * than a sequence that is briefly invalid.
 */
export function promoteToPrimary(
  photos: readonly LinkrPhoto[],
  photoId: string
): Array<{ id: string; position: number }> | null {
  const target = photos.find((photo) => photo.id === photoId);
  if (!target) return null;
  if (target.position === PRIMARY_SLOT) return [];

  const current = photos.find((photo) => photo.position === PRIMARY_SLOT);
  const moves = [{ id: target.id, position: PRIMARY_SLOT }];
  if (current) moves.push({ id: current.id, position: target.position });
  return moves;
}

/**
 * Slot assignments after removing a photo.
 *
 * Closes the gap so the remaining photos occupy 0..n-1. Without this, deleting
 * the primary would leave a card whose first photo is in slot 1 and whose
 * "primary" is nothing -- a state the rest of the product would have to keep
 * special-casing forever.
 */
export function compactAfterRemoval(
  photos: readonly LinkrPhoto[],
  removedId: string
): Array<{ id: string; position: number }> {
  return orderedPhotos(photos)
    .filter((photo) => photo.id !== removedId)
    .map((photo, index) => ({ id: photo.id, position: index }))
    .filter((move, index, all) => {
      const original = photos.find((photo) => photo.id === move.id);
      return original ? original.position !== all[index].position : false;
    });
}

/** Reordering to an explicit list of ids. Ignores ids that are not present. */
export function reorderPhotos(
  photos: readonly LinkrPhoto[],
  orderedIds: readonly string[]
): Array<{ id: string; position: number }> {
  const known = new Set(photos.map((photo) => photo.id));
  return orderedIds
    .filter((id) => known.has(id))
    .slice(0, MAX_LINKR_PHOTOS)
    .map((id, index) => ({ id, position: index }));
}

// ---------------------------------------------------------------------------
// Photo navigation inside a candidate card.
// ---------------------------------------------------------------------------

/**
 * Tap-to-navigate. Clamps at both ends rather than wrapping: a card that jumps
 * from the last photo back to the first reads as a card that was dismissed,
 * which is the one misreading this interaction cannot afford given that a
 * horizontal swipe on the same surface decides about the person.
 */
export function nextPhotoIndex(current: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(current + 1, total - 1);
}

export function previousPhotoIndex(current: number): number {
  return Math.max(current - 1, 0);
}

/**
 * Which half of the card was tapped. The left third is "back" and the rest is
 * "forward": forward is the common action, so it gets the larger target.
 */
export function tapZone(offsetX: number, width: number): "previous" | "next" {
  if (width <= 0) return "next";
  return offsetX < width / 3 ? "previous" : "next";
}
