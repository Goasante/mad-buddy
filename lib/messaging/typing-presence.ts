export const TYPING_PRESENCE_HEARTBEAT_MS = 5_000;

export function shouldPublishTypingPresence({
  typing,
  wasTyping,
  lastPublishedAt,
  now,
  heartbeatMs = TYPING_PRESENCE_HEARTBEAT_MS
}: {
  typing: boolean;
  wasTyping: boolean;
  lastPublishedAt: number;
  now: number;
  heartbeatMs?: number;
}) {
  if (!typing) return wasTyping;
  if (!wasTyping) return true;
  return now - lastPublishedAt >= heartbeatMs;
}
