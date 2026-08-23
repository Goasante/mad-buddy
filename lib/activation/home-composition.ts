import { hasReachedFirstValue, type ActivationState } from "@/lib/activation/state";
import { deriveHomeMaturity, type HomeMaturity } from "@/lib/activation/home-maturity";

/**
 * What Home shows while activation is still teaching.
 *
 * ONE AUTHORITY FOR THE NEXT STEP. Activation asked somebody to turn on Glow
 * while, one scroll below, the Near module said "Visibility is paused" and
 * Trending offered events -- three surfaces explaining proximity in three
 * vocabularies on the screen where the concept is being introduced. The
 * activation card is the authority, so the modules that would restate or
 * distract from its instruction stand aside until it has receded.
 *
 * SUPPRESSED, NOT DELETED. Every module below returns for a mature Home. This
 * is a composition rule about *when* something is the most useful thing on the
 * screen, not a judgement that it should not exist.
 *
 * DERIVED FROM STATE, NEVER FROM COPY. Reading a headline back out of the DOM
 * to decide layout would make the words load-bearing: rewording a sentence
 * would silently change what renders underneath it.
 */

export type HomeCompositionInputs = {
  /** The activation card's state. Null once activation has nothing to say. */
  activationState: ActivationState | null;
  /** True while the first-Muddy moment is being acknowledged. */
  acknowledgingFirstMuddy: boolean;
  /** Milestones this person has ever reached. */
  milestones: ReadonlySet<string>;
  /** A live Safe Arrival or journey card. Safety outranks activation. */
  hasSafetyCard: boolean;
  /** Commitments that already exist, host or attendee. */
  upcomingPlanCount: number;
  /** Direct conversations where both people have written. */
  twoSidedConversationCount: number;
  /** Plans this person is on, past or upcoming. */
  planParticipationCount: number;
  /** Live, mutual Muddies. */
  muddyCount: number;
  /**
   * Another Muddy nobody has spoken to, excluding the hero relationship.
   *
   * Supplied by selectRelationshipFocus, which already excluded the person the
   * card above is about -- so the next step can never restate the hero.
   */
  nextUnspokenMuddy: { id: string; displayName: string; avatarUrl: string | null } | null;
  /**
   * What the hero relationship card is already offering.
   *
   * NO FRIENDSHIP HOMEWORK. "Say hi to Ama" above "Say hi to Kojo" turns Home
   * into a queue of social obligations. When the hero is itself an unspoken
   * relationship, another one underneath adds nothing -- one at a time during
   * early use, and the next person becomes worth suggesting once the first has
   * moved on.
   */
  heroPrimaryAction?: string;
  /** Profile details still missing, e.g. ["photo"]. Empty when complete. */
  missingProfileItems: readonly string[];
  /**
   * Direct conversations with something unread in them (MB-GOD-052).
   *
   * A LIVE SOCIAL FACT, and the only input here that represents another person
   * actively waiting. Home previously could not see it at all: the count lived
   * only in the navigation badge, so a returning user was offered
   * "Complete your profile, 3 steps left" while a real message sat unanswered
   * one tap away. Measured across four states, Home with an unread message and
   * Home with none rendered identically.
   *
   * Used to SUPPRESS setup nudges, not to add a module. The rule this file
   * already states -- "profile administration must never outrank a
   * relationship" -- simply had no way to know a relationship was active.
   */
  unreadConversationCount: number;
};

/**
 * ONE next step, chosen deterministically.
 *
 * "Suggestions for you" showed UpFor, Invite Friends and Find Muddies at equal
 * weight, which reads as "here are three features" rather than "here is what
 * would help". At most one appears, and which one is a stated rule.
 */
/* Only the outcomes current product state genuinely justifies.
 *
 * `find_muddies` and `complete_profile` were removed rather than left
 * unreachable: searching a network duplicates the header's Add Muddy entry,
 * and profile administration must never outrank a relationship. Dead options
 * in a union invite somebody to wire them back without the reasoning. */
export type NextBestAction = "invite_muddy" | "say_hi_to_muddy" | null;

export type HomeComposition = {
  /** The Near section: avatars when someone is around, guidance when not. */
  showNearby: boolean;
  /** Trending events. Discovery, and the first thing to yield. */
  showTrending: boolean;
  /** The "no plans yet" placeholder. Real plans are decided separately. */
  showPlansEmpty: boolean;
  /** Generic suggestion rails and gap fillers. */
  showSuggestions: boolean;
  /**
   * The Journey Smart Card — a SECOND activation system.
   *
   * Its steps include "Turn On Visibility", so during first-Glow activation it
   * renders the same instruction as the activation card, in different words,
   * pointing at a different destination. A live Safe Arrival is a different
   * card and is never covered by this flag.
   */
  showJourneyCard: boolean;
  /** Moments: sharing, which comes after the relationship loop. */
  showMoments: boolean;
  /** Profile completion nudges. */
  showProfileReminder: boolean;
  /**
   * The single next-growth action, or null.
   *
   * Replaces the three-tile feature rail for anybody who is not yet
   * established. Null means Home has nothing worth suggesting, which is a
   * legitimate answer -- whitespace beats a filler card.
   */
  nextBestAction: NextBestAction;
};

