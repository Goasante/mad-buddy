/**
 * Onboarding, Privacy Setup, and Location Permission core (feature
 * architecture batch 9, spec §18-§61). Pure and deterministic.
 *
 * The load-bearing product rules, encoded rather than left to UI:
 *  - Glow visibility is HIDDEN by default and must be actively turned on
 *    (spec §31). Nothing here can silently enable it.
 *  - A client's claim of location permission is never proof. Visibility
 *    activates only on a valid recent presence update (spec §48).
 *  - Activation means a real connection plus a meaningful action, not form
 *    completion (spec §57).
 */

// ---------------------------------------------------------------------------
// Onboarding state machine (spec §23, §24)
// ---------------------------------------------------------------------------

export type OnboardingStep =
  | "not_started"
  | "profile_started"
  | "profile_completed"
  | "privacy_reviewed"
  | "visibility_configured"
  | "location_prompted"
  | "first_muddy_added"
  | "activated"
  | "completed";

/** The happy-path order. Optional steps may be skipped forward (see below). */
export const ONBOARDING_ORDER: OnboardingStep[] = [
  "not_started",
  "profile_started",
  "profile_completed",
  "privacy_reviewed",
  "visibility_configured",
  "location_prompted",
  "first_muddy_added",
  "activated",
  "completed"
];

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_ORDER.indexOf(step);
}

/** Steps a user may skip. Legal agreement and profile are never skippable. */
export const OPTIONAL_STEPS: ReadonlySet<OnboardingStep> = new Set<OnboardingStep>([
  "location_prompted",
  "first_muddy_added"
]);

/**
 * Progress only ever moves forward. Re-reporting an earlier step (e.g. a
 * resumed device replaying an old event) must not rewind someone's progress
 * (spec §24: don't trap returning users).
 */
export function canAdvanceTo(current: OnboardingStep, next: OnboardingStep): boolean {
  return stepIndex(next) > stepIndex(current);
}

export function nextStep(current: OnboardingStep): OnboardingStep {
  const index = stepIndex(current);
  return ONBOARDING_ORDER[Math.min(index + 1, ONBOARDING_ORDER.length - 1)];
}

export type OnboardingProgressState = {
  currentStep: OnboardingStep;
  profileCompleted: boolean;
  privacyReviewed: boolean;
  visibilityConfigured: boolean;
  firstMuddyAdded: boolean;
};

/**
 * Whether onboarding may be marked complete. The server validates required
 * steps rather than trusting a client "done" call (spec §26). Location and the
 * first Muddy are deliberately NOT required, a user must be able to finish
 * without granting location or waiting on someone else to accept (spec §61).
 */
export function canCompleteOnboarding(state: OnboardingProgressState): boolean {
  return state.profileCompleted && state.privacyReviewed && state.visibilityConfigured;
}

/** Where to send a returning user (spec §24). */
export function resumeStep(state: OnboardingProgressState): OnboardingStep {
  if (!state.profileCompleted) return "profile_started";
  if (!state.privacyReviewed) return "privacy_reviewed";
  if (!state.visibilityConfigured) return "visibility_configured";
  if (!state.firstMuddyAdded) return "first_muddy_added";
  return "completed";
}

// ---------------------------------------------------------------------------
// Privacy setup defaults (spec §31)
// ---------------------------------------------------------------------------

export type GlowAudience = "hidden" | "close_friends" | "selected_circles" | "all_muddies";
export type GlowDuration = "1h" | "4h" | "until_tonight" | "until_off";

export type PrivacySetup = {
  glowAudience: GlowAudience;
  glowDuration: GlowDuration;
  wavesFrom: "all_muddies" | "close_friends" | "nobody";
  pingsFrom: "all_muddies" | "close_friends" | "nobody";
  onlineStatusVisible: boolean;
  contactMatchingEnabled: boolean;
};

