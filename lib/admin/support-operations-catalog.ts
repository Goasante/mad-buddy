export type SupportCoverageState = "live" | "partial" | "planned";

export type SupportOperationsArea = {
  id: string;
  label: string;
  description: string;
  diagnostic: SupportCoverageState;
  repair: SupportCoverageState;
  verification: SupportCoverageState;
  issues: readonly string[];
  boundary: string;
};

/**
 * Founder-approved Admin Support Operations scope.
 *
 * This is intentionally product/UX metadata, not executable repair logic.
 * It gives Admin (and the implementation tranche that follows) one visible,
 * reviewable coverage contract so a product area cannot quietly fall out of
 * Account Doctor as Mad Buddy grows.
 */
export const SUPPORT_OPERATIONS_AREAS: readonly SupportOperationsArea[] = [
  {
    id: "account-auth",
    label: "Account & auth",
    description: "Login, verification, recovery, session and account/profile linkage health.",
    diagnostic: "planned",
    repair: "planned",
    verification: "planned",
    issues: [
      "Login or recovery appears stuck",
      "Verification state is inconsistent",
      "Profile/auth linkage is missing or orphaned",
      "Stale sessions need a governed revoke/re-auth path"
    ],
    boundary: "Never expose credentials, tokens or security secrets to Support."
  },
  {
    id: "onboarding-activation",
    label: "Onboarding & activation",
    description: "Setup completion, activation milestones and first-value progression.",
    diagnostic: "partial",
    repair: "partial",
    verification: "partial",
    issues: [
      "Onboarding keeps returning",
      "Account is stranded mid-onboarding",
      "Activation milestone does not match real account state",
      "A specific education/setup step needs a safe replay"
    ],
    boundary: "Prefer targeted reconciliation; full onboarding reset stays high-risk."
  },
  {
    id: "profile-media",
    label: "Profile & media",
    description: "Profile projection, avatar/showcase uploads and completion state.",
    diagnostic: "planned",
    repair: "planned",
    verification: "planned",
    issues: [
      "Profile save appears stuck",
      "Old avatar/showcase media remains",
      "Failed or orphan upload state",
      "Profile completion projection is wrong"
    ],
    boundary: "Do not expose private media or bypass Profile ownership of identity media."
  },
  {
    id: "dob-age",
    label: "DOB & age gate",
    description: "Age-gate and governed correction-state diagnosis.",
    diagnostic: "planned",
    repair: "planned",
    verification: "planned",
    issues: [
      "DOB correction entitlement appears stuck",
      "18+ gate and stored account state disagree",
      "Correction lifecycle cannot advance"
    ],
    boundary: "No arbitrary DOB editing; preserve server-enforced 18+ authority."
  },
  {
    id: "muddies-requests",
    label: "Muddies & requests",
    description: "Friend requests, active Muddy relationships and lifecycle projection.",
    diagnostic: "partial",
    repair: "planned",
    verification: "planned",
    issues: [
      "Friend request is stuck pending",
      "Accepted request is not reflected as a Muddy",
      "Old request reappears",
      "Duplicate or impossible relationship state"
    ],
    boundary: "Admin must never manufacture friendship consent."
  },
  {
    id: "blocks-refriend",
    label: "Blocks & re-friend",
    description: "Block precedence, unblock state and legitimate friendship restoration.",
    diagnostic: "partial",
    repair: "partial",
    verification: "partial",
    issues: [
      "Unblocked account still behaves blocked",
      "Blocked user leaks into another surface",
      "Re-friended pair cannot use the old conversation",
      "Relationship and block state disagree"
    ],
    boundary: "A live block in either direction always wins."
  },
  {
    id: "direct-messaging",
    label: "Direct messaging",
    description: "Conversation status, membership, direct-key identity and inbox/send readiness.",
    diagnostic: "live",
    repair: "live",
    verification: "partial",
    issues: [
      "Message says Not sent despite a valid Muddy relationship",
      "Archived conversation should be active",
      "Conversation membership is stale",
      "Zero-message conversation does not surface",
      "Duplicate direct thread or inbox/unread projection mismatch"
    ],
    boundary: "Repair existing canonical direct state only; never bypass friendship or blocks."
  },
  {
    id: "plan-chat",
    label: "Plan Chat",
    description: "Canonical Plan conversation creation and membership reconciliation.",
    diagnostic: "live",
    repair: "live",
    verification: "partial",
    issues: [
      "Plan exists but Plan Chat is missing",
      "Going/Maybe participant cannot enter Plan Chat",
      "Removed participant still has chat access",
      "Contextual UpFor participant is missing from Plan Chat"
    ],
    boundary: "Use the canonical Plan lifecycle; never grant arbitrary chat membership."
  },
  {
    id: "plans",
    label: "Plans",
    description: "RSVP, participant, status and UpFor-conversion lifecycle health.",
    diagnostic: "partial",
    repair: "partial",
    verification: "partial",
    issues: [
      "RSVP state is wrong or stuck",
      "Participant state and chat membership disagree",
      "Plan remains in an impossible lifecycle state",
      "Converted UpFor source/participant projection is wrong"
    ],
    boundary: "Preserve create_plan_lifecycle and canonical RSVP authority."
  },
  {
    id: "upfor",
    label: "UpFor",
    description: "Session expiry, requests, capacity, discovery and conversion state.",
    diagnostic: "partial",
    repair: "planned",
    verification: "planned",
    issues: [
      "Expired UpFor is still active",
      "Join request is stuck",
      "Accepted participant is missing",
      "Capacity/status disagree",
      "Conversion or discovery projection is stale"
    ],
    boundary: "Never turn an Admin repair into stranger friendship or unrelated Plan access."
  },
  {
    id: "linkr",
    label: "Linkr",
    description: "Choice, mutuality, discovery eligibility and Profile-owned media projection.",
    diagnostic: "planned",
    repair: "planned",
    verification: "planned",
    issues: [
      "Mutual connection does not appear",
      "Old card returns after a choice",
      "Blocked person remains eligible",
      "Discovery/profile media projection is stale"
    ],
    boundary: "Never synthesize a Linkr mutual or friendship."
  },
  {
    id: "presence",
    label: "Glow & presence",
    description: "Ghost Mode, current signal, visibility and expiring status state.",
    diagnostic: "live",
    repair: "live",
    verification: "partial",
    issues: [
      "Glow appears stale",
      "Ghost Mode/visibility state is inconsistent",
      "Status failed to expire",
      "Presence signal needs a clean refresh"
    ],
    boundary: "Admin never receives exact coordinates, numerical distance or location history."
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Unread projection, duplicate/stale notification state and safe replay readiness.",
    diagnostic: "partial",
    repair: "partial",
    verification: "planned",
    issues: [
      "Unread badge is stuck",
      "Notification appears duplicated",
      "Expected notification never arrived",
      "Notification lifecycle is stale"
    ],
    boundary: "Replay only idempotent notification work; do not expose private notification payloads unnecessarily."
  },
  {
    id: "push",
    label: "Push devices",
    description: "Device registration, stale subscriptions and multi-device delivery health.",
    diagnostic: "partial",
    repair: "live",
    verification: "planned",
    issues: [
      "Push suddenly stopped",
      "Stale device registrations remain",
      "Account needs device re-registration",
      "Multi-device push state is inconsistent"
    ],
    boundary: "Do not surface raw push tokens unless an owner-only security tool explicitly requires them."
  },
  {
    id: "events",
    label: "Events",
    description: "RSVP, attendee, check-in and Event conversation lifecycle.",
    diagnostic: "planned",
    repair: "planned",
    verification: "planned",
    issues: [
      "Event RSVP/attendee state is wrong",
      "Check-in cannot advance",
      "Event Chat membership is stale",
      "Event lifecycle is stuck"
    ],
    boundary: "Repair event authority, not arbitrary conversation membership."
  },
  {
    id: "safe-arrival",
    label: "Safe Arrival",
    description: "Journey lifecycle, recipient state and notification reconciliation without location exposure.",
    diagnostic: "planned",
    repair: "planned",
    verification: "planned",
    issues: [
      "Journey is stuck",
      "Grace/expired state did not advance",
      "Recipient state or notification is stale",
      "Cancellation/expiry reconciliation is needed"
    ],
    boundary: "Never expose exact location, route, coordinates or location history to Support."
  },
  {
    id: "access-billing",
    label: "Access & billing",
    description: "Payment, entitlement, Access projection and safe webhook reconciliation.",
    diagnostic: "partial",
    repair: "partial",
    verification: "planned",
    issues: [
      "Payment succeeded but Access is missing",
      "Entitlement/expiry projection is stale",
      "Webhook processing needs an idempotent replay",
      "Account is legitimately stuck behind a rate limit"
    ],
    boundary: "No arbitrary paid access and no exposure of payment credentials."
  },
  {
    id: "features-tours",
    label: "Features, experiments & tours",
    description: "Resolved feature controls, assignment state and product education replay.",
    diagnostic: "partial",
    repair: "partial",
    verification: "planned",
    issues: [
      "Feature appears missing for one account",
      "Experiment assignment looks stale",
      "Tour keeps reappearing",
      "Education needs a governed replay"
    ],
    boundary: "Use existing feature/tour authorities rather than per-user hidden overrides."
  },
  {
    id: "journey",
    label: "Journey & achievements",
    description: "Progression and achievement projection rebuilt from canonical events.",
    diagnostic: "planned",
    repair: "planned",
    verification: "planned",
    issues: [
      "Progression is stale",
      "Achievement is missing despite canonical evidence",
      "Journey projection does not match real milestones"
    ],
    boundary: "Do not fabricate achievements or manually inflate progression."
  },
  {
    id: "privacy-account-ops",
    label: "Privacy & account operations",
    description: "Export, deletion, moderation/restriction and governed account jobs.",
    diagnostic: "planned",
    repair: "planned",
    verification: "planned",
    issues: [
      "Export request is stuck",
      "Deletion workflow is stuck",
      "Moderation/restriction state is inconsistent",
      "A safe background job needs retry"
    ],
    boundary: "Never shortcut identity, privacy, legal or security checks."
  }
];

export function supportCoverageCounts() {
  const counts = {
    areas: SUPPORT_OPERATIONS_AREAS.length,
    diagnosticLive: 0,
    repairLive: 0,
    fullyLive: 0,
    planned: 0
  };

  for (const area of SUPPORT_OPERATIONS_AREAS) {
    if (area.diagnostic === "live") counts.diagnosticLive += 1;
    if (area.repair === "live") counts.repairLive += 1;
    if (area.diagnostic === "live" && area.repair === "live" && area.verification === "live") counts.fullyLive += 1;
    if (area.diagnostic === "planned" && area.repair === "planned" && area.verification === "planned") counts.planned += 1;
  }

  return counts;
}