/** Everything on, for a Home with no activation guidance left to give. */
const MATURE: HomeComposition = {
  showNearby: true,
  showTrending: true,
  showPlansEmpty: true,
  showSuggestions: true,
  showJourneyCard: true,
  showMoments: true,
  showProfileReminder: true,
  nextBestAction: null
};

/**
 * States where activation is still teaching a first concept.
 *
 * `muddy_nearby` is deliberately absent: somebody they know is actually around,
 * which is the payoff activation exists to produce. Home opens back up there.
 */
const EARLY_STATES: ReadonlySet<ActivationState> = new Set<ActivationState>([
  "no_muddies",
  "request_pending",
  "muddies_no_location",
  "visibility_off",
  "location_stale",
  /* CONFIGURING GLOW IS NOT FIRST VALUE.
   *
   * This state used to end activation, so the moment somebody turned
   * visibility on, "Complete Profile" and the rest of Home came back -- the
   * app congratulating itself for a settings change. Nothing social has
   * happened yet: no wave, no message, no plan. `hasReachedFirstValue` below
   * is what actually closes activation, so a person who HAS done those things
   * still gets their ordinary Home on a quiet evening. */
  "no_one_nearby"
]);

/**
 * Is activation still the main guide on this screen?
 *
 * MILESTONE EVIDENCE, NOT A MUDDY COUNT. Somebody with one Muddy may have been
 * here for months -- plans, messages, a Journey -- and hiding their Home
 * because a number is low would punish them for having a small circle. The
 * question is whether this person has ever reached first value, not how many
 * people they know.
 */
export function isEarlyActivation(input: HomeCompositionInputs): boolean {
  // The first-Muddy acknowledgement is an early moment by definition: it only
  // fires within hours of the milestone.
  if (input.acknowledgingFirstMuddy) return true;
  if (input.activationState === null) return false;
  if (!EARLY_STATES.has(input.activationState)) return false;
  /* Already arrived somewhere. A returning person who has waved or made a plan
   * gets their ordinary Home even while one prompt is showing -- the prompt is
   * useful, but it is no longer the only thing they came for. */
  return !hasReachedFirstValue(input.milestones);
}

/**
 * Can Home make a claim about who is around at all?
 *
 * TWO DIMENSIONS, NOT ONE. Maturity answers "how much of Mad Buddy should this
 * person be shown"; this answers "what may Mad Buddy truthfully say about
 * proximity". They are independent, and folding the second into the first is
 * what produced the contradiction: the early-value branch let Near render for
 * every state except `no_one_nearby`, so a stale viewer saw "Refresh your Glow"
 * above "No trusted Muddies nearby" -- the app declaring a position too old to
 * judge, then judging with it.
 *
 * A stale fix means proximity is UNKNOWN, not that proximity was evaluated and
 * nobody qualified. The states below are the ones where Home has no standing
 * to say either way; the freshness rule itself lives in the proximity module
 * and is not restated here.
 */
const PROXIMITY_UNKNOWN_STATES: ReadonlySet<ActivationState> = new Set<ActivationState>([
  // Too old to support a claim -- the canonical 30-minute rule already decided.
  "location_stale",
  // Never set up: nothing to compute a distance from.
  "muddies_no_location",
  /* Invisible, and the card says so. Near's empty state would answer with
   * "turn on your Glow", which is the same instruction in weaker words. */
  "visibility_off"
]);

/**
 * Whether the Nearby surface may render, on truth grounds alone.
 *
 * Deliberately separate from maturity so every branch consults one rule
 * instead of each remembering the list of states for itself.
 */
export function proximityAllowsNearby(input: HomeCompositionInputs): boolean {
  if (input.activationState === null) return true;
  return !PROXIMITY_UNKNOWN_STATES.has(input.activationState);
}

/**
 * The one next-growth step, chosen by a rule rather than a rail.
 *
 * ORDERED BY WHAT THE ACCOUNT ACTUALLY LACKS. A person with one Muddy needs
 * more people before they need anything else -- Glow, Plans and Nearby all pay
 * off in proportion to who is in the circle. A photo matters, but it is setup,
 * so it waits until the circle can carry the product.
 */