/**
 * The safest defaults (spec §31). Glow starts HIDDEN: the user must actively
 * turn visibility on. Online status and contact matching start off.
 */
export const SAFE_DEFAULT_PRIVACY_SETUP: PrivacySetup = {
  glowAudience: "hidden",
  glowDuration: "1h",
  wavesFrom: "all_muddies",
  pingsFrom: "all_muddies",
  onlineStatusVisible: false,
  contactMatchingEnabled: false
};

export function normalizePrivacySetup(raw: unknown): PrivacySetup {
  const base = SAFE_DEFAULT_PRIVACY_SETUP;
  if (!raw || typeof raw !== "object") return base;
  const value = raw as Partial<PrivacySetup>;

  const audiences: GlowAudience[] = ["hidden", "close_friends", "selected_circles", "all_muddies"];
  const durations: GlowDuration[] = ["1h", "4h", "until_tonight", "until_off"];
  const froms: PrivacySetup["wavesFrom"][] = ["all_muddies", "close_friends", "nobody"];

  return {
    glowAudience: audiences.includes(value.glowAudience as GlowAudience)
      ? (value.glowAudience as GlowAudience)
      : base.glowAudience,
    glowDuration: durations.includes(value.glowDuration as GlowDuration)
      ? (value.glowDuration as GlowDuration)
      : base.glowDuration,
    wavesFrom: froms.includes(value.wavesFrom as PrivacySetup["wavesFrom"])
      ? (value.wavesFrom as PrivacySetup["wavesFrom"])
      : base.wavesFrom,
    pingsFrom: froms.includes(value.pingsFrom as PrivacySetup["pingsFrom"])
      ? (value.pingsFrom as PrivacySetup["pingsFrom"])
      : base.pingsFrom,
    onlineStatusVisible:
      typeof value.onlineStatusVisible === "boolean" ? value.onlineStatusVisible : base.onlineStatusVisible,
    contactMatchingEnabled:
      typeof value.contactMatchingEnabled === "boolean"
        ? value.contactMatchingEnabled
        : base.contactMatchingEnabled
  };
}

export function glowDurationMs(duration: GlowDuration, nowMs: number): number | null {
  switch (duration) {
    case "1h":
      return 60 * 60 * 1000;
    case "4h":
      return 4 * 60 * 60 * 1000;
    case "until_tonight": {
      // Until 23:59 local-ish, computed from the caller's supplied clock.
      const end = new Date(nowMs);
      end.setHours(23, 59, 0, 0);
      const ms = end.getTime() - nowMs;
      return ms > 0 ? ms : 60 * 60 * 1000;
    }
    case "until_off":
      return null;
  }
}

// ---------------------------------------------------------------------------
// Permission summary (spec §33), only claims that are technically true.
// ---------------------------------------------------------------------------

export const FRIENDS_CAN_SEE = [
  "A proximity label like Nearby or Around",
  "Your status, when you set one",
  "Your name and photo",
  "That you're at an event, when you check in"
] as const;

export const FRIENDS_NEVER_SEE = [
  "Your exact coordinates",
  "Your exact distance",
  "Which direction you're in",
  "Your street address",
  "Your route or journey",
  "Your location history"
] as const;

// ---------------------------------------------------------------------------
// Location permission (spec §41, §47, §48)
// ---------------------------------------------------------------------------

export type PermissionState =
  | "not_requested"
  | "pre_prompt_viewed"
  | "granted"
  | "granted_approximate"
  | "denied"
  | "denied_permanently"
  | "revoked"
  | "unsupported"
  | "error";

export function permissionAllowsLocation(state: PermissionState): boolean {
  return state === "granted" || state === "granted_approximate";
}

/**
 * Whether glow may actually go live. A client claiming "granted" is NOT
 * sufficient, there must be a real, recent presence update (spec §48). This
 * is what stops a spoofed client from flipping visibility on.
 */
