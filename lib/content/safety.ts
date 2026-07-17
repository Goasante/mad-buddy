import type { ReportCategory } from "@/lib/supabase/database.types";

/**
 * Content Safety core (feature architecture batch 6, spec §48-§60). Pure and
 * deterministic: report categories, the block-revocation surface list, and the
 * exact-location warning heuristic.
 *
 * Design stance (spec §55): these checks WARN, they do not block. A public
 * meeting place ("Student Centre", "Accra Mall") is legitimate and common —
 * silently refusing to post it would break the product. The user decides.
 */

// ---------------------------------------------------------------------------
// Report categories (spec §49)
// ---------------------------------------------------------------------------

export const REPORT_CATEGORIES: Array<{ id: ReportCategory; label: string }> = [
  { id: "harassment", label: "Harassment" },
  { id: "threat_or_violence", label: "Threat or violence" },
  { id: "sexual_content", label: "Sexual content" },
  { id: "hate_or_discrimination", label: "Hate or discrimination" },
  { id: "spam", label: "Spam" },
  { id: "scam", label: "Scam" },
  { id: "impersonation", label: "Impersonation" },
  { id: "private_information", label: "Private information" },
  { id: "unwanted_contact", label: "Unwanted contact" },
  { id: "dangerous_location_sharing", label: "Dangerous location sharing" },
  { id: "other", label: "Other" }
];

export function isReportCategory(value: string): value is ReportCategory {
  return REPORT_CATEGORIES.some((category) => category.id === value);
}

/** Categories serious enough to route for human review (spec §48, §54). */
const HIGH_SEVERITY: ReadonlySet<ReportCategory> = new Set<ReportCategory>([
  "threat_or_violence",
  "sexual_content",
  "hate_or_discrimination",
  "private_information",
  "dangerous_location_sharing"
]);

export function requiresHumanReview(category: ReportCategory): boolean {
  return HIGH_SEVERITY.has(category);
}

export const REPORT_CONFIRMATION_MESSAGE =
  "Thanks. We've hidden this content and received your report.";

// ---------------------------------------------------------------------------
// Block revocation surface (spec §51)
// ---------------------------------------------------------------------------

/**
 * Everything a block must revoke. Enumerated so the block action can be
 * checked against the spec rather than drifting as features are added — if a
 * batch adds a new surface, it belongs here.
 */
export const BLOCK_REVOKES = [
  "friendship",
  "private_circle_membership",
  "glow",
  "status",
  "waves",
  "pings",
  "messaging",
  "moments",
  "drops",
  "event_glow",
  "future_invitations"
] as const;

export type BlockRevokedSurface = (typeof BLOCK_REVOKES)[number];

// ---------------------------------------------------------------------------
// Exact-location warning (spec §55)
// ---------------------------------------------------------------------------

export type LocationWarning = {
  warn: boolean;
  /** Which signal tripped — for telemetry/tests, never shown verbatim. */
  signals: LocationSignal[];
};

export type LocationSignal =
  | "coordinates"
  | "street_address"
  | "live_location_wording"
  | "alone_wording";

// Decimal coordinate pairs, e.g. "5.6037, -0.1870".
const COORDINATE_PATTERN = /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/;

// A street number followed by a street-type word: "12 Oxford Street".
const STREET_ADDRESS_PATTERN =
  /\b\d{1,5}[a-z]?\s+[\w'.-]+(?:\s+[\w'.-]+)*\s+(street|st|road|rd|avenue|ave|lane|ln|close|crescent|drive|dr|boulevard|blvd|way|court|ct|terrace|place|pl)\b/i;

const LIVE_LOCATION_PATTERN =
  /\b(my live location|sharing my location|track me|follow my location|here'?s my location|my exact location|my current location)\b/i;

// Vulnerability wording — "I'm alone at/in/on ...".
const ALONE_PATTERN = /\b(i'?m|i am)\s+(all\s+)?alone\s+(at|in|on|here)\b/i;

/**
 * Flags content that may reveal an exact location or unsafe situation. A
 * deliberately conservative heuristic: it must not fire on ordinary public
 * meeting places, because warning on every venue name would train users to
 * ignore the warning entirely.
 */
export function detectLocationRisk(text: string): LocationWarning {
  if (!text || !text.trim()) return { warn: false, signals: [] };

  const signals: LocationSignal[] = [];
  if (COORDINATE_PATTERN.test(text)) signals.push("coordinates");
  if (STREET_ADDRESS_PATTERN.test(text)) signals.push("street_address");
  if (LIVE_LOCATION_PATTERN.test(text)) signals.push("live_location_wording");
  if (ALONE_PATTERN.test(text)) signals.push("alone_wording");

  return { warn: signals.length > 0, signals };
}

export const LOCATION_WARNING_MESSAGE =
  "This may reveal an exact location. Share only with people you trust.";

// ---------------------------------------------------------------------------
// Basic spam heuristics (spec §54)
// ---------------------------------------------------------------------------

const URL_PATTERN = /https?:\/\/[^\s]+/gi;

export type SpamSignalInput = {
  text: string;
  /** How many posts this author made in the recent window. */
  recentPostCount: number;
  /** How many of those were byte-identical to this one. */
  identicalRecentCount: number;
};

export type SpamAssessment = {
  suspicious: boolean;
  signals: Array<"excessive_links" | "repetition" | "excessive_posting">;
};

/**
 * Cheap signals only — this never auto-removes anything (spec §54: don't rely
 * solely on automated moderation). It flags for review and rate limiting.
 */
export function assessSpam(input: SpamSignalInput): SpamAssessment {
  const signals: SpamAssessment["signals"] = [];

  const links = input.text.match(URL_PATTERN) ?? [];
  if (links.length >= 3) signals.push("excessive_links");
  if (input.identicalRecentCount >= 2) signals.push("repetition");
  if (input.recentPostCount >= 15) signals.push("excessive_posting");

  return { suspicious: signals.length > 0, signals };
}

export function extractLinks(text: string): string[] {
  return text.match(URL_PATTERN) ?? [];
}
