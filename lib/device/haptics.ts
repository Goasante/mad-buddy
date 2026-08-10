/**
 * Haptic feedback, in one capability-safe place.
 *
 * The Vibration API is unevenly supported and, on iOS Safari in particular,
 * absent entirely -- so every call site would otherwise need the same
 * feature-detection dance, and one that forgot it would throw on a real
 * device. This module is the only thing in the app allowed to touch
 * `navigator.vibrate`.
 *
 * ABSENCE IS NOT AN ERROR. Haptics are decoration on top of an interaction
 * that already works visually; when they are unavailable the interaction is
 * unchanged. Nothing here throws, and nothing reports failure to the caller,
 * because there is nothing a caller could usefully do about it.
 *
 * Durations are deliberately tiny. A vibration long enough to notice as a
 * buzz is a vibration that feels like an error; these are meant to read as a
 * tick under the finger.
 */

export type HapticPattern = "tick" | "select" | "close";

/**
 * Milliseconds per pattern.
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

/** True when this device can actually produce haptic feedback. */
export function hapticsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator & { vibrate?: unknown }).vibrate === "function"
  );
}

/**
 * Fires one haptic tick, if the device supports it.
 *
 * Safe to call unconditionally: on a device without vibration support, or
 * during server rendering, this does nothing at all.
 */
export function haptic(pattern: HapticPattern = "tick"): void {
  if (!hapticsSupported()) return;

  try {
    navigator.vibrate(PATTERN_MS[pattern]);
  } catch {
    // Some browsers throw when vibration is blocked by a permissions policy or
    // when the document has never been interacted with. That is not a failure
    // worth surfacing -- the visual interaction already happened.
  }
}

/**
 * Stops any vibration in progress.
 *
 * Used when a gesture is abandoned, so a queued tick does not fire after the
 * thing it was describing has gone.
 */
export function cancelHaptics(): void {
  if (!hapticsSupported()) return;
  try {
    navigator.vibrate(0);
  } catch {
    // As above.
  }
}
