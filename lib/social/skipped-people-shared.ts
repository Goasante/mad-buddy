/**
 * Skip-recovery shapes and formatting, safe on the client.
 *
 * Split from `skipped-people.ts` because that module is "server-only": it
 * builds the admin client, and importing the label helper from a client
 * component dragged the service-role key's module into the browser bundle.
 * Types and pure formatting have no business being server-only.
 */

export type SkippedPerson = {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  /** When the skip lapses on its own. */
  expiresAt: string;
};

/**
 * "Back in 12 days", in words.
 *
 * The expiry is a real promise the product makes, so it is stated rather than
 * left for someone to discover. Rounded up: "back in 1 day" is friendlier and
 * more honest than "back in 0 days" for something happening tomorrow.
 */
export function skipExpiryLabel(expiresAt: string, now = Date.now()): string {
  const msLeft = Date.parse(expiresAt) - now;
  if (!Number.isFinite(msLeft) || msLeft <= 0) return "Back now";

  const days = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
  if (days <= 1) return "Back tomorrow";
  return `Back in ${days} days`;
}
