import { describe, expect, it } from "vitest";

import {
  FEEDBACK_EVENT,
  FEEDBACK_VIBRATION_PATTERNS,
  feedbackPattern,
  type FeedbackKind
} from "@/lib/feedback/feedback";

const KINDS: FeedbackKind[] = [
  "selection",
  "light",
  "wave",
  "success",
  "achievement",
  "important_success",
  "warning",
  "error",
  "long_press",
  "snap"
];

describe("interaction feedback vocabulary", () => {
  it("defines one bounded Android vibration pattern for every semantic kind", () => {
    expect(Object.keys(FEEDBACK_VIBRATION_PATTERNS).sort()).toEqual([...KINDS].sort());

    for (const kind of KINDS) {
      const pattern = feedbackPattern(kind);
      expect(pattern.length).toBeGreaterThan(0);
      expect(pattern.length).toBeLessThanOrEqual(3);
      for (const duration of pattern) {
        expect(Number.isInteger(duration)).toBe(true);
        expect(duration).toBeGreaterThan(0);
        expect(duration).toBeLessThanOrEqual(65);
      }
    }
  });

  it("keeps ordinary selection lighter than celebrations and errors", () => {
    expect(feedbackPattern("selection").reduce((sum, value) => sum + value, 0)).toBeLessThan(
      feedbackPattern("wave").reduce((sum, value) => sum + value, 0)
    );
    expect(feedbackPattern("wave").reduce((sum, value) => sum + value, 0)).toBeLessThan(
      feedbackPattern("achievement").reduce((sum, value) => sum + value, 0)
    );
    expect(feedbackPattern("achievement").reduce((sum, value) => sum + value, 0)).toBeLessThan(
      feedbackPattern("error").reduce((sum, value) => sum + value, 0)
    );
  });

  it("returns a fresh pattern so callers cannot mutate the product constants", () => {
    const first = feedbackPattern("success");
    first[0] = 999;
    expect(feedbackPattern("success")[0]).not.toBe(999);
  });

  it("exposes one stable event name for a future Capacitor native bridge", () => {
    expect(FEEDBACK_EVENT).toBe("mad-buddy:feedback");
  });
});
