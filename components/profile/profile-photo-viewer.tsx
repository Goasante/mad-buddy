"use client";

import { MomentMediaViewer } from "@/components/content/moment-media-viewer";
import { profilePhotoAltText, rotatePhotosToTapped } from "@/lib/profile/photo-labels";
import type { ProfilePhoto } from "@/lib/profile/profile-photos";
import type { VisibleMoment } from "@/lib/content/service";

/**
 * Full-screen viewer for a Profile photo.
 *
 * ONE immersive viewer in Mad Buddy. Rather than building a third full-screen
 * layer, this adapts a Profile photo into the shape the existing viewer already
 * consumes -- exactly as MessageMediaViewer does for chat -- so a photo opened
 * from a Profile behaves like one opened from a Moment: swipe-down to dismiss,
 * Escape and hardware Back to close, focus trapped and restored, page scroll
 * locked underneath, and the image letterboxed rather than cropped.
 *
 * The adapter is deliberately thin and one-directional. It AUTHORISES NOTHING:
 * it is handed the very photos the carousel is already rendering, which the
 * server filtered for this viewer (see visiblePhotosFor -- `only_me` is never
 * read into memory for anyone but its owner). No userId, storage key or bucket
 * path crosses this boundary; only URLs the Profile projection already allowed.
 */
export function ProfilePhotoViewer({
  photos,
  activeIndex,
  ownerName,
  isOwner,
  open,
  onClose
}: {
  /** Already filtered by the server for this viewer. */
  photos: readonly ProfilePhoto[];
  /** Which photo was tapped. */
  activeIndex: number;
  ownerName: string;
  isOwner: boolean;
  open: boolean;
  onClose: () => void;
}) {
  if (!open || photos.length === 0) return null;

  const start = Math.min(Math.max(activeIndex, 0), photos.length - 1);

  /**
   * A Profile photo, expressed as the viewer's content shape.
   *
   * Only the fields the viewer actually reads are meaningful; the rest carry
   * neutral values rather than invented ones. The author/time footer is hidden
   * (`hideIdentity`), so no name or timestamp is fabricated for a photo that
   * has neither -- the Profile itself is the context.
   */
  const asViewerItem = (photo: ProfilePhoto): VisibleMoment =>
    ({
      id: photo.id,
      authorId: "",
      authorName: ownerName,
      authorAvatarUrl: null,
      authorPlan: "free",
      contentType: "photo",
      textContent: null,
      caption: null,
      mediaUrl: photo.url,
      expiresAt: "",
      createdAt: "",
      myReaction: null,
      reactionCount: 0,
      reactionBreakdown: {},
      isAuthor: isOwner,
      audienceLabel: null
    }) as VisibleMoment;

  /**
   * Rotated so the TAPPED photo leads, matching how the feed hands the viewer
   * its sequence. Next/previous then step through the rest of the same
   * authorised set in the Profile's own order.
   */
  const sequence = photos.map((photo) => asViewerItem(photo));
  const rotated = rotatePhotosToTapped(sequence, start);

  return (
    <MomentMediaViewer
      moment={rotated[0]}
      sequence={rotated}
      open={open}
      onClose={onClose}
      hideIdentity
      altText={profilePhotoAltText(ownerName, isOwner, start + 1, photos.length)}
    />
  );
}
