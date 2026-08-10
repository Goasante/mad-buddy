/**
 * A fake address book, for development only.
 *
 * WHY THIS EXISTS: the web Contact Picker is Chromium-on-Android only, so on a
 * desktop the supported path -- choose contacts, match, results, add a Muddy --
 * cannot be reached at all. Without a fixture the primary experience can only
 * be seen by sideloading onto a phone, which means it goes unreviewed, and an
 * unreviewed screen is the one that ships broken.
 *
 * WHAT IT IS NOT: a bypass. It stands in for the DEVICE PICKER and nothing
 * else. The numbers below are fake, they still go to the real endpoint, and
 * that endpoint still applies every rule it always did -- HMAC derivation, the
 * batch floor, rate limiting, discovery eligibility, blocks and ghost/deleted
 * filtering. Matching fake numbers therefore returns nobody unless a developer
 * has deliberately registered one of them on their own local database, which is
 * exactly the point: the UI is exercised, the security model is not touched.
 *
 * HOW IT IS KEPT OUT OF PRODUCTION: `process.env.NODE_ENV` is inlined by the
 * bundler at build time, so in a production build `demoContactsAvailable()`
 * folds to `false` and everything below it is dead code the minifier removes.
 * There is no runtime flag, no header, no query parameter and no localStorage
 * key that can turn this on in a deployed build -- if there were, it would be a
 * way to make a production client believe it had contacts it does not have.
 */

export type DemoContact = {
  name: string;
  /** Fake. See RESERVED RANGES below. */
  phoneNumber: string;
};

/**
 * Names and numbers that cannot belong to anyone.
 *
 * The numbers use +1 555 01xx, the range reserved for fiction precisely so
 * test data cannot ring a real person. Ghanaian names, because that is the
 * audience this UI is designed for and a results list of Anglo placeholders
 * would not show what the real screen looks like.
 *
 * Six entries, which is one above MIN_CONTACT_BATCH -- so selecting all of
 * them clears the floor, and deselecting two puts the too-few error on screen
 * where it can also be reviewed.
 */
export const DEMO_CONTACTS: readonly DemoContact[] = [
  { name: "Kofi Mensah", phoneNumber: "+15550100" },
  { name: "Ama Boateng", phoneNumber: "+15550101" },
  { name: "Yaw Owusu", phoneNumber: "+15550102" },
  { name: "Efua Asare", phoneNumber: "+15550103" },
  { name: "Joe Mensah", phoneNumber: "+15550104" },
  { name: "Abena Owusu", phoneNumber: "+15550105" }
];

/**
 * Whether the demo picker may be offered.
 *
 * Compiled away in production. Deliberately reads the env directly rather than
 * through a helper: the literal `process.env.NODE_ENV !== "production"` is the
 * form bundlers recognise for dead-code elimination, and routing it through an
 * indirection would keep the fixture in the shipped bundle.
 */
export function demoContactsAvailable(): boolean {
  return process.env.NODE_ENV !== "production";
}
