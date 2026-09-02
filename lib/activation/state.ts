/**
 * What a new person needs next, derived rather than remembered.
 *
 * PURE. No database, no clock of its own, no React. Activation decides what
 * Home says to somebody on their first day, so it has to be assertable as
 * arithmetic rather than observed by signing up repeatedly.
 *
 * DERIVED, NEVER STORED AS A CURSOR. There is no "onboarding step 4" column,
 * deliberately. A stored cursor drifts the moment reality disagrees with it --
 * somebody adds a Muddy on another device, revokes location, or arrives back a
 * week later -- and then the app insists on a step they have already passed.
 * Every state below is a question about the world as it is right now, so
 * closing the app and returning cannot strand anyone.
 *
 * MILESTONES ARE EVIDENCE, NOT PERMISSION. `activation_milestones` records
 * what somebody has done, so it answers "have they ever" (has this person ever
 * made a Plan) rather than "may they proceed". Nothing here blocks: the app is
 * fully usable in every state, and activation only decides what to SAY.
 */

export type ActivationInputs = {
  /** Accepted, mutual Muddies. Requests in flight do not count. */
  muddyCount: number;
  /** Requests this person has sent that nobody has answered yet. */
  pendingOutgoingCount: number;
  /**
   * Location has been set up and worked at some point recently.
   *
   * Evidence the grant is real -- NOT a licence to claim who is nearby. See
   * `hasLocationSetupEvidence`.
   */
  locationGranted: boolean;
  /**
   * The viewer's own fix is current enough to answer "who is nearby".
   *
   * Held to the canonical proximity rule, the same one that hides a Muddy whose
   * signal has gone quiet. Distance needs both ends current.
   */
  locationFreshForProximity: boolean;
  /** Their own visibility choice. "ghost" is a deliberate answer, not a gap. */
  visibility: "visible" | "ghost" | "app_open_only";
  /** Muddies currently within a band worth surfacing. */
  nearbyMuddyCount: number;
  /** Plans that have not finished yet, host or attendee. */
  upcomingPlanCount: number;
  /** Milestones this person has ever reached. */
  milestones: ReadonlySet<string>;
};

/**
 * What Home leads with. Exactly one at a time.
 *
 * Ordered by urgency of the person's actual situation, not by a funnel: a
 * plan tonight matters more than discovery, and having nobody to see matters
 * more than not being visible.
 */
export type ActivationState =
  /** No Muddies yet. Nothing else can pay off until this is solved. */
  | "no_muddies"
  /**
   * A first request is out, waiting on the other person.
   *
   * Distinct from no_muddies because the person HAS acted, and telling them to
   * "start with one person" again would ignore what they just did.
   */
  | "request_pending"
  /**
   * Has a Muddy, but has never turned their own Glow on.
   *
   * SEPARATE FROM LOCATION. New profiles default to `ghost` -- most accounts in
   * production still are -- so the common path after a first Muddy is not
   * "location is off" but "visibility was never switched on". Merging the two
   * sent these people to a state that said nobody was around, when the real
   * answer was that they had never appeared themselves.
   */
  | "visibility_off"
  /** Has Muddies, but location is off, so Glow cannot do anything. */
  | "muddies_no_location"
  /**
   * Location works, but the last fix is too old to say who is around.
   *
   * NOT the same as nobody being nearby. "No Muddies are close by" is a social
   * claim about the world; a stale fix only supports "Mad Buddy cannot tell
   * right now". Saying the first when the second is true tells somebody their
   * friends are absent when the app has simply lost track of where they are --
   * and it is silently self-confirming, because the person stops looking.
   */
  | "location_stale"
  /** Visible and located, but nobody is around right now. */
  | "no_one_nearby"
  /** The payoff: somebody they know is nearby. */
  | "muddy_nearby"
  /** Something is already arranged. That outranks discovery. */
  | "upcoming_plan"
  /** Fully activated; Home behaves normally. */
  | "activated";

