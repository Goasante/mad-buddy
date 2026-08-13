/**
 * Event cover rules (Stage F, Part A).
 *
 * PURE. No database, no storage, no clock of its own -- the publish gate has
 * to be assertable as arithmetic, because it is the rule that decides whether
 * a public discovery surface can show a broken card. The server action calls
 * these; so does the UI, so both agree on what "ready to publish" means.
 */

/** Statuses that put an event in front of people who did not create it. */
export const PUBLISHED_EVENT_STATUSES = ["scheduled", "active"] as const;
export type PublishedEventStatus = (typeof PUBLISHED_EVENT_STATUSES)[number];

export function isPublishedStatus(status: string): status is PublishedEventStatus {
  return (PUBLISHED_EVENT_STATUSES as readonly string[]).includes(status);
}

/**
 * What the server must know about a candidate cover before allowing publish.
 *
 * `ownerId` and `contextType` are here because a cover is not merely "some
 * media id that exists": a client could otherwise send the id of somebody
 * else's asset, or of a chat attachment, and have the event display it.
 */
export type CoverAssetFacts = {
  ownerId: string;
  contextType: string;
  processingStatus: string;
  moderationStatus: string;
  deletedAt: string | null;
};

export type CoverRejection =
  | "missing"
  | "not_owned"
  | "wrong_context"
  | "not_ready"
  | "moderated"
  | "deleted";

export type CoverCheck = { ok: true } | { ok: false; reason: CoverRejection };

/**
 * Is this asset a valid cover for this event host?
 *
 * Order matters for the message the creator sees: ownership and context are
 * structural problems ("this isn't yours"), while not_ready is transient
 * ("still processing, try again in a moment").
 */
export function checkCoverAsset(
  asset: CoverAssetFacts | null,
  hostId: string
): CoverCheck {
  if (!asset) return { ok: false, reason: "missing" };
  if (asset.ownerId !== hostId) return { ok: false, reason: "not_owned" };
  if (asset.contextType !== "event") return { ok: false, reason: "wrong_context" };
  if (asset.deletedAt) return { ok: false, reason: "deleted" };
  // Only 'active' may be shown. under_review/restricted/removed must never
  // reach a public ranked surface.
  if (asset.moderationStatus !== "active") return { ok: false, reason: "moderated" };
  if (asset.processingStatus !== "ready") return { ok: false, reason: "not_ready" };
  return { ok: true };
}

export function coverRejectionMessage(reason: CoverRejection): string {
  switch (reason) {
    case "missing":
      return "Add an Event cover image before publishing.";
    case "not_owned":
    case "wrong_context":
      return "That image can't be used as this Event's cover. Upload a new one.";
    case "deleted":
      return "That cover image is no longer available. Upload a new one.";
    case "moderated":
      return "That image can't be used as a cover. Upload a different one.";
    case "not_ready":
      return "That image is still processing. Try again in a moment.";
  }
}

/**
 * The publish gate itself (§2, server-authoritative).
 *
 * A DRAFT may exist with no cover. Publishing may not. Note what this does
 * NOT do: it never inspects an existing published event, so a legacy event
 * that predates the rule is untouched and stays viewable -- the rule governs
 * the TRANSITION into a published state, not every row.
 */
export function canPublishEvent(input: {
  targetStatus: string;
  cover: CoverCheck;
}): CoverCheck {
  if (!isPublishedStatus(input.targetStatus)) return { ok: true };
  return input.cover;
}

/**
 * Focal point, clamped.
 *
 * Values arrive from a drag interaction and from the database. Both are
 * clamped rather than trusted: a NaN or an out-of-range number would become
 * an `object-position` the browser silently ignores, putting the subject
 * somewhere other than where the creator placed it.
 */
export const DEFAULT_FOCAL_POINT = { x: 0.5, y: 0.5 } as const;

export function clampFocal(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.min(1, Math.max(0, numeric));
}

/** CSS object-position for a focal point. One definition, every surface. */
export function focalObjectPosition(focalX: number, focalY: number): string {
  return `${clampFocal(focalX) * 100}% ${clampFocal(focalY) * 100}%`;
}

/**
 * Creator guidance (§4). Portrait, because the Home accordion panel is tall.
 *
 * Deliberately NOT a hard pixel requirement: rejecting a 1180x1470 photo for
 * being 20px short would be hostile. The minimum below is about having enough
 * resolution to look right on a high-DPI phone, nothing more.
 */
export const COVER_GUIDANCE = {
  aspectRatioLabel: "4:5",
  suggestedWidth: 1200,
  suggestedHeight: 1500,
  /**
   * Enough pixels to look sharp on a high-DPI phone, measured as AREA rather
   * than per-edge.
   *
   * THE BUG THIS REPLACES. The rule was `width >= 600 && height >= 750`, which
   * requires each edge independently -- and since 750 > 600 it quietly demanded
   * a portrait-shaped image. A 1600x720 screenshot is 1.15 megapixels and was
   * rejected as "too small to look sharp"; so was 1024x640. Nothing was small
   * about them, they were simply landscape.
   *
   * Area plus a modest floor on the shorter edge accepts real photographs of
   * any orientation while still refusing images that genuinely cannot render
   * sharply. The focal point decides how each shape is cropped per surface.
   */
  minPixels: 750_000,
  minShortEdge: 600
} as const;

export function coverDimensionError(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "That image couldn't be read. Try another one.";
  }

  // A very long, very thin image can clear the area bar while being unusable
  // in a card, so the short edge carries its own floor.
  if (Math.min(width, height) < COVER_GUIDANCE.minShortEdge) {
    return "That image is too small to look sharp. Choose a larger one.";
  }

  if (width * height < COVER_GUIDANCE.minPixels) {
    return "That image is too small to look sharp. Choose a larger one.";
  }

  return null;
}
