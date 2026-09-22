import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FEEDBACK_VIBRATION_PATTERNS,
  feedbackPattern,
  registerNativeFeedbackHandler,
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

const ROOT = process.cwd();
const semanticSource = fs.readFileSync(path.join(ROOT, "lib/feedback/feedback.ts"), "utf8");
const deviceSource = fs.readFileSync(path.join(ROOT, "lib/device/haptics.ts"), "utf8");

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

  it("exposes a registration seam for future native haptics without a global DOM event", () => {
    expect(typeof registerNativeFeedbackHandler).toBe("function");
    expect(semanticSource).not.toContain("window.dispatchEvent");
    expect(semanticSource).not.toContain("CustomEvent");
  });

  it("keeps raw vibration in the canonical device adapter", () => {
    expect(semanticSource).toContain('from "@/lib/device/haptics"');
    expect(semanticSource).not.toContain("navigator.vibrate");
    expect(deviceSource).toContain("navigator.vibrate");
    expect(deviceSource).toContain("export function vibratePattern");
  });
});
