import type { SubscriptionPlan, VerificationType } from "@/lib/supabase/database.types";

/**
 * Friend Discovery rules + Account Trust (feature architecture batch 8,
 * spec §2-§18, §49-§63). Pure and deterministic.
 *
 * Two product stances encoded here:
 *  - Discovery is never proximity-based. There is deliberately no "nearby
 *    people" method in DiscoveryMethod — a stranger cannot be found by being
 *    physically close (spec §2).
 *  - Trust is not a score and not purchasable. Verification levels describe
 *    specific facts; a paid plan grants none of them (spec §58).
 */

// ---------------------------------------------------------------------------
// Discovery methods + privacy defaults (spec §4, §5)
// ---------------------------------------------------------------------------

export type DiscoveryMethod =
  | "username"
  | "phone"
  | "email"
  | "mutual_muddies"
  | "shared_community"
  | "invite"
  | "qr";

export type DiscoverySettings = {
  searchableByUsername: boolean;
  searchableByPhone: boolean;
  searchableByEmail: boolean;
  searchableInCommunities: boolean;
  searchableViaMutuals: boolean;
  hiddenFromDiscovery: boolean;
};

/** Sensitive identifiers are OFF until the user consents (spec §5). */
export const DEFAULT_DISCOVERY_SETTINGS: DiscoverySettings = {
  searchableByUsername: true,
  searchableByPhone: false,
  searchableByEmail: false,
  searchableInCommunities: true,
  searchableViaMutuals: true,
  hiddenFromDiscovery: false
};

export function normalizeDiscoverySettings(raw: unknown): DiscoverySettings {
  const base = DEFAULT_DISCOVERY_SETTINGS;
  if (!raw || typeof raw !== "object") return base;
  const value = raw as Partial<DiscoverySettings>;
  const bool = (input: unknown, fallback: boolean) => (typeof input === "boolean" ? input : fallback);
  return {
    searchableByUsername: bool(value.searchableByUsername, base.searchableByUsername),
    searchableByPhone: bool(value.searchableByPhone, base.searchableByPhone),
    searchableByEmail: bool(value.searchableByEmail, base.searchableByEmail),
    searchableInCommunities: bool(value.searchableInCommunities, base.searchableInCommunities),
    searchableViaMutuals: bool(value.searchableViaMutuals, base.searchableViaMutuals),
    hiddenFromDiscovery: bool(value.hiddenFromDiscovery, base.hiddenFromDiscovery)
  };
}

export type DiscoverEligibility = {
  discoverable: boolean;
  reason: "blocked" | "hidden" | "method_disabled" | "self" | "allowed";
};

/**
 * Whether `viewer` may discover `target` through `method`. Blocks win, then a
 * global hide, then the per-method consent. Invite and QR always work: the
 * target handed over the token themselves, which is consent by definition.
 */
export function canDiscoverUser(input: {
  isSelf: boolean;
  isBlockedEitherDirection: boolean;
  settings: DiscoverySettings;
  method: DiscoveryMethod;
}): DiscoverEligibility {
  if (input.isSelf) return { discoverable: false, reason: "self" };
  if (input.isBlockedEitherDirection) return { discoverable: false, reason: "blocked" };

  // A token the target generated is explicit consent — it bypasses the global
  // hide, which exists to stop *search*, not to break the user's own invites.
  if (input.method === "invite" || input.method === "qr") {
    return { discoverable: true, reason: "allowed" };
  }

  if (input.settings.hiddenFromDiscovery) return { discoverable: false, reason: "hidden" };

  const enabled: Record<Exclude<DiscoveryMethod, "invite" | "qr">, boolean> = {
    username: input.settings.searchableByUsername,
    phone: input.settings.searchableByPhone,
    email: input.settings.searchableByEmail,
    mutual_muddies: input.settings.searchableViaMutuals,
    shared_community: input.settings.searchableInCommunities
  };

  return enabled[input.method as Exclude<DiscoveryMethod, "invite" | "qr">]
    ? { discoverable: true, reason: "allowed" }
    : { discoverable: false, reason: "method_disabled" };
}

// ---------------------------------------------------------------------------
// Search ranking (spec §7)
// ---------------------------------------------------------------------------

export type SearchCandidate = {
  userId: string;
  exactUsernameMatch: boolean;
  contactMatch: boolean;
  hasPendingInvite: boolean;
  sharedVerifiedCommunity: boolean;
  mutualCount: number;
  nameSimilarity: number; // 0..1
};

/**
 * Ranks by *how you know them*, never by popularity, engagement, proximity, or
 * paid tier (spec §7). mutualCount contributes a small, capped nudge — it is a
 * tie-breaker, not a popularity ranking.
 */
export function searchRankScore(candidate: SearchCandidate): number {
  let score = 0;
  if (candidate.exactUsernameMatch) score += 1000;
  if (candidate.contactMatch) score += 500;
  if (candidate.hasPendingInvite) score += 250;
  if (candidate.sharedVerifiedCommunity) score += 100;
  score += Math.min(candidate.mutualCount, 10) * 5; // capped on purpose
  score += Math.round(candidate.nameSimilarity * 10);
  return score;
}

