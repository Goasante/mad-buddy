/**
 * Linkr intent, and what it means for two people to be compatible.
 *
 * Client-safe (no `server-only`): the activation screen, the filter sheet and
 * the candidate policy all need the same vocabulary, and a second copy of it
 * would be a second answer to "is Dating compatible with Friends".
 */

export type LinkrIntent = "friends" | "dating" | "networking" | "anything";

export const LINKR_INTENTS: ReadonlyArray<{
  id: LinkrIntent;
  label: string;
  hint: string;
}> = [
  { id: "friends", label: "Friends", hint: "People to hang out with." },
  { id: "dating", label: "Dating", hint: "Something romantic." },
  { id: "networking", label: "Networking", hint: "People to build with." },
  { id: "anything", label: "Anything", hint: "Open to whatever fits." }
];

export const LINKR_INTENT_LABELS: Record<LinkrIntent, string> = Object.fromEntries(
  LINKR_INTENTS.map((option) => [option.id, option.label])
) as Record<LinkrIntent, string>;

/**
 * Deliberately not `value in LINKR_INTENT_LABELS`: `in` walks the prototype
 * chain, so "toString" and "constructor" would both pass and be written
 * straight into an intent column. Own-property only.
 */
export function isLinkrIntent(value: unknown): value is LinkrIntent {
  return typeof value === "string" && Object.hasOwn(LINKR_INTENT_LABELS, value);
}

/**
 * The v1 compatibility matrix.
 *
 * SYMMETRIC BY CONSTRUCTION, and that is a product decision rather than an
 * implementation shortcut. An asymmetric rule -- "Dating sees Friends but
 * Friends does not see Dating" -- means one person is shown to somebody they
 * would never be shown in return. That is how a discovery product quietly
 * becomes a dating product for people who did not choose one, so it is not
 * allowed here. `assertSymmetric` below is exercised by the test suite.
 *
 * The rules, stated plainly:
 *
 *   friends    <-> friends      yes. Same ask.
 *   dating     <-> dating       yes. Same ask.
 *   networking <-> networking   yes. Same ask.
 *   anything   <-> anything     yes.
 *   anything   <-> any other    yes. "Anything" is a declaration of openness,
 *                               and the whole point of choosing it.
 *   friends    <-> dating       NO. The mismatch that matters most: somebody
 *                               looking for friends should not be shown to
 *                               somebody looking for a partner, in either
 *                               direction.
 *   friends    <-> networking   NO. Different rooms. Neither is harmed by the
 *                               other, but neither asked for it either.
 *   dating     <-> networking   NO. The mismatch with the worst failure mode.
 */
const COMPATIBILITY: Record<LinkrIntent, ReadonlyArray<LinkrIntent>> = {
  friends: ["friends", "anything"],
  dating: ["dating", "anything"],
  networking: ["networking", "anything"],
  anything: ["friends", "dating", "networking", "anything"]
};

/** Whether two people's declared intents allow them to see each other. */
export function areIntentsCompatible(a: LinkrIntent, b: LinkrIntent): boolean {
  return COMPATIBILITY[a].includes(b);
}

/**
 * The set of intents a viewer may be shown. Precomputed once per discovery
 * query and handed to the candidate filter, so compatibility is a set lookup
 * per candidate rather than a function call per candidate per intent.
 */
export function compatibleIntentsFor(intent: LinkrIntent): ReadonlyArray<LinkrIntent> {
  return COMPATIBILITY[intent];
}

/**
 * Proves the matrix is symmetric. Exported rather than kept in the test file
 * so the invariant travels with the rule it describes: anyone editing
 * COMPATIBILITY can see that symmetry is a requirement, not a coincidence.
 */
export function assertSymmetric(): boolean {
  const all: LinkrIntent[] = ["friends", "dating", "networking", "anything"];
  return all.every((a) => all.every((b) => areIntentsCompatible(a, b) === areIntentsCompatible(b, a)));
}
