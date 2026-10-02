import type { ConferenceTopic } from "@/lib/conference/types";

export const CONFERENCE_INACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const CONFERENCE_PASS_HIDE_MIN_VOTES = 5;

/**
 * Pass is a discovery signal, not a destructive moderation action. A Topic
 * only falls out of discovery after a meaningful sample: at least five Topic
 * votes, at least three more Passes than Hypes, and a two-thirds Pass share.
 * Direct links/moderation remain intact.
 */
export function isConferenceTopicSuppressed(
  topic: Pick<ConferenceTopic, "hypeCount" | "passCount">
) {
  const votes = topic.hypeCount + topic.passCount;
  return (
    votes >= CONFERENCE_PASS_HIDE_MIN_VOTES &&
    topic.passCount >= topic.hypeCount + 3 &&
    topic.passCount / votes >= 2 / 3
  );
}

/**
 * Hot rewards engagement but decays continuously from the latest positive
 * activity. Because lastActivityAt moves on a new Voice or Hype, an older
 * Topic can legitimately reheat without being treated as newly created.
 */
export function conferenceHotScore(
  topic: Pick<ConferenceTopic, "hypeCount" | "passCount" | "replyCount" | "lastActivityAt">,
  nowMs = Date.now()
) {
  const activityAgeHours = Math.max(
    0,
    (nowMs - Date.parse(topic.lastActivityAt)) / 3_600_000
  );
  const decay = Math.exp(-activityAgeHours / 18);
  const engagement =
    topic.hypeCount * 2 +
    Math.min(topic.replyCount, 30) * 1.6 -
    topic.passCount * 2.25;
  const recentActivityBoost = Math.max(0, 1 - activityAgeHours / 48) * 4;
  return engagement * decay + recentActivityBoost;
}
