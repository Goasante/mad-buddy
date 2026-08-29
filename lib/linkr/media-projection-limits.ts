/**
 * The Linkr card's photo ceiling, in a client-safe module.
 *
 * WHY THIS IS SPLIT OUT. `lib/linkr/media-projection.ts` is `server-only` --
 * it reads Profile media and signs private-bucket URLs, which must never be
 * importable from the browser. The candidate card is a client component and
 * needs the same number, and the alternative was to re-type "3" (or "4") in
 * the component. That is exactly how the card came to clamp to three photos
 * while the projection assembled four: two places holding one number, and they
 * disagreed.
 *
 * So the NUMBER lives here, and the server projection imports it too. One
 * value, no server code reachable from the client.
 */

/**
 * The most images a Linkr card will ever show: the profile picture plus the
 * three showcase slots Profile allows (profile_photos.position is constrained
 * to 0..2 in the schema).
 */
export const MAX_LINKR_CARD_PHOTOS = 4;
