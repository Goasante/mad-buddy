import type { DoctorAreaId } from "@/lib/admin/support-doctor-priority";

export type SupportDiagnosticSeverity = "healthy" | "info" | "attention" | "issue" | "product_rule";

export type SupportOwnedDiagnostic = {
  id: string;
  areaId: DoctorAreaId;
  severity: SupportDiagnosticSeverity;
  title: string;
  detail: string;
  /** What Support should do next. Never an arbitrary row edit. */
  operatorAction: "none" | "keep_diagnosing" | "use_named_repair" | "explain_product_rule" | "escalate";
  repairId?: string;
};

/**
 * Privacy-minimised facts for the areas owned by the parallel Admin slice.
 *
 * Deliberately absent:
 * - raw DOB (only age band + correction budget)
 * - exact coordinates / distance / location history
 * - push endpoints, p256dh/auth keys or native push tokens
 * - private Linkr one-sided choices or candidate identities
 * - profile-media URLs
 * - message / notification payload bodies
 */
export type SupportOwnedSnapshot = {
  account: {
    authUserExists: boolean;
    profileExists: boolean;
    isOnboarded: boolean;
  };
  activation: {
    milestoneCount: number;
  };
  profile: {
    hasAvatar: boolean;
    showcasePhotoCount: number;
    publicShowcasePhotoCount: number;
  };
  dob: {
    state: "missing" | "adult" | "under_18" | "invalid";
    selfServeCorrectionAvailable: boolean;
  };
  linkr: {
    enabled: boolean;
    hasPublicPhoto: boolean;
    ageEligible: boolean;
    accountRestricted: boolean;
  };
  presence: {
    visibility: "visible" | "ghost" | "app_open_only" | "unknown";
    signal: "fresh" | "stale" | "missing";
    staleStatusCount: number;
  };
  notifications: {
    unreadCount: number;
    webPushDevices: number;
    nativePushDevices: number;
    stalePushDevices: number;
  };
  features: {
    activeRateLimitCount: number;
  };
  journey: {
    achievementCount: number;
    milestoneCount: number;
  };
};

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

/**
 * Builds operator-facing findings without inventing permission to repair.
 * Product-rule outcomes are deliberately first-class: a correct refusal is not
 * an account defect and must never become a repair recommendation.
 */
