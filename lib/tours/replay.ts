/**
 * Manual replay session.
 *
 * ROOT CAUSE this exists to fix: replay used to mount TourRunner inside the
 * /settings/walkthrough page. Step 1 of the main walkthrough declares
 * route "/dashboard", so the tour's own first navigation unmounted the page
 * that was hosting it, and the tour vanished after one step. It looked like the
 * tour "cut off"; in fact the component had been destroyed.
 *
 * The fix mirrors draft preview: the session is a cookie, and the tour is
 * rendered by TourHost in the (app) layout, which survives client navigation.
 * A cookie rather than a module-global or React state, because the whole point
 * is to outlive component unmounts and full page loads.
 */

export const TOUR_REPLAY_COOKIE = "mb_tour_replay";

/** A replay is a few minutes of clicking; it should not linger. */
export const TOUR_REPLAY_MAX_AGE_SECONDS = 60 * 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The cookie carries only a version id, and confers nothing: the server still
 * confirms the version is PUBLISHED and readable before loading it, so this
 * cannot be used to reach a draft.
 */
export function decodeTourReplay(value: string | undefined): string | null {
  if (!value || !UUID.test(value)) return null;
  return value;
}
