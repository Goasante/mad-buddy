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
  /** True when a registered native adapter handled the semantic feedback. */
  nativeHandled: boolean;
};

/**
 * Future Capacitor/native shells register one adapter from their bootstrap.
 * Keeping this as an in-module callback (rather than a global DOM event) means
 * third-party page scripts cannot observe Mad Buddy's semantic feedback events.
 * A native adapter can start an async Haptics call and return true immediately.
 */
export type NativeFeedbackHandler = (kind: FeedbackKind) => boolean;
let nativeFeedbackHandler: NativeFeedbackHandler | null = null;

export function registerNativeFeedbackHandler(handler: NativeFeedbackHandler): () => void {
  nativeFeedbackHandler = handler;
  return () => {
    if (nativeFeedbackHandler === handler) nativeFeedbackHandler = null;
  };
}

/**
 * One semantic feedback vocabulary for the whole product.
 *
 * The numbers are milliseconds, not "strength". Android browsers that expose
 * vibration receive these restrained patterns through the existing canonical
 * device adapter in lib/device/haptics.ts. iPhone Safari/PWA has no general
 * vibration API, so this layer quietly no-ops there while the calling
 * component keeps its visual motion. A future Capacitor shell can register a
 * native handler without changing product call sites.
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

export function feedbackPattern(kind: FeedbackKind): number[] {
  return [...FEEDBACK_VIBRATION_PATTERNS[kind]];
}

function tryNativeFeedback(kind: FeedbackKind): boolean {
  if (!nativeFeedbackHandler) return false;
  try {
    return nativeFeedbackHandler(kind) === true;
  } catch {
    // Native feedback is decorative. A bridge/plugin problem must never affect
    // the social action whose result we are acknowledging.
    return false;
  }
}

/**
 * Trigger semantic feedback without making support part of product logic.
 *
 * - SSR/server rendering: no-op.
 * - iPhone PWA: vibration no-ops; the calling component keeps visual motion.
 * - Android PWA: the canonical device adapter vibrates when supported/visible.
 * - Future Capacitor: a registered native handler takes precedence.
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

  const nativeHandled = tryNativeFeedback(kind);
  if (nativeHandled) return { kind, vibrated: false, nativeHandled: true };

  // Keep rapid product moments discrete. Both operations are capability-safe;
  // on iPhone PWA, blocked policies, or hidden documents they simply no-op.
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