export function rankSearchCandidates(candidates: SearchCandidate[]): SearchCandidate[] {
  return [...candidates].sort((a, b) => {
    const diff = searchRankScore(b) - searchRankScore(a);
    if (diff !== 0) return diff;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Friend requests (spec §10, §11, §16)
// ---------------------------------------------------------------------------

export const REQUEST_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export function requestExpiresAtMs(nowMs: number): number {
  return nowMs + REQUEST_EXPIRY_MS;
}

export type RequestLimits = { perDay: number };

export const REQUEST_LIMITS: Record<SubscriptionPlan, RequestLimits> = {
  free: { perDay: 20 },
  buddy_plus: { perDay: 50 },
  buddy_pro: { perDay: 50 }
};

/** New accounts get a lower ceiling regardless of plan (spec §11, §56). */
export const NEW_ACCOUNT_REQUEST_LIMIT = 5;
export const NEW_ACCOUNT_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export function isNewAccount(createdAtMs: number, nowMs: number): boolean {
  return nowMs - createdAtMs < NEW_ACCOUNT_AGE_MS;
}

/**
 * Effective daily request cap. A new account is capped low even on a paid
 * plan — anti-spam overrides paid limits (spec §11).
 */
export function effectiveRequestLimit(input: {
  plan: SubscriptionPlan;
  accountCreatedAtMs: number;
  nowMs: number;
}): number {
  const planLimit = (REQUEST_LIMITS[input.plan] ?? REQUEST_LIMITS.free).perDay;
  if (isNewAccount(input.accountCreatedAtMs, input.nowMs)) {
    return Math.min(planLimit, NEW_ACCOUNT_REQUEST_LIMIT);
  }
  return planLimit;
}

export type SendRequestInput = {
  isSelf: boolean;
  isBlockedEitherDirection: boolean;
  alreadyFriends: boolean;
  hasPendingOutgoing: boolean;
  hasPendingIncoming: boolean;
  sentToday: number;
  dailyLimit: number;
};

export type SendRequestResult = {
  allowed: boolean;
  reason:
    | "self"
    | "blocked"
    | "already_friends"
    | "duplicate_request"
    | "reciprocal_pending"
    | "limit_reached"
    | "allowed";
};

/**
 * Whether a request may be sent. `reciprocal_pending` is the both-sent-at-once
 * case (spec §17): rather than creating a second request, the caller should
 * accept the incoming one — which is what makes the pair converge on exactly
 * one friendship.
 */
export function resolveSendRequest(input: SendRequestInput): SendRequestResult {
  if (input.isSelf) return { allowed: false, reason: "self" };
  if (input.isBlockedEitherDirection) return { allowed: false, reason: "blocked" };
  if (input.alreadyFriends) return { allowed: false, reason: "already_friends" };
  if (input.hasPendingIncoming) return { allowed: false, reason: "reciprocal_pending" };
  if (input.hasPendingOutgoing) return { allowed: false, reason: "duplicate_request" };
  if (input.sentToday >= input.dailyLimit) return { allowed: false, reason: "limit_reached" };
  return { allowed: true, reason: "allowed" };
}

/** Neutral decline copy — never harsh (spec §12). */
export const DECLINE_MESSAGE = "Your request was not accepted.";

// ---------------------------------------------------------------------------
// Account trust (spec §50-§58)
// ---------------------------------------------------------------------------

export type VerificationLevel = "basic" | "confirmed" | "community_verified" | "official";

/**
 * Derives the level from verified facts only. Note there is no `plan` input:
 * payment cannot grant trust (spec §58).
 */
export function resolveVerificationLevel(verified: {
  email: boolean;
  phone: boolean;
  institution: boolean;
  organisation: boolean;
}): VerificationLevel | null {
  if (verified.organisation) return "official";
  if (verified.institution) return "community_verified";
  if (verified.email && verified.phone) return "confirmed";
  if (verified.email) return "basic";
  return null;
}

/** Badge copy. Never says "unverified" — absence isn't an accusation (§51). */
export function verificationBadgeLabel(level: VerificationLevel): string {
  switch (level) {
    case "official":
      return "Official organisation";
    case "community_verified":
      return "University confirmed";
    case "confirmed":
      return "Phone confirmed";
    case "basic":
      return "Email confirmed";
  }
}

export function verificationTypeLabel(type: VerificationType): string {
  switch (type) {
    case "email":
      return "Email";
    case "phone":
      return "Phone";
    case "institution":
      return "University";
    case "organisation":
      return "Organisation";
  }
}

/** Coarse account-age label — never an exact signup timestamp (spec §54). */
export function accountAgeLabel(createdAtMs: number, nowMs: number): string {
  const ageMs = nowMs - createdAtMs;
  if (ageMs < NEW_ACCOUNT_AGE_MS) return "New account";
  if (ageMs < 365 * 24 * 60 * 60 * 1000) return "Joined this year";
  return "Established account";
}

export type PublicTrustSummary = {
  verificationLevel: VerificationLevel | null;
  badgeLabel: string | null;
  mutualCount: number;
  accountAgeLabel: string;
  sharedCommunity: string | null;
};

/**
 * The only trust data another user ever sees. Deliberately excludes internal
 * risk signals, decline/block rates, and exact timestamps (spec §57).
 */
export function buildPublicTrustSummary(input: {
  verified: { email: boolean; phone: boolean; institution: boolean; organisation: boolean };
  mutualCount: number;
  accountCreatedAtMs: number;
  nowMs: number;
  sharedCommunity: string | null;
}): PublicTrustSummary {
  const level = resolveVerificationLevel(input.verified);
  return {
    verificationLevel: level,
    badgeLabel: level ? verificationBadgeLabel(level) : null,
    mutualCount: input.mutualCount,
    accountAgeLabel: accountAgeLabel(input.accountCreatedAtMs, input.nowMs),
    sharedCommunity: input.sharedCommunity
  };
}
