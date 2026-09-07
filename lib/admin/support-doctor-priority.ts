import type { SupportCategory } from "@/lib/admin/support";

export type DoctorAreaId =
  | "account-auth"
  | "onboarding-activation"
  | "profile-media"
  | "dob-age"
  | "muddies-requests"
  | "blocks-refriend"
  | "direct-messaging"
  | "plan-chat"
  | "plans"
  | "upfor"
  | "linkr"
  | "presence"
  | "notifications"
  | "push"
  | "events"
  | "safe-arrival"
  | "access-billing"
  | "features-tours"
  | "journey"
  | "privacy-account-ops";

export type SupportDoctorPriorityInput = {
  category: SupportCategory | string | null | undefined;
  affectedFeature?: string | null;
};

const CATEGORY_PRIORITY: Partial<Record<SupportCategory, readonly DoctorAreaId[]>> = {
  getting_started: ["account-auth", "onboarding-activation", "profile-media", "dob-age"],
  muddies: ["muddies-requests", "blocks-refriend", "direct-messaging", "linkr"],
  visibility: ["presence", "linkr", "notifications"],
  location: ["presence", "upfor", "safe-arrival"],
  plans: ["plans", "plan-chat", "upfor", "events"],
  billing: ["access-billing"],
  privacy: ["privacy-account-ops", "blocks-refriend", "safe-arrival"],
  security: ["account-auth", "privacy-account-ops", "blocks-refriend"],
  communities: ["events", "notifications", "privacy-account-ops"],
  reporting: ["privacy-account-ops", "blocks-refriend"],
  account_deletion: ["privacy-account-ops", "account-auth"],
  other: []
};

const FEATURE_HINTS: readonly { needles: readonly string[]; areas: readonly DoctorAreaId[] }[] = [
  { needles: ["message", "chat", "inbox", "voice note", "dm"], areas: ["direct-messaging", "blocks-refriend"] },
  { needles: ["plan chat"], areas: ["plan-chat", "plans"] },
  { needles: ["plan", "rsvp"], areas: ["plans", "plan-chat"] },
  { needles: ["upfor", "up for", "hangout"], areas: ["upfor", "plans", "plan-chat"] },
  { needles: ["linkr"], areas: ["linkr", "profile-media", "blocks-refriend"] },
  { needles: ["glow", "nearby", "location", "proximity", "ghost"], areas: ["presence"] },
  { needles: ["notification", "badge", "alert"], areas: ["notifications", "push"] },
  { needles: ["push", "device token"], areas: ["push", "notifications"] },
  { needles: ["event", "check-in", "checkin"], areas: ["events"] },
  { needles: ["safe arrival", "arrival", "journey home"], areas: ["safe-arrival"] },
  { needles: ["billing", "payment", "paystack", "subscription", "access"], areas: ["access-billing"] },
  { needles: ["profile", "photo", "avatar", "showcase", "media"], areas: ["profile-media"] },
  { needles: ["dob", "date of birth", "age"], areas: ["dob-age", "account-auth"] },
  { needles: ["onboarding", "activation", "getting started"], areas: ["onboarding-activation", "account-auth"] },
  { needles: ["friend", "muddy", "request"], areas: ["muddies-requests", "blocks-refriend"] },
  { needles: ["block", "unblock", "refriend", "re-friend"], areas: ["blocks-refriend", "direct-messaging"] },
  { needles: ["login", "sign in", "signin", "verification", "recovery", "password"], areas: ["account-auth"] },
  { needles: ["tour", "feature flag", "experiment", "rate limit"], areas: ["features-tours"] },
  { needles: ["achievement", "buddy score", "progression"], areas: ["journey"] },
  { needles: ["privacy", "delete account", "export", "report", "moderation"], areas: ["privacy-account-ops"] }
];

/**
 * Deterministic support-ticket routing for Account Doctor presentation.
 * It reorders checks only; it never changes permissions, repair eligibility or
 * the underlying diagnostic result.
 */
export function prioritizeDoctorAreas(input: SupportDoctorPriorityInput): DoctorAreaId[] {
  const ordered: DoctorAreaId[] = [];
  const add = (area: DoctorAreaId) => {
    if (!ordered.includes(area)) ordered.push(area);
  };

  const feature = input.affectedFeature?.trim().toLowerCase() ?? "";
  if (feature) {
    for (const hint of FEATURE_HINTS) {
      if (hint.needles.some((needle) => feature.includes(needle))) {
        for (const area of hint.areas) add(area);
      }
    }
  }

  const category = input.category as SupportCategory | null | undefined;
  if (category && category in CATEGORY_PRIORITY) {
    for (const area of CATEGORY_PRIORITY[category] ?? []) add(area);
  }

  return ordered;
}
