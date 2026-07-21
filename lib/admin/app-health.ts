/**
 * App Health domain logic.
 *
 * Pure helpers shared by the App Health page and its actions. Reuses the
 * canonical EmergencyControl keys and the jobs status set — no new model. No
 * private data ever flows through here: only operational counts and labels.
 */

import type { EmergencyControl } from "@/lib/admin/governance";

// --- Emergency controls ---------------------------------------------------
export type EmergencyControlMeta = {
  key: EmergencyControl;
  label: string;
  description: string;
  /** Safety-critical controls fail CLOSED and outrank uptime (spec §47). */
  safetyCritical: boolean;
};

export const EMERGENCY_CONTROL_META: Record<EmergencyControl, EmergencyControlMeta> = {
  proximity: { key: "proximity", label: "Proximity / glow", description: "Nearby discovery and glow signals.", safetyCritical: true },
  location_collection: { key: "location_collection", label: "Location collection", description: "Ingesting device location updates.", safetyCritical: true },
  event_glow: { key: "event_glow", label: "Event glow", description: "Event-scoped proximity glow.", safetyCritical: true },
  messaging: { key: "messaging", label: "Messaging", description: "Direct and group messaging.", safetyCritical: false },
  media_uploads: { key: "media_uploads", label: "Media uploads", description: "Photo/moment/drop uploads.", safetyCritical: false },
  invite_links: { key: "invite_links", label: "Invite links", description: "Invite creation and resolution.", safetyCritical: false },
  payments: { key: "payments", label: "Payments", description: "Checkout and billing operations.", safetyCritical: false },
  contact_matching: { key: "contact_matching", label: "Contact matching", description: "Contact-based discovery.", safetyCritical: false }
};

export const EMERGENCY_CONTROL_ORDER: readonly EmergencyControl[] = [
  "proximity",
  "location_collection",
  "event_glow",
  "messaging",
  "media_uploads",
  "invite_links",
  "payments",
  "contact_matching"
];

export function isEmergencyControl(value: string): value is EmergencyControl {
  return value in EMERGENCY_CONTROL_META;
}

// --- Job queue ------------------------------------------------------------
export const JOB_STATUSES = [
  "queued",
  "scheduled",
  "processing",
  "completed",
  "failed",
  "retrying",
  "dead_letter"
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: "Queued",
  scheduled: "Scheduled",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  retrying: "Retrying",
  dead_letter: "Dead letter"
};

export function jobStatusLabel(status: string): string {
  return JOB_STATUS_LABELS[status as JobStatus] ?? status;
}

/** A job can be requeued from a terminal-ish failure state. */
export function isRetryableJobStatus(status: string): boolean {
  return status === "failed" || status === "dead_letter";
}

export type JobHealthCounts = {
  queued: number;
  retrying: number;
  failed: number;
  deadLetter: number;
  /** Jobs stuck in `processing` past the stale threshold. */
  stuck: number;
};

export type HealthLevel = "healthy" | "degraded" | "down";

export type JobHealth = { level: HealthLevel; label: string; tone: "success" | "warning" | "danger" };

/** Backlog above this many queued jobs reads as degraded throughput. */
export const QUEUE_BACKLOG_DEGRADED = 100;

/**
 * Classifies queue health from operational counts only. Dead-letter or stuck
 * jobs mean something is actively broken; failures/retries or a large backlog
 * mean degraded; otherwise healthy.
 */
export function classifyJobHealth(counts: JobHealthCounts): JobHealth {
  if (counts.deadLetter > 0 || counts.stuck > 0) {
    return { level: "down", label: "Needs attention", tone: "danger" };
  }
  if (counts.failed > 0 || counts.retrying > 0 || counts.queued > QUEUE_BACKLOG_DEGRADED) {
    return { level: "degraded", label: "Degraded", tone: "warning" };
  }
  return { level: "healthy", label: "Healthy", tone: "success" };
}

export function jobStatusTone(status: string): "default" | "success" | "warning" | "danger" {
  if (status === "completed") return "success";
  if (status === "failed" || status === "dead_letter") return "danger";
  if (status === "retrying" || status === "processing") return "warning";
  return "default";
}

// --- Rate-limit hotspots --------------------------------------------------
/** A single window's count relative to its limit signals pressure. */
export function rateLimitPressure(count: number, limit: number): "ok" | "high" | "throttling" {
  if (limit <= 0) return "ok";
  const ratio = count / limit;
  if (ratio >= 1) return "throttling";
  if (ratio >= 0.8) return "high";
  return "ok";
}
