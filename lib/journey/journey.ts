export const JOURNEY_STEP_IDS = [
  "complete_profile",
  "add_first_muddy",
  "turn_on_visibility",
  "send_first_wave",
  "start_first_conversation",
  "create_first_plan",
  "complete_first_safe_arrival",
  "share_first_moment",
  "reach_trusted_buddy",
  "unlock_buddy_plus"
] as const;

export type JourneyStepId = (typeof JOURNEY_STEP_IDS)[number];
export type JourneyStepState = "completed" | "current" | "locked";

export type JourneyStep = {
  id: JourneyStepId;
  title: string;
  description: string;
  state: JourneyStepState;
  unlockCondition: string;
  destination: string;
  guide: { slug: string; tourVersionId: string } | null;
};

export type JourneyData = {
  completedCount: number;
  totalCount: number;
  currentStep: JourneyStep | null;
  steps: JourneyStep[];
};

export type JourneyEvidence = Record<JourneyStepId, boolean>;

type StepDefinition = Omit<JourneyStep, "state" | "guide"> & { guideSlug: string | null };

export const JOURNEY_DEFINITIONS: readonly StepDefinition[] = [
  { id: "complete_profile", title: "Complete Profile", description: "Help your Muddies recognise you.", unlockCondition: "Add a photo, bio, and mood.", destination: "/profile", guideSlug: "profile-guide" },
  { id: "add_first_muddy", title: "Add First Muddy", description: "Connect with someone you already know.", unlockCondition: "Create your first approved Muddy connection.", destination: "/friends", guideSlug: "muddies-guide" },
  { id: "turn_on_visibility", title: "Turn On Visibility", description: "Choose when Muddies can see you're nearby.", unlockCondition: "Turn on Glow visibility for the first time.", destination: "/settings/glow-visibility", guideSlug: "glow-visibility-guide" },
  { id: "send_first_wave", title: "Send First Wave", description: "Say hello, no pressure.", unlockCondition: "Send your first Wave.", destination: "/friends", guideSlug: null },
  { id: "start_first_conversation", title: "Start First Conversation", description: "Take a Muddy from nearby to talking.", unlockCondition: "Send your first conversation message.", destination: "/messages", guideSlug: "messages-guide" },
  { id: "create_first_plan", title: "Create First Plan", description: "Turn a connection into real plans.", unlockCondition: "Create your first non-draft Plan.", destination: "/plans", guideSlug: "plans-guide" },
  { id: "complete_first_safe_arrival", title: "Complete First Safe Arrival", description: "Let your circle know you got there safely.", unlockCondition: "Confirm your first Safe Arrival.", destination: "/safe-arrival", guideSlug: "safe-arrival-guide" },
  { id: "share_first_moment", title: "Share First Moment", description: "Share something with the people you choose.", unlockCondition: "Share your first valid Moment.", destination: "/moments", guideSlug: "moments-guide" },
  { id: "reach_trusted_buddy", title: "Become a Trusted Buddy", description: "Show friends you're ready for safer meetups.", unlockCondition: "Reach the Trusted Buddy reputation level.", destination: "/buddy-score", guideSlug: "buddy-score-guide" },
  { id: "unlock_buddy_plus", title: "Unlock Buddy Plus", description: "Get more from every connection.", unlockCondition: "Gain effective Buddy Plus or Buddy Pro access.", destination: "/billing", guideSlug: "subscription-guide" }
] as const;

/**
 * Canonical "first-time / low-progress" signal, derived from real Journey
 * completion rather than inferred client-side. A user is "first-time" until
 * they've cleared the very first activation step (adding a Muddy) — after
 * that they're treated as an active user even if later steps are still open.
 */
export function isFirstTimeJourneyState(journey: JourneyData): boolean {
  return !journey.steps.some((step) => step.id === "add_first_muddy" && step.state === "completed");
}

export function buildJourney(
  evidence: JourneyEvidence,
  guideVersions: ReadonlyMap<string, string> = new Map()
): JourneyData {
  const firstIncomplete = JOURNEY_DEFINITIONS.findIndex((step) => !evidence[step.id]);
  const steps = JOURNEY_DEFINITIONS.map((step, index): JourneyStep => ({
    id: step.id,
    title: step.title,
    description: step.description,
    state: evidence[step.id] ? "completed" : index === firstIncomplete ? "current" : "locked",
    unlockCondition: step.unlockCondition,
    destination: step.destination,
    guide: step.guideSlug && guideVersions.has(step.guideSlug)
      ? { slug: step.guideSlug, tourVersionId: guideVersions.get(step.guideSlug)! }
      : null
  }));
  return {
    completedCount: steps.filter((step) => step.state === "completed").length,
    totalCount: steps.length,
    currentStep: steps.find((step) => step.state === "current") ?? null,
    steps
  };
}
