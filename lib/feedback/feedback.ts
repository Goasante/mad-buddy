import { cancelHaptics, vibratePattern } from "@/lib/device/haptics";

export type FeedbackKind =
  | "selection"
  | "light"
  | "wave"
  | "success"
  | "achievement"
  | "important_success"
  | "warning"
  | "error"
  | "long_press"
  | "snap";

export type FeedbackResult = {
  kind: FeedbackKind;
  /** True only when the web Vibration API accepted the pattern. */
  vibrated: boolean;
  /**
   * True when a future native bridge intercepted the event and called
   * preventDefault(). Web vibration then stands down so native haptics never
   * double-fire with the browser fallback.
   */
  nativeHandled: boolean;
};

/**
 * One semantic feedback vocabulary for the whole product.
 *
 * The numbers are milliseconds, not "strength". Android browsers that expose
 * vibration receive these restrained patterns through the existing canonical
 * device adapter in lib/device/haptics.ts. iPhone Safari/PWA has no general
 * vibration API, so this layer quietly no-ops there while the calling
 * component keeps its visual motion. Future Capacitor iOS can listen for
 * FEEDBACK_EVENT, trigger a native Taptic/Haptics effect, and preventDefault()
 * to suppress the web fallback without changing call sites.
 */
export const FEEDBACK_VIBRATION_PATTERNS = {
  selection: [10],
  light: [16],
  wave: [16, 28, 16],
  success: [22, 35, 22],
  achievement: [28, 45, 28],
  important_success: [32, 55, 32],
  warning: [36, 50, 36],
  error: [60, 40, 60],
  long_press: [28],
  snap: [8]
} as const satisfies Record<FeedbackKind, readonly number[]>;

/** Native wrappers may intercept this cancelable event. */
export const FEEDBACK_EVENT = "mad-buddy:feedback";

export function feedbackPattern(kind: FeedbackKind): number[] {
  return [...FEEDBACK_VIBRATION_PATTERNS[kind]];
}

/**
 * Trigger semantic feedback without making support part of product logic.
 *
 * - SSR/server rendering: no-op.
 * - iPhone PWA: event is emitted for future native bridges; vibration no-ops.
 * - Android PWA: the canonical device adapter vibrates when supported/visible.
 * - Future Capacitor: bridge handles the event and calls preventDefault().
 *
 * We deliberately do NOT synthesize audio here. Realtime achievements and
 * waves can arrive without a user gesture, and iOS/WebKit may block an audio
 * context in that state. Sound can be added later to explicit, user-triggered
 * controls without making a background notification unreliable.
 */
export function triggerFeedback(kind: FeedbackKind): FeedbackResult {
  if (typeof window === "undefined") {
    return { kind, vibrated: false, nativeHandled: false };
  }

  let nativeHandled = false;
  try {
    const event = new CustomEvent<{ kind: FeedbackKind }>(FEEDBACK_EVENT, {
      detail: { kind },
      cancelable: true
    });

    // dispatchEvent returns false when a listener called preventDefault(). That
    // is the native bridge's "I handled this" signal.
    nativeHandled = !window.dispatchEvent(event);
  } catch {
    // Even the bridge event is optional. A missing/blocked DOM event primitive
    // must never turn decorative feedback into an application failure.
    nativeHandled = false;
  }

  if (nativeHandled) return { kind, vibrated: false, nativeHandled: true };

  // Keep rapid product moments discrete. Both operations are capability-safe;
  // on iPhone PWA, SSR, blocked policies, or hidden documents they simply no-op.
  cancelHaptics();
  const vibrated = vibratePattern(feedbackPattern(kind));
  return { kind, vibrated, nativeHandled: false };
}

export const feedback = {
  selection: () => triggerFeedback("selection"),
  light: () => triggerFeedback("light"),
  wave: () => triggerFeedback("wave"),
  success: () => triggerFeedback("success"),
  achievement: () => triggerFeedback("achievement"),
  importantSuccess: () => triggerFeedback("important_success"),
  warning: () => triggerFeedback("warning"),
  error: () => triggerFeedback("error"),
  longPress: () => triggerFeedback("long_press"),
  snap: () => triggerFeedback("snap")
} as const;
