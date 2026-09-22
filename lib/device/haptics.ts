/**
 * Haptic feedback, in one capability-safe place.
 *
 * The Vibration API is unevenly supported and, on iOS Safari in particular,
 * absent entirely -- so every call site would otherwise need the same
 * feature-detection dance, and one that forgot it would throw on a real
 * device. This module is the only NEW code allowed to touch
 * `navigator.vibrate`; higher-level product semantics live in
 * lib/feedback/feedback.ts and delegate here.
 *
 * ABSENCE IS NOT AN ERROR. Haptics are decoration on top of an interaction
 * that already works visually; when they are unavailable the interaction is
 * unchanged. Nothing here throws.
 */

export type HapticPattern = "tick" | "select" | "close";
export type WebVibrationPattern = number | readonly number[];

/**
 * Milliseconds per legacy interaction pattern.
 *
 *   tick   -- the menu opened. Light: the user asked for this and can see it.
 *   select -- an action was chosen. Slightly firmer, as a confirmation that
 *             something is about to happen (a navigation).
 *   close  -- dismissal. The lightest of the three; closing is a return to
 *             rest and should not feel like an event.
 */
const PATTERN_MS: Record<HapticPattern, number> = {
  tick: 8,
  select: 14,
  close: 5
};

/** True when this device can actually produce web vibration feedback. */
export function hapticsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator & { vibrate?: unknown }).vibrate === "function"
  );
}

/**
 * Low-level capability-safe vibration primitive.
 *
 * Higher-level product code should not call this directly; it exists so the
 * semantic feedback layer can keep every raw Vibration API touch in this one
 * module. Hidden/background documents never vibrate: a buzz without visible
 * context is noise and can feel like an unrelated system notification.
 */
export function vibratePattern(pattern: WebVibrationPattern): boolean {
  if (!hapticsSupported()) return false;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;

  try {
    const value: number | number[] = typeof pattern === "number" ? pattern : [...pattern];
    return navigator.vibrate(value);
  } catch {
    // Some browsers throw when vibration is blocked by policy or when the
    // document has never been interacted with. Feedback remains decorative.
    return false;
  }
}

/**
 * Fires one legacy haptic tick, if the device supports it.
 *
 * Safe to call unconditionally: on a device without vibration support, during
 * server rendering, or from a hidden document, this does nothing at all.
 */
export function haptic(pattern: HapticPattern = "tick"): void {
  void vibratePattern(PATTERN_MS[pattern]);
}

/**
 * Stops any vibration in progress.
 *
 * Cancellation is allowed even when the page has just become hidden: stopping
 * an already-started pattern is safer than leaving it running without context.
 */
export function cancelHaptics(): void {
  if (!hapticsSupported()) return;
  try {
    navigator.vibrate(0);
  } catch {
    // As above.
  }
}