export function resolveActivationState(input: ActivationInputs): ActivationState {
  // A plan already arranged is the most concrete thing in the person's day,
  // so it outranks every discovery prompt below it.
  if (input.upcomingPlanCount > 0) return "upcoming_plan";

  // Nothing else is reachable without at least one Muddy: Glow has nobody to
  // show, and a Plan has nobody to invite.
  if (input.muddyCount === 0) {
    // They have already acted. Repeating "start with one person" would ignore
    // the request they just sent and imply it did not count.
    return input.pendingOutgoingCount > 0 ? "request_pending" : "no_muddies";
  }

  /* Location is asked for HERE and not before.
   *
   * Requesting it during signup buys a permission prompt at the exact moment
   * its value cannot be demonstrated -- there is nobody to see yet. Once a
   * Muddy exists, "see when they are around" is a sentence that means
   * something, and the ask has an answer. */
  if (!input.locationGranted) return "muddies_no_location";

  /* PERMISSION IS NOT VISIBILITY, and conflating them stranded most people.
   *
   * New profiles are created `ghost` -- deliberately, privacy first -- and in
   * production the majority of accounts still are. The previous rule skipped
   * anyone in ghost, so a brand-new person who added their first Muddy fell
   * through to "nobody is around", which was false: nobody could see them
   * because they had never appeared. The app blamed an empty room for a switch
   * it never offered to turn on.
   *
   * So ghost gets its own state, and it OFFERS rather than nags -- turning Glow
   * on stays their decision, and declining leaves the rest of the app intact. */
  if (input.visibility === "ghost") return "visibility_off";

  /* A STALE FIX CANNOT SUPPORT EITHER NEARBY ANSWER.
   *
   * Checked before both branches below, because an old position corrupts them
   * symmetrically: it can put somebody standing next to you outside range, or
   * report a Muddy "right here" who left hours ago. Neither is a claim the app
   * has earned, so it makes neither, and asks for a fresh fix instead.
   *
   * AFTER visibility, so somebody in ghost is still told the truer thing --
   * that they have never appeared -- rather than being sent to refresh a
   * location that would change nothing while they are invisible. */
  if (!input.locationFreshForProximity) return "location_stale";

  if (input.nearbyMuddyCount > 0) return "muddy_nearby";

  // Located, visible, and genuinely nobody around. That is an ordinary evening,
  // not a failure, and the copy for it should say so.
  if (input.muddyCount > 0 && !input.milestones.has("first_plan_created")) return "no_one_nearby";

  return "activated";
}

/**
 * The single strongest next action for a state.
 *
 * CONTEXTUAL, NOT A FUNNEL. "Make a Plan" is the wrong thing to push at
 * somebody with nobody nearby and no Muddies -- it is the app asking for a
 * commitment it has not earned. Each state gets the smallest action that is
 * genuinely useful in that situation, and Plans arrive when a Plan is actually
 * the natural next thing.
 */
export type ActivationAction =
  | "find_muddies"
  | "enable_location"
  /**
   * Ask for a new fix from a permission that already exists.
   *
   * DISTINCT FROM `enable_location`. That one is a first-time grant, with the
   * privacy explanation attached; this one is somebody who granted it long ago
   * whose position has simply gone quiet. Sending them back through the
   * permission talk would be the app forgetting they already said yes.
   */
  | "refresh_location"
  /** Turn your own Glow on. Distinct from granting the OS permission. */
  | "enable_visibility"
  | "wave"
  /** Open the real conversation and let them type. Never auto-send. */
  | "say_hi"
  | "message"
  | "make_plan"
  | "view_plan";

export function primaryActionFor(state: ActivationState): ActivationAction {
  switch (state) {
    case "no_muddies":
      return "find_muddies";
    case "request_pending":
      // Not "ask them again". Waiting is the correct thing to be doing, so the
      // useful move is widening the net rather than nudging one person twice.
      return "find_muddies";
    case "muddies_no_location":
      return "enable_location";
    case "visibility_off":
      return "enable_visibility";
    case "location_stale":
      return "refresh_location";
    case "muddy_nearby":
      // Somebody is around NOW. A wave is one tap and costs nothing; asking
      // for a Plan here skips the part where they say hello.
      return "wave";
    case "no_one_nearby":
      // Nobody to wave at, so the useful move is arranging something for when
      // people ARE free. This is where a Plan is genuinely the right ask.
      return "make_plan";
    case "upcoming_plan":
      return "view_plan";
    case "activated":
      return "message";
  }
}

