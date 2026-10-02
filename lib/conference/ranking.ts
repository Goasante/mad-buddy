import type { ConferenceTopic } from "@/lib/conference/types";

export const CONFERENCE_INACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const CONFERENCE_NEGATIVE_HIDE_SCORE = -5;

/**
 * Hype/Pass is the community approval signal. Once a Topic reaches a net score
 * of -5 it leaves discovery, while the row remains available to moderation and
 * retention systems.
 */
export function isConferenceTopicSuppressed(
  topic: Pick<ConferenceTopic, "hypeCount" | "passCount">
) {
  return topic.hypeCount - topic.passCount <= CONFERENCE_NEGATIVE_HIDE_SCORE;
}

/**
 * A strongly down-voted Voice is collapsed rather than deleted. This keeps the
 * flat conversation readable while still allowing somebody to reveal it.
 */
export function isConferenceVoiceCollapsed(
  voice: { hypeCount: number; passCount: number }
) {
  return voice.hypeCount - voice.passCount <= CONFERENCE_NEGATIVE_HIDE_SCORE;
}

/**
 * Hot is deliberately Hype-led. Voices add conversational momentum, but their
 * contribution is capped so a small argument cannot outrank broad community
 * interest. Positive activity moves lastActivityAt, allowing an old Topic to
 * reheat; otherwise heat has an eight-hour half-life.
 */
export function conferenceHotScore(
  topic: Pick<ConferenceTopic, "hypeCount" | "passCount" | "replyCount" | "lastActivityAt">,
  nowMs = Date.now()
) {
  const activityAgeHours = Math.max(
    0,
    (nowMs - Date.parse(topic.lastActivityAt)) / 3_600_000
  );
  const decay = Math.pow(0.5, activityAgeHours / 8);
  const voiceMomentum = Math.min(topic.replyCount, 12) * 0.75;
  const engagement =
    topic.hypeCount * 4 +
    voiceMomentum -
    topic.passCount * 5;

  return engagement * decay;
}
