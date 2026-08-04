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
  { id: "complete_profile", title: "Complete Profile", description: "Add the essentials that help approved Muddies recognise you.", unlockCondition: "Add a photo, bio, and mood.", destination: "/profile", guideSlug: "profile-guide" },
  { id: "add_first_muddy", title: "Add First Muddy", description: "Connect with someone you know and both approve the connection.", unlockCondition: "Create your first approved Muddy connection.", destination: "/friends", guideSlug: "muddies-guide" },
  { id: "turn_on_visibility", title: "Turn On Visibility", description: "Choose when approved Muddies can know you are nearby.", unlockCondition: "Turn on Glow visibility for the first time.", destination: "/settings/glow-visibility", guideSlug: "glow-visibility-guide" },
  { id: "send_first_wave", title: "Send First Wave", description: "Send a simple, low-pressure hello to an approved Muddy.", unlockCondition: "Send your first Wave.", destination: "/friends", guideSlug: null },
  { id: "start_first_conversation", title: "Start First Conversation", description: "Begin a private conversation with an approved Muddy.", unlockCondition: "Send your first conversation message.", destination: "/messages", guideSlug: "messages-guide" },
  { id: "create_first_plan", title: "Create First Plan", description: "Turn a connection into a simple real-world plan.", unlockCondition: "Create your first non-draft Plan.", destination: "/plans", guideSlug: "plans-guide" },
  { id: "complete_first_safe_arrival", title: "Complete First Safe Arrival", description: "Finish a privacy-safe journey check-in.", unlockCondition: "Confirm your first Safe Arrival.", destination: "/safe-arrival", guideSlug: "safe-arrival-guide" },
  { id: "share_first_moment", title: "Share First Moment", description: "Share a temporary update with the people you choose.", unlockCondition: "Share your first valid Moment.", destination: "/moments", guideSlug: "moments-guide" },
  { id: "reach_trusted_buddy", title: "Reach Trusted Buddy", description: "Build a sustained record of trusted participation.", unlockCondition: "Reach the Trusted Buddy reputation level.", destination: "/buddy-score", guideSlug: "buddy-score-guide" },
  { id: "unlock_buddy_plus", title: "Unlock Buddy Plus", description: "Reach Buddy Plus access through the existing membership system.", unlockCondition: "Gain effective Buddy Plus or Buddy Pro access.", destination: "/billing", guideSlug: "subscription-guide" }
] as const;

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