/**
 * What to offer about ONE specific Muddy.
 *
 * A small, deterministic table -- not a recommendation engine. Every input is
 * something the product already knows for certain, and the same inputs always
 * give the same answer, so the button never changes underneath somebody
 * between renders.
 *
 * THE RULES, in priority order:
 *
 *   1. A shared plan already exists     -> open it. Something arranged
 *                                          outranks anything suggested.
 *   2. Never spoken before              -> say hi. A first message is the
 *                                          smallest real step, and waving at
 *                                          somebody you have never messaged
 *                                          is a gesture with no context.
 *   3. Nearby, and you have spoken      -> wave. One tap, no obligation, and
 *                                          it means something because they
 *                                          are actually around.
 *   4. Otherwise                        -> message. Always available, never
 *                                          wrong, and cheaper than asking
 *                                          for a commitment.
 *
 * Note what is NOT here: "make a plan" is deliberately absent as a per-person
 * primary. Pushing a commitment as the opening move with one new Muddy is the
 * app asking for more than the relationship has earned; Plans remain reachable
 * as a secondary action and as the primary for the quiet-evening state.
 */
export type MuddyContext = {
  hasSharedUpcomingPlan: boolean;
  hasExistingConversation: boolean;
  isNearby: boolean;
};

export function actionForMuddy(context: MuddyContext): ActivationAction {
  if (context.hasSharedUpcomingPlan) return "view_plan";
  if (!context.hasExistingConversation) return "say_hi";
  if (context.isNearby) return "wave";
  return "message";
}

/**
 * The full contextual decision: what to offer, what to offer second, and why.
 *
 * SMALL AND DETERMINISTIC. No scoring, no ranking, no recommender -- the same
 * inputs always produce the same pair, so the buttons cannot change underneath
 * somebody between two renders of the same screen.
 *
 * NEVER RENDERS A DEAD CTA. Wave is the one action the server can refuse for a
 * reason the client already knows about (a 30-minute pair cooldown), so when it
 * is unavailable the decision falls back rather than offering a button that
 * would bounce. Anything the server would predictably reject must not be shown.
 */
/**
 * How far along a conversation actually is.
 *
 * Replaces a boolean that could not tell "we said hello once" from "we talk",
 * which is the difference between offering to keep talking and asking somebody
 * to commit to meeting.
 */
export type ConversationState =
  /** No thread, or a thread nobody has spoken in. */
  | "none"
  /** Real messages exist, but only from one side so far. */
  | "started"
  /** Both people have written. Somebody replied. */
  | "established";

export type MuddyActionContext = MuddyContext & {
  /**
   * Derived from real messages, never from the conversation row existing.
   *
   * Deliberately not a message count: a reply is what shows two people are
   * talking, and three messages into silence is still waiting.
   */
  conversationState: ConversationState;
  /**
   * False while the pair is inside the Wave cooldown.
   *
   * Supplied by the caller from the canonical Wave rules -- this module does
   * not re-implement the window, it just refuses to offer a blocked action.
   */
  waveAvailable: boolean;
};

export type MuddyActionPlan = {
  primary: ActivationAction;
  /** Null when a second option would only dilute the first. */
  secondary: ActivationAction | null;
  /** Why this pair, in one machine-readable token. For tests and analytics. */
  reason:
    | "shared_plan"
    | "new_relationship"
    | "nearby_can_wave"
    | "nearby_wave_blocked"
    /** Talking has begun; the next move is to keep talking. */
    | "conversation_started"
    | "established";
};

