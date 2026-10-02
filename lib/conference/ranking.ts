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
 * Hot is Hype-led:
 * - Topic Hype: +4
 * - Pass: -5
 * - each distinct person joining with a Voice: +1.5
 * - repeat Voices: +0.25 each, capped at 12 repeats
 * - heat cools with an eight-hour half-life from the latest positive activity
 *
 * New Voices and positive Hypes move lastActivityAt, so creation age alone does
 * not kill a Topic. Repeat replies cannot overpower broad Hype.
 */
export function conferenceHotScore(
  topic: Pick<
    ConferenceTopic,
    "hypeCount" | "passCount" | "replyCount" | "uniqueVoiceCount" | "lastActivityAt"
  >,
  nowMs = Date.now()
) {
  const activityAgeHours = Math.max(
    0,
    (nowMs - Date.parse(topic.lastActivityAt)) / 3_600_000
  );
  const decay = Math.pow(0.5, activityAgeHours / 8);
  const uniqueVoices = Math.min(topic.uniqueVoiceCount, topic.replyCount);
  const repeatVoices = Math.max(0, topic.replyCount - uniqueVoices);
  const voiceMomentum =
    uniqueVoices * 1.5 +
    Math.min(repeatVoices, 12) * 0.25;
  const engagement =
    topic.hypeCount * 4 +
    voiceMomentum -
    topic.passCount * 5;

  return engagement * decay;
}