export function canActivateVisibility(input: {
  audience: GlowAudience;
  permission: PermissionState;
  hasRecentPresenceUpdate: boolean;
}): { active: boolean; reason: "hidden_by_choice" | "no_permission" | "no_presence_yet" | "active" } {
  if (input.audience === "hidden") return { active: false, reason: "hidden_by_choice" };
  if (!permissionAllowsLocation(input.permission)) return { active: false, reason: "no_permission" };
  if (!input.hasRecentPresenceUpdate) return { active: false, reason: "no_presence_yet" };
  return { active: true, reason: "active" };
}

/** Non-shaming copy for a denial (spec §43). */
export const PERMISSION_DENIED_MESSAGE =
  "Location access was not granted. You can still message, create plans and use other features.";

export const PERMISSION_REVOKED_MESSAGE = "Your glow is off because location access is unavailable.";

/** Revocation must end visibility, not merely stop new collection (spec §44). */
export function shouldEndVisibilityOnPermission(state: PermissionState): boolean {
  return state === "revoked" || state === "denied_permanently" || state === "denied";
}

// ---------------------------------------------------------------------------
// Activation (spec §50-§58)
// ---------------------------------------------------------------------------

export type Milestone =
  | "account_created"
  | "email_verified"
  | "profile_completed"
  | "privacy_setup_completed"
  | "first_request_sent"
  | "first_request_accepted"
  | "first_muddy_added"
  | "first_status_created"
  | "first_wave_sent"
  | "first_glow_enabled"
  | "first_plan_created";

const MEANINGFUL_ACTIONS: ReadonlySet<Milestone> = new Set<Milestone>([
  "first_status_created",
  "first_wave_sent",
  "first_glow_enabled",
  "first_plan_created"
]);

/**
 * Activation = first approved Muddy PLUS one meaningful action (spec §57).
 * Signing up and filling in a form is explicitly not activation.
 */
export function isActivated(milestones: ReadonlySet<Milestone>): boolean {
  if (!milestones.has("first_muddy_added")) return false;
  for (const action of MEANINGFUL_ACTIONS) {
    if (milestones.has(action)) return true;
  }
  return false;
}

export type NextAction = { id: string; label: string; requiresLocation: boolean };

/**
 * The next thing worth doing. Wave is preferred as the first action: it's low
 * pressure and needs no location (spec §55). A Meet Ping is never suggested
 * first.
 */
export function recommendNextAction(input: {
  hasFirstMuddy: boolean;
  milestones: ReadonlySet<Milestone>;
  hasPendingRequest: boolean;
}): NextAction {
  if (!input.hasFirstMuddy) {
    return input.hasPendingRequest
      ? { id: "invite_another", label: "Invite another friend while you wait", requiresLocation: false }
      : { id: "add_first_muddy", label: "Add your first Muddy", requiresLocation: false };
  }
  if (!input.milestones.has("first_wave_sent")) {
    return { id: "send_wave", label: "Send your first Wave", requiresLocation: false };
  }
  if (!input.milestones.has("first_status_created")) {
    return { id: "set_status", label: "Set a status", requiresLocation: false };
  }
  if (!input.milestones.has("first_glow_enabled")) {
    return { id: "enable_glow", label: "Turn on your glow for an hour", requiresLocation: true };
  }
  return { id: "create_plan", label: "Create a plan", requiresLocation: false };
}

/** Things to do while waiting for a first request to be accepted (spec §53). */
export const PENDING_SUGGESTIONS = [
  { id: "invite_another", label: "Invite another friend" },
  { id: "review_privacy", label: "Review your privacy controls" },
  { id: "finish_profile", label: "Finish your profile" },
  { id: "learn_glow", label: "Learn how glow works" }
] as const;

export const FIRST_MUDDY_CONNECTED_NOTE =
  "You're connected, but neither of you is visible unless you choose to turn on your glow.";

/** Privacy policy version a completed setup is recorded against (spec §36). */
export const CURRENT_POLICY_VERSION = "2026-07-17";