export function selectNextBestAction(input: HomeCompositionInputs): NextBestAction {
  /* USE THE CIRCLE BEFORE GROWING IT.
   *
   * Somebody who added three people and messaged one does not need a fourth --
   * two of their Muddies are still sitting there unspoken, and saying hello to
   * one of them is worth more than another invitation. The hero already
   * excluded itself from this candidate, so this can never restate the action
   * directly above it. */
  if (input.nextUnspokenMuddy && input.heroPrimaryAction !== "say_hi") {
    return "say_hi_to_muddy";
  }

  /* ONE MUDDY, ALREADY SPOKEN TO: growing the circle is genuinely the next
   * useful thing, because there is nobody else here to talk to. Not a quota --
   * the moment another relationship needs attention, the branch above wins. */
  if (input.muddyCount <= 1) return "invite_muddy";

  /* SEVERAL RELATIONSHIPS, ALL UNDERWAY -- and nothing additive to say.
   *
   * The hero already carries the conversation and Make a Plan, and inviting
   * more people while the existing ones are active is collection rather than
   * connection. Profile completion is administration: it must not outrank
   * relationships, and it is reachable from Profile whenever somebody wants
   * it. Home is allowed to end; whitespace is the honest answer. */
  return null;
}

/**
 * A waiting person outranks a setup nudge (MB-GOD-052).
 *
 * This file already states the rule -- "profile administration must never
 * outrank a relationship" -- but had no way to know a relationship was active:
 * `unread` existed only in the navigation badge, so Home offered
 * "Complete your profile, 3 steps left" while a real message sat unanswered.
 * Measured across four states, Home with an unread message and Home without one
 * rendered identically.
 *
 * SUPPRESSION, NOT A NEW MODULE. Home does not gain an inbox, a count or a
 * message preview -- the brief's own line is that Home must orient rather than
 * summarise, and Messages already presents unread properly one tap away. What
 * changes is that Home stops asking for administration at the moment somebody
 * is waiting for a reply.
 *
 * DELIBERATELY NARROW. The Plan card, Near, and the Journey card are all
 * untouched: an imminent commitment still outranks an unread message (a Plan
 * has a time attached and the message does not), and proximity is a live fact
 * in its own right. Only setup yields.
 */
function suppressSetupWhileSomeoneWaits(
  composition: HomeComposition,
  input: HomeCompositionInputs
): HomeComposition {
  if (input.unreadConversationCount <= 0) return composition;
  return { ...composition, showProfileReminder: false, showJourneyCard: false };
}

