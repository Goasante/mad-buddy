/**
 * The narrow slices of Home's newer domains that the Smart Card providers need.
 *
 * Declared here, away from the readers that produce them, for the same reason
 * `linkr-context.ts` exists: the providers are PURE and must not import a
 * "server-only" module, so importing these types from their services would drag
 * the services into the client bundle.
 *
 * Each type is deliberately narrow. A provider can only render what it is
 * given, so the smallest honest shape is also the privacy boundary -- there is
 * no date of birth here, no coordinates, no message text, and no consent state
 * that Home could act on rather than merely point at.
 */

/**
 * An Event the viewer is checked in to and has NOT yet answered Event Linkr for.
 *
 * Produced only when the Events authority returns `no_consent` against a live
 * check-in. It carries a name and a link and nothing else: Home offers the
 * decision and the Event screen owns making it.
 */
export type EventLinkrOfferForCard = {
  eventId: string;
  eventName: string;
  /** The canonical Event surface, where the real opt-in control lives. */
  href: string;
};

/**
 * A Muddy whose birthday the viewer has ALREADY been notified about today.
 *
 * Derived from the birthday delivery ledger, so its existence is itself the
 * proof that the owner's privacy settings permitted telling this viewer. No
 * date of birth reaches this type, and none is read to build it.
 */
export type MuddyBirthdayForCard = {
  userId: string;
  displayName: string;
};

/**
 * An open Plan poll the viewer is eligible to vote in and has not voted in.
 *
 * `voterCount` is how many people have answered so far -- a fact about the
 * decision's progress, not about any individual's choice.
 */
export type PlanDecisionForCard = {
  planId: string;
  planTitle: string;
  question: string;
  voterCount: number;
};

/**
 * An open poll inside a Plan Chat the viewer is a member of, unanswered by them.
 *
 * A STRUCTURED decision, never message text. This exists so Home can say "the
 * venue is being decided" without reading, classifying or previewing anything
 * anybody wrote.
 */
export type PlanChatDecisionForCard = {
  conversationId: string;
  planTitle: string | null;
  question: string;
};

/**
 * What Mad Buddy Access permits this viewer, reduced to the ONE question Home
 * asks: may they expand their social world right now?
 *
 * DELIBERATELY NARROWER THAN `AccessState`. The providers must not be able to
 * reason about sources, expiry dates or days remaining, because every one of
 * those invites a card that counts down, nags, or sells. `canExpand` is the
 * whole entitlement vocabulary Home gets.
 *
 * THE RULE THIS ENCODES, which is `lib/access/guard.ts`'s rule verbatim:
 * expiry stops the NEXT EXPANSION, it never destroys an EXISTING COMMITMENT.
 * So this flag gates only states that would start something new -- and never
 * an existing Linkr mutual, an UpFor already in flight, a Plan, a message, a
 * birthday, Safe Arrival or anything else in the free core.
 *
 * `hadWelcomeAccess` exists so copy can be honest about what ENDED rather than
 * implying Mad Buddy itself has stopped working.
 */
export type AccessForCard = {
  /** False when a gated expansion would be refused by the server anyway. */
  canExpand: boolean;
  /** True when this account once held Welcome Access, whatever its state now. */
  hadWelcomeAccess: boolean;
};

/**
 * A feature the viewer explicitly turned ON that their profile now blocks.
 *
 * Not profile completion. `requirement` is the canonical outstanding sentence
 * from the feature's own rules, so Home repeats that feature's answer rather
 * than inventing a second definition of "incomplete".
 */
export type BlockedFeatureForCard = {
  /** Product name, for copy: "Linkr". */
  feature: string;
  /** What is outstanding, in the feature's own words. */
  requirement: string;
  /** Where the person fixes it. */
  href: string;
};
