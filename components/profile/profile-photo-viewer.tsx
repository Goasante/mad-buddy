"use client";

import { createPortal } from "react-dom";

import { MomentMediaViewer } from "@/components/content/moment-media-viewer";
import { profilePhotoAltText, rotatePhotosToTapped } from "@/lib/profile/photo-labels";
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
 * PROFILE-SPECIFIC MOUNTING RULE:
 * Profile photos often live inside a `Card`, whose glass treatment uses
 * backdrop-filter. Browsers establish a containing context for fixed descendants
 * of filtered/backdrop-filtered ancestors, which trapped the supposedly fixed
 * media viewer inside the Profile card on mobile. The result was exactly what
 * it looked like: Profile chrome, interests and bottom navigation remained on
 * screen while the close button and arrows were positioned relative to the card.
 *
 * Portalling this already-authorised viewer to document.body keeps the shared
 * media architecture while making `fixed inset-0` mean the actual viewport.
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
  /**
   * Already filtered by the server for this viewer.
   *
   * Narrowed to the two fields this adapter actually reads. A ProfilePhoto
   * satisfies it, and so does the combined avatar+showcase sequence, which has
   * no per-photo visibility of its own to declare -- the avatar is the face the
   * Profile already shows, and the showcases were filtered before they got
   * here. Asking for a `visibility` this component never consults would mean
   * inventing one at every call site.
   */
  photos: ReadonlyArray<{ id: string; url: string }>;
  /** Which photo was tapped. */
  activeIndex: number;
  ownerName: string;
  isOwner: boolean;
  open: boolean;
  onClose: () => void;
}) {
  if (!open || photos.length === 0 || typeof document === "undefined") return null;

  /**
   * Showcase is its own visual set.
   *
   * The Profile overview passes avatar + showcases so the avatar can still open
   * the broader sequence from the identity photo. But when somebody explicitly
   * taps a showcase tile, counting the avatar as "1 of 4" makes a three-photo
   * Showcase feel like it secretly contains a fourth item. If the synthetic
   * avatar leads and the tapped index is beyond it, remove only that synthetic
   * entry for this viewing session and translate the tapped index back by one.
   *
   * No URL is added here; we only narrow an already-authorised array.
   */
  const avatarLeads = photos[0]?.id === "avatar:identity";
  const openedFromShowcase = avatarLeads && activeIndex > 0;
  const visiblePhotos = openedFromShowcase ? photos.slice(1) : photos;
  const requestedIndex = openedFromShowcase ? activeIndex - 1 : activeIndex;
  const start = Math.min(Math.max(requestedIndex, 0), visiblePhotos.length - 1);

  /**
   * A Profile photo, expressed as the viewer's content shape.
   *
   * Only the fields the viewer actually reads are meaningful; the rest carry
   * neutral values rather than invented ones. The author/time footer is hidden
   * (`hideIdentity`), so no name or timestamp is fabricated for a photo that
   * has neither -- the Profile itself is the context.
   */
  const asViewerItem = (photo: { id: string; url: string }): VisibleMoment =>
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
  const sequence = visiblePhotos.map((photo) => asViewerItem(photo));
  const rotated = rotatePhotosToTapped(sequence, start);

  return createPortal(
    <MomentMediaViewer
      moment={rotated[0]}
      sequence={rotated}
      open={open}
      onClose={onClose}
      hideIdentity
      altText={profilePhotoAltText(ownerName, isOwner, start + 1, visiblePhotos.length)}
    />,
    document.body
  );
}
