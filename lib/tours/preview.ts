/**
 * Draft preview session.
 *
 * Preview has to run inside the CONSUMER app shell, because route-aware steps
 * navigate to real routes and spotlight real elements — an admin-page harness
 * could not do that without duplicating the renderer. So the "I am previewing
 * version X" fact has to survive arbitrary client navigations.
 *
 * It is carried in an httpOnly cookie rather than a query string for two
 * reasons: a query param is lost the moment a step calls router.push, and a
 * param would be the only thing standing between a consumer and draft content.
 * The cookie names a version; it grants nothing. Every render re-checks
 * `admin.tours.manage` server-side before loading draft content, so possessing
 * the cookie is useless without the permission.
 */

export const TOUR_PREVIEW_COOKIE = "mb_tour_preview";

/** Short-lived by design: a preview session is a few minutes of clicking. */
export const TOUR_PREVIEW_MAX_AGE_SECONDS = 60 * 30;

export type TourPreviewSession = {
  versionId: string;
  /** Admin editor to return to on exit, so Exit never dumps them elsewhere. */
  returnTo: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Internal admin path only; never a protocol, host or protocol-relative URL. */
const RETURN_PATH = /^\/admin\/[a-zA-Z0-9/_-]{0,120}$/;

export function encodeTourPreview(session: TourPreviewSession): string {
  return `${session.versionId}|${session.returnTo}`;
}

/**
 * Parses the cookie defensively. A malformed value yields null rather than
 * throwing, and the return path is re-validated on the way out so a tampered
 * cookie cannot turn Exit preview into an open redirect.
 */
export function decodeTourPreview(value: string | undefined): TourPreviewSession | null {
  if (!value) return null;
  const separator = value.indexOf("|");
  if (separator < 0) return null;

  const versionId = value.slice(0, separator);
  const returnTo = value.slice(separator + 1);
  if (!UUID.test(versionId)) return null;
  if (!RETURN_PATH.test(returnTo) || returnTo.includes("..")) return null;

  return { versionId, returnTo };
}

export function isValidPreviewReturnPath(value: string): boolean {
  return RETURN_PATH.test(value) && !value.includes("..");
}
