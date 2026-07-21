import { describe, expect, it } from "vitest";
import {
  classifyJobHealth,
  EMERGENCY_CONTROL_META,
  EMERGENCY_CONTROL_ORDER,
  isEmergencyControl,
  isRetryableJobStatus,
  jobStatusLabel,
  jobStatusTone,
  JOB_STATUSES,
  rateLimitPressure,
  type JobHealthCounts
} from "@/lib/admin/app-health";

const HEALTHY: JobHealthCounts = { queued: 0, retrying: 0, failed: 0, deadLetter: 0, stuck: 0 };

describe("emergency control metadata", () => {
  it("covers every ordered control and marks the location controls safety-critical", () => {
    for (const key of EMERGENCY_CONTROL_ORDER) {
      expect(EMERGENCY_CONTROL_META[key]).toBeDefined();
    }
    expect(EMERGENCY_CONTROL_META.proximity.safetyCritical).toBe(true);
    expect(EMERGENCY_CONTROL_META.location_collection.safetyCritical).toBe(true);
    expect(EMERGENCY_CONTROL_META.event_glow.safetyCritical).toBe(true);
    expect(EMERGENCY_CONTROL_META.messaging.safetyCritical).toBe(false);
  });

  it("validates control keys", () => {
    expect(isEmergencyControl("proximity")).toBe(true);
    expect(isEmergencyControl("teleport")).toBe(false);
  });
});

describe("job queue health", () => {
  it("is healthy with a clean queue", () => {
    expect(classifyJobHealth(HEALTHY).level).toBe("healthy");
  });

  it("is down when dead-letter or stuck jobs exist", () => {
    expect(classifyJobHealth({ ...HEALTHY, deadLetter: 1 }).level).toBe("down");
    expect(classifyJobHealth({ ...HEALTHY, stuck: 2 }).level).toBe("down");
  });

  it("is degraded on failures, retries, or a large backlog", () => {
    expect(classifyJobHealth({ ...HEALTHY, failed: 1 }).level).toBe("degraded");
    expect(classifyJobHealth({ ...HEALTHY, retrying: 3 }).level).toBe("degraded");
    expect(classifyJobHealth({ ...HEALTHY, queued: 500 }).level).toBe("degraded");
  });

  it("labels and tones statuses, and flags retryable ones", () => {
    for (const status of JOB_STATUSES) expect(jobStatusLabel(status)).not.toBe("");
    expect(jobStatusTone("failed")).toBe("danger");
    expect(jobStatusTone("completed")).toBe("success");
    expect(isRetryableJobStatus("dead_letter")).toBe(true);
    expect(isRetryableJobStatus("failed")).toBe(true);
    expect(isRetryableJobStatus("completed")).toBe(false);
  });
});

describe("rate-limit pressure", () => {
  it("classifies window pressure", () => {
    expect(rateLimitPressure(10, 100)).toBe("ok");
    expect(rateLimitPressure(85, 100)).toBe("high");
    expect(rateLimitPressure(100, 100)).toBe("throttling");
    expect(rateLimitPressure(5, 0)).toBe("ok");
  });
});