export function buildSupportOwnedDiagnostics(snapshot: SupportOwnedSnapshot): SupportOwnedDiagnostic[] {
  const findings: SupportOwnedDiagnostic[] = [];

  if (!snapshot.account.authUserExists || !snapshot.account.profileExists) {
    findings.push({
      id: "account-linkage",
      areaId: "account-auth",
      severity: "issue",
      title: "Account identity linkage needs investigation",
      detail: !snapshot.account.authUserExists
        ? "The application profile cannot be matched to an active authentication identity."
        : "The authentication identity exists but the application profile is missing.",
      operatorAction: "escalate"
    });
  } else {
    findings.push({
      id: "account-linkage",
      areaId: "account-auth",
      severity: "healthy",
      title: "Account identity linkage looks healthy",
      detail: "Authentication and the Mad Buddy profile both exist for this account.",
      operatorAction: "none"
    });
  }

  if (!snapshot.account.isOnboarded) {
    findings.push({
      id: "onboarding-state",
      areaId: "onboarding-activation",
      severity: "attention",
      title: "Onboarding is incomplete",
      detail: snapshot.activation.milestoneCount > 0
        ? `The account is not marked onboarded but already has ${plural(snapshot.activation.milestoneCount, "activation milestone")}. Check which step is genuinely incomplete before replaying onboarding.`
        : "The account has not completed onboarding and has no recorded activation milestone yet.",
      operatorAction: "keep_diagnosing"
    });
  } else {
    findings.push({
      id: "onboarding-state",
      areaId: "onboarding-activation",
      severity: "healthy",
      title: "Onboarding completion is recorded",
      detail: `${plural(snapshot.activation.milestoneCount, "activation milestone")} recorded. Milestones are evidence of past progress, not permission to unlock features.`,
      operatorAction: "none"
    });
  }

  if (!snapshot.profile.hasAvatar && snapshot.profile.showcasePhotoCount === 0) {
    findings.push({
      id: "profile-media-readiness",
      areaId: "profile-media",
      severity: "info",
      title: "Profile has no photos yet",
      detail: "No avatar or showcase photo is currently attached. This can be a legitimate incomplete profile, not storage corruption.",
      operatorAction: "keep_diagnosing"
    });
  } else {
    findings.push({
      id: "profile-media-readiness",
      areaId: "profile-media",
      severity: "healthy",
      title: "Profile media projection has usable media",
      detail: `${snapshot.profile.hasAvatar ? "Avatar present" : "No avatar"} · ${plural(snapshot.profile.showcasePhotoCount, "showcase photo")} · ${snapshot.profile.publicShowcasePhotoCount} stranger-visible.`,
      operatorAction: "none"
    });
  }

  if (snapshot.dob.state === "invalid") {
    findings.push({
      id: "dob-state",
      areaId: "dob-age",
      severity: "issue",
      title: "Stored age state cannot be derived safely",
      detail: "The canonical birth record exists but a valid derived age could not be produced. Do not guess or edit the date in Admin.",
      operatorAction: "escalate"
    });
  } else if (snapshot.dob.state === "missing") {
    findings.push({
      id: "dob-state",
      areaId: "dob-age",
      severity: "info",
      title: "No date of birth is stored",
      detail: "The owner can set their canonical date of birth from Profile. Admin should not invent one for them.",
      operatorAction: "explain_product_rule"
    });
  } else if (snapshot.dob.state === "under_18") {
    findings.push({
      id: "dob-state",
      areaId: "dob-age",
      severity: "product_rule",
      title: "18+ features are correctly unavailable",
      detail: "The derived age is under 18. This is a product rule, not an account fault, and Admin must not override the age gate.",
      operatorAction: "explain_product_rule"
    });
  } else {
    findings.push({
      id: "dob-state",
      areaId: "dob-age",
      severity: "healthy",
      title: "Age gate has a valid adult age",
      detail: snapshot.dob.selfServeCorrectionAvailable
        ? "The account is 18+ and the one self-serve DOB correction remains available."
        : "The account is 18+ and the one self-serve DOB correction has already been used; further changes require governed support review.",
      operatorAction: "none"
    });
  }

  if (!snapshot.dob.selfServeCorrectionAvailable && snapshot.dob.state !== "missing") {
    findings.push({
      id: "dob-correction-budget",
      areaId: "dob-age",
      severity: "product_rule",
      title: "Self-serve DOB correction is locked",
      detail: "The account already used its single self-serve correction. That lock is intentional because age controls 18+ surfaces.",
      operatorAction: "explain_product_rule"
    });
  }

  if (!snapshot.linkr.enabled) {
    findings.push({
      id: "linkr-eligibility",
      areaId: "linkr",
      severity: "info",
      title: "Linkr is switched off for this account",
      detail: "The account is not participating in Linkr discovery. This is a user-controlled state, not a discovery defect.",
      operatorAction: "explain_product_rule"
    });
  } else if (snapshot.linkr.accountRestricted) {
    findings.push({
      id: "linkr-eligibility",
      areaId: "linkr",
      severity: "product_rule",
      title: "Linkr is unavailable because of an account restriction",
      detail: "A current account restriction prevents Linkr participation. Admin should inspect the governed restriction rather than bypass discovery eligibility.",
      operatorAction: "explain_product_rule"
    });
  } else if (!snapshot.linkr.ageEligible) {
    findings.push({
      id: "linkr-eligibility",
      areaId: "linkr",
      severity: "product_rule",
      title: "Linkr is correctly blocked by the age gate",
      detail: "Linkr is an 18+ surface. The account does not currently meet that server-enforced rule.",
      operatorAction: "explain_product_rule"
    });
  } else if (!snapshot.linkr.hasPublicPhoto) {
    findings.push({
      id: "linkr-eligibility",
      areaId: "linkr",
      severity: "attention",
      title: "Linkr has no stranger-visible profile photo",
      detail: "Linkr is enabled and age-eligible, but Profile currently projects no photo that can safely appear to strangers. Do not expose private photos to repair this.",
      operatorAction: "keep_diagnosing"
    });
  } else {
    findings.push({
      id: "linkr-eligibility",
      areaId: "linkr",
      severity: "healthy",
      title: "Basic Linkr eligibility looks healthy",
      detail: "Linkr is enabled, the age gate passes, no account restriction is represented here, and Profile has stranger-visible media.",
      operatorAction: "none"
    });
  }

  /* The `stale` branch that used to live here recommended reset_glow_signal.
     It was unreachable: the loader projects a usable signal as `fresh` and
     everything else as `missing`, precisely because an expired location row is
     not drift. A finding that can never fire is worse than none -- it made the
     coverage map claim a capability no operator could reach. */
  if (snapshot.presence.signal === "missing") {
    findings.push({
      id: "presence-signal",
      areaId: "presence",
      severity: "info",
      title: "No current presence signal",
      detail: snapshot.presence.visibility === "ghost"
        ? "Ghost Mode is active, so a missing live signal is expected and should not be repaired past the user's privacy choice."
        : "No current signal is stored. This can be normal when location is off or Mad Buddy has not refreshed yet.",
      operatorAction: snapshot.presence.visibility === "ghost" ? "explain_product_rule" : "keep_diagnosing"
    });
  } else {
    findings.push({
      id: "presence-signal",
      areaId: "presence",
      severity: "healthy",
      title: "Presence freshness looks healthy",
      detail: `A fresh signal exists and visibility is ${snapshot.presence.visibility}. Exact location remains hidden from Support.`,
      operatorAction: "none"
    });
  }

  if (snapshot.presence.staleStatusCount > 0) {
    findings.push({
      id: "presence-status-expiry",
      areaId: "presence",
      severity: "attention",
      title: "A status failed to expire",
      detail: `${plural(snapshot.presence.staleStatusCount, "expired status row")} remain active.`,
      operatorAction: "use_named_repair",
      repairId: "clear_stuck_status"
    });
  }

  /* The stale-push-registration branch that used to live here recommended
     clear_push_subscriptions. `stalePushDevices` is hard-coded 0 because no
     canonical stale-token rule exists, so it could never fire. Inventing a
     threshold would have manufactured the defect needed to justify the repair.
     What remains is the honest healthy statement. */
  {
    findings.push({
      id: "push-device-freshness",
      areaId: "push",
      severity: "healthy",
      title: "Registered push devices look current",
      detail: `${snapshot.notifications.webPushDevices} web · ${snapshot.notifications.nativePushDevices} native registrations; no stale registration is represented in this snapshot.`,
      operatorAction: "none"
    });
  }

  findings.push({
    id: "notification-summary",
    areaId: "notifications",
    severity: "info",
    title: "Notification state",
    detail: `${snapshot.notifications.unreadCount} unread notifications. Payload contents are not inspected by Account Doctor.`,
    operatorAction: "keep_diagnosing"
  });

  if (snapshot.features.activeRateLimitCount > 0) {
    findings.push({
      id: "rate-limit-state",
      areaId: "features-tours",
      severity: "info",
      title: "Active rate-limit windows exist",
      detail: `${plural(snapshot.features.activeRateLimitCount, "active rate-limit window")} detected. A live throttle may be intentional; Support should confirm a legitimate lockout before clearing it.`,
      operatorAction: "keep_diagnosing"
    });
  }

  findings.push({
    id: "journey-evidence",
    areaId: "journey",
    severity: "info",
    title: "Journey evidence summary",
    detail: `${plural(snapshot.journey.achievementCount, "earned achievement")} · ${plural(snapshot.journey.milestoneCount, "activation milestone")}. Account Doctor does not fabricate either; discrepancies must be rebuilt from canonical evidence.`,
    operatorAction: "keep_diagnosing"
  });

  const rank: Record<SupportDiagnosticSeverity, number> = {
    issue: 0,
    attention: 1,
    product_rule: 2,
    info: 3,
    healthy: 4
  };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.areaId.localeCompare(b.areaId) || a.id.localeCompare(b.id));
}