export function planActionsForMuddy(context: MuddyActionContext): MuddyActionPlan {
  // Something already arranged beats anything the app could suggest, and
  // proposing a second plan to somebody you are already meeting is noise.
  if (context.hasSharedUpcomingPlan) {
    return { primary: "view_plan", secondary: "message", reason: "shared_plan" };
  }

  /* Never spoken: a first message is the smallest real step. A wave at
   * somebody you have never messaged is a gesture with no context.
   *
   * Keyed on conversationState, NOT on the row-existence boolean beside it.
   * The two could disagree -- a thread created by "Say hi" is
   * hasExistingConversation: true with nothing said in it -- and when they
   * did, this fell through to "established" and offered a Plan to somebody
   * who had never exchanged a word. One field decides. */
  if (context.conversationState === "none") {
    /* NEARBY CHANGES WHAT THE SECOND OPTION SHOULD BE.
     *
     * Saying hello stays primary either way -- a first message is still the
     * smallest real step. But when somebody is actually around, asking for a
     * Plan is the heavier of the two follow-ups, while a Wave matches the
     * moment exactly: one tap, no obligation, and it means something precisely
     * because they are here now.
     *
     * This is not "wave at a stranger": that rule was about waving at somebody
     * NOT nearby, where the gesture has no context. Offered only when the
     * server would actually accept it, so the cooldown can never produce a
     * dead button. */
    if (context.isNearby && context.waveAvailable) {
      return { primary: "say_hi", secondary: "wave", reason: "new_relationship" };
    }
    return { primary: "say_hi", secondary: "make_plan", reason: "new_relationship" };
  }

  if (context.isNearby) {
    // Nearby and allowed to wave: one tap, no obligation, and it means
    // something precisely because they are around right now.
    if (context.waveAvailable) {
      return { primary: "wave", secondary: "message", reason: "nearby_can_wave" };
    }
    // Cooldown. Offering a Wave the server will refuse is worse than offering
    // the message that always works.
    return { primary: "message", secondary: "make_plan", reason: "nearby_wave_blocked" };
  }

  /* ONE MESSAGE IS NOT A RELATIONSHIP.
   *
   * "Has a conversation" used to mean "established", so the very first hello
   * promoted a Plan to primary -- the app answering somebody's opening message
   * by asking them to commit to meeting. The natural next move after saying hi
   * is to keep talking.
   *
   * The threshold is DIRECTION, not volume: a reply means two people are
   * actually talking, which no count of one person's own messages can show.
   * Somebody who sent three messages into silence is still waiting, and
   * suggesting a plan there would be worse, not better. */
  if (context.conversationState === "started") {
    return { primary: "message", secondary: "make_plan", reason: "conversation_started" };
  }

  // Talked before, not nearby, nothing arranged: a plan is finally the natural
  // suggestion rather than a demand made too early.
  return { primary: "make_plan", secondary: "message", reason: "established" };
}

/**
 * Has this person reached first value?
 *
 * One Muddy and one real interaction. Deliberately not "completed onboarding":
 * filling in a profile is setup, not value, and treating it as activation is
 * how a product congratulates itself for a form submission.
 */
export function hasReachedFirstValue(milestones: ReadonlySet<string>): boolean {
  if (!milestones.has("first_muddy_added")) return false;
  return (
    milestones.has("first_wave_sent") ||
    /* Saying something to somebody is the most ordinary way people start.
     *
     * Its absence here was the gap: a person could add a Muddy, message them,
     * get a reply, and still be shown a training-wheels Home because the only
     * things that counted were a Wave, a Plan or a status. Recorded at the
     * canonical send boundary for DIRECT messages only. */
    milestones.has("first_message_sent") ||
    milestones.has("first_plan_created") ||
    /* Kept, with a reservation recorded rather than acted on.
     *
     * A status is broadcast -- expression rather than interaction with a
     * person -- so it sits oddly beside the other three. Removing it is a
     * product-policy change that would silently reopen mature Home for anybody
     * who qualified only this way, so it belongs in a deliberate taxonomy
     * audit, not folded into a messaging migration. */
    milestones.has("first_status_created")
  );
}

/**
 * Should the contextual Glow explanation be shown?
 *
 * ONLY ONCE THERE IS SOMEBODY TO SEE. Explaining proximity to a person with no
 * Muddies is a tutorial about an empty room -- it teaches a concept whose
 * value cannot yet be observed, and it delays the thing that actually unblocks
 * them. Once a Muddy exists, the same explanation answers a question they are
 * about to have.
 */
