/**
 * Profile photo labels, shared by the carousel and the full-screen viewer.
 *
 * One definition, so the accessible name on a thumbnail and the one announced
 * in full screen cannot drift apart.
 */

/**
 * A safe, contextual alt text for a Profile photo.
 *
 * NEVER the filename or the storage key. An uploader's filename routinely
 * carries a person's name, a place, or a camera's own labelling, none of which
 * a visitor is entitled to and none of which the owner meant to publish. Whose
 * photo it is, and where it sits in the set, is the whole of what a screen
 * reader needs.
 */
export function profilePhotoAltText(
  ownerName: string,
  isOwner: boolean,
  position: number,
  total: number
): string {
  const which = total > 1 ? `Photo ${position} of ${total}` : "Photo";
  return isOwner ? `Your ${which.toLowerCase()}` : `${which} of ${ownerName}`;
}

/**
 * The authorised set, rotated so the TAPPED photo leads.
 *
 * The full-screen viewer always opens on the first item it is handed and steps
 * circularly from there, so rotating (rather than passing an index) is what
 * makes "tap the third photo, see the third photo" true while keeping the
 * Profile's own order intact for next/previous.
 *
 * Pure, and never grows or filters the set: what comes out is exactly what
 * went in, reordered. A caller cannot use this to reach a photo the server
 * did not already hand it.
 */
export function rotatePhotosToTapped<T>(photos: readonly T[], tappedIndex: number): T[] {
  if (photos.length === 0) return [];
  const start = Math.min(Math.max(tappedIndex, 0), photos.length - 1);
  return [...photos.slice(start), ...photos.slice(0, start)];
}