export function composeHome(input: HomeCompositionInputs): HomeComposition {
  const maturity = deriveHomeMaturity({
    milestones: input.milestones,
    twoSidedConversationCount: input.twoSidedConversationCount,
    planParticipationCount: input.planParticipationCount,
    muddyCount: input.muddyCount
  });

  /* EARLY VALUE: the step Home was missing entirely.
   *
   * Sending one message used to unlock everything at once -- Trending, a
   * Journey campaign, three feature tiles and two profile prompts -- which
   * answered somebody's first hello with a catalogue. They have graduated from
   * onboarding, not into the whole product, so Home opens gradually: the
   * relationship stays the hero, real commitments still show, and exactly one
   * next step offers forward momentum.
   *
   * Checked BEFORE the nearby special-case below, because a quiet evening does
   * not make somebody experienced. */
  if (maturity === "early_value") {
    return {
      /* Near yields where the Glow card is already saying the room is empty,
       * AND wherever proximity is unknown -- a stale or unset location cannot
       * support "No trusted Muddies nearby". When somebody genuinely IS
       * around, the payoff renders. */
      showNearby: input.activationState !== "no_one_nearby" && proximityAllowsNearby(input),
      // Generic discovery must not outrank the person's own relationships.
      showTrending: false,
      showPlansEmpty: false,
      // Replaced by the single action below.
      showSuggestions: false,
      /* Journey is progression, and immediately after a first message it reads
       * as onboarding restarting -- an eight-step checklist answering a hello. */
      showJourneyCard: false,
      showMoments: false,
      /* The large Journey card and this small banner both campaigned for the
       * same task. Neither survives here: the profile ask, when it is genuinely
       * the most useful thing, arrives through nextBestAction instead. */
      showProfileReminder: false,
      nextBestAction: selectNextBestAction(input)
    };
  }

  /* ONE SURFACE MAY SAY "NOBODY IS AROUND", NOT TWO.
   *
   * `no_one_nearby` is NOT early activation -- setup succeeded, so the rest of
   * Home is welcome back. But the card and Near's empty state would then both
   * report an empty room, in different words, one above the other.
   *
   * The card wins here because it frames the emptiness as success ("Glow is
   * on") rather than as a shortage, and it is the surface that knows WHY the
   * room is empty. Near returns in full the moment it has somebody to show. */
  if (input.activationState === "no_one_nearby" && !isEarlyActivation(input)) {
    // Same single-profile-authority rule as the mature branch below; stating
    // it once here would have let the duplicate back in through this path.
    return suppressSetupWhileSomeoneWaits({
      ...MATURE,
      showNearby: false,
      showJourneyCard: input.missingProfileItems.length === 0
    }, input);
  }

  if (!isEarlyActivation(input)) {
    /* ONE PROFILE AUTHORITY, ENFORCED HERE RATHER THAN HOPED FOR.
     *
     * Two surfaces campaigned for the same task on one screen: the Journey
     * smart card ("Complete Profile / 20% / 8 steps remaining") and the small
     * banner ("Complete your profile / Add your photo"). Both were separately
     * correct and together were the app asking twice.
     *
     * The banner wins when both are eligible: it names the ONE next detail
     * instead of presenting an eight-step administrative checklist, and it
     * does not carry an illustration that pushes real content down. */
    /* Proximity truth applies to experienced people too.
     *
     * Being established says nothing about whether the last fix is current, so
     * this branch had the same contradiction waiting: "Refresh your Glow" above
     * "No trusted Muddies nearby". Maturity decides how much Home shows;
     * whether Home may speak about proximity is a separate question. */
    const mature = { ...MATURE, showNearby: proximityAllowsNearby(input) };
    if (input.missingProfileItems.length > 0) {
      return suppressSetupWhileSomeoneWaits({ ...mature, showJourneyCard: false }, input);
    }
    return suppressSetupWhileSomeoneWaits(mature, input);
  }

  return {
    /* Near is the exact duplicate. Its empty state says "Visibility is paused
     * / Turn visibility back on" -- the same instruction the activation card
     * is already giving, in different words, which reads as two systems
     * disagreeing about what to do next. */
    showNearby: false,
    // Discovery does not outrank a first relationship.
    showTrending: false,
    /* "No plans yet" is an absence dressed as a module. Somebody who has not
     * turned Glow on has no reason to be told they have made no plans. */
    showPlansEmpty: false,
    showSuggestions: false,
    /* TWO ACTIVATION SYSTEMS CANNOT BOTH BE THE GUIDE.
     *
     * The Journey card's own comment calls it "the activation card", and its
     * "Turn On Visibility" step sends people to /settings/glow-visibility
     * while the card above sends them to /settings. Deferring its styling was
     * not enough -- a quieter card giving a competing instruction is still a
     * competing instruction. Safe Arrival is a separate card and unaffected. */
    showJourneyCard: false,
    // Sharing a Moment presumes the relationship loop this screen is still
    // teaching. It returns once Glow has actually paid off.
    showMoments: false,
    /* A profile nudge is setup, not value -- and it competes for the single
     * action this screen is asking for. */
    showProfileReminder: false,
    // Activation already owns the single next step; a second one would compete.
    nextBestAction: null
  };
}

/**
 * UpFor is a Glow concept, and Glow has not happened yet.
 *
 * "Let your Muddies know you are free right now" only means something once
 * somebody can actually see you -- teaching it before the first Glow explains
 * a feature whose value depends on the step still being asked for. Invite and
 * Find Muddies stay: both grow the circle, which is the same direction.
 *
 * Returns hrefs to hide, reusing the rail's existing `hiddenHrefs` filter
 * rather than introducing a second way to vary that list.
 */
export function earlyActivationHiddenActionHrefs(input: HomeCompositionInputs): string[] {
  return isEarlyActivation(input) ? [UPFOR_HREF] : [];
}

/** The canonical UpFor entry point, as the first-time rail links to it. */
const UPFOR_HREF = "/hangout-mode";

/**
 * Should a REAL commitment still show?
 *
 * Yes, always. Suppressing an empty-state placeholder is composition; hiding a
 * plan somebody actually made would be destroying information they are relying
 * on. Being new is not a reason to forget what you agreed to.
 */
export function showsRealPlans(input: HomeCompositionInputs): boolean {
  return input.upcomingPlanCount > 0;
}

/**
 * Safety is never suppressed.
 *
 * A live Safe Arrival journey outranks every activation prompt: the worst
 * outcome of showing it early is a slightly busier screen, and the worst
 * outcome of hiding it is somebody not knowing a person is travelling.
 */
export function showsSafetyCard(input: HomeCompositionInputs): boolean {
  return input.hasSafetyCard;
}