/**
 * How long after the first Muddy the acknowledgement still means something.
 *
 * Six hours: long enough to survive closing the app and coming back the same
 * evening, short enough that returning tomorrow is an ordinary Home rather
 * than the product congratulating you again for something you already know.
 */
export const FIRST_MUDDY_ACKNOWLEDGEMENT_MS = 6 * 60 * 60 * 1000;

/**
 * Should Home acknowledge that a first Muddy has just arrived?
 *
 * DERIVED FROM WHEN IT HAPPENED, not from a "have we shown this" flag.
 * `activation_milestones.reached_at` already records the instant, so recency
 * answers the question without storing a second piece of state that could
 * drift -- and without a migration.
 *
 * The consequence is deliberate: the acknowledgement fades on its own. Somebody
 * who connects and returns a week later sees ordinary Home, because by then the
 * news is not news. Somebody who was mid-session sees it, which is the moment
 * it is worth anything.
 *
 * IT ALSO RETIRES ON COMPLETION, not only on time (BETA-011).
 *
 * The card carries the "Say hi" call to action, so its lifetime is really the
 * lifetime of an INSTRUCTION -- and an instruction must stop being given the
 * moment it is carried out. Recency alone could not see that: a fresh account
 * that added a Muddy, opened the conversation, sent a real message and came
 * back to Home was told to say hi again, because `reached_at` was still minutes
 * old. Six hours of being asked to do something already done is what the beta
 * tester reported as being stuck.
 *
 * The completion signal is the SAME milestone the product already treats as
 * first social value, written at the canonical send boundary. So this reads
 * evidence that already exists rather than storing a "have we shown this" flag
 * -- the derivation principle is preserved, and correctness follows the account
 * rather than the device: another browser, a relogin and a hard refresh all
 * agree, because they all read the same row.
 *
 * `first_wave_sent` and `first_plan_created` count too. All three are the act
 * this card exists to provoke, and having done a bigger version of it must not
 * leave somebody still being nudged toward the smaller one.
 *
 * Milestones are OPTIONAL so existing callers keep their exact behaviour; the
 * only caller that can answer the question passes them.
 */
export function shouldAcknowledgeFirstMuddy(input: {
  muddyCount: number;
  firstMuddyReachedAtMs: number | null;
  nowMs: number;
  milestones?: ReadonlySet<string>;
}): boolean {
  if (input.muddyCount === 0) return false;
  if (input.firstMuddyReachedAtMs === null) return false;
  if (input.milestones && hasCompletedFirstSocialAct(input.milestones)) return false;
  const age = input.nowMs - input.firstMuddyReachedAtMs;
  // A negative age means clock skew between server and client; treat it as
  // "just happened" rather than hiding a moment somebody earned.
  if (age < 0) return true;
  return age <= FIRST_MUDDY_ACKNOWLEDGEMENT_MS;
}

/**
 * Has the person performed the social act the first-Muddy card asks for?
 *
 * NARROWER THAN `hasReachedFirstValue`, deliberately, and not a duplicate of
 * it. That function answers "has this account arrived", and counts
 * `first_status_created` -- broadcasting a status. A status is expression, not
 * reaching out to the person this card names, so it must NOT dismiss a nudge to
 * say hi to them. This asks only whether an act directed at another human has
 * happened.
 */
export function hasCompletedFirstSocialAct(milestones: ReadonlySet<string>): boolean {
  return (
    milestones.has("first_message_sent") ||
    milestones.has("first_wave_sent") ||
    milestones.has("first_plan_created")
  );
}

export function shouldTeachGlow(input: ActivationInputs): boolean {
  if (input.muddyCount === 0) return false;
  return !input.milestones.has("first_glow_enabled");
}

/**
 * Where a returning, half-activated person resumes.
 *
 * The same derivation as everything else -- there is no saved position to get
 * out of date. Someone who added a Muddy on their phone and returns on the web
 * a week later is met by the state their account is actually in.
 */
export function resumeState(input: ActivationInputs): ActivationState {
  return resolveActivationState(input);
}
