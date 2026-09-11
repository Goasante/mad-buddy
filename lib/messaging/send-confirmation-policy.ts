export const SENT_CONFIRMATION_DELAYS_MS = [500, 2_000, 8_000, 30_000] as const;

/**
 * A successful send acknowledgement means the row is durable, not that the
 * Realtime echo has already reached this device. We therefore schedule a tiny
 * targeted confirmation by clientMessageId and let Realtime cancel it when it
 * wins the race. This is deliberately one-row reconciliation, never a full
 * thread reload.
 */
export function firstSentConfirmationDelayMs() {
  return SENT_CONFIRMATION_DELAYS_MS[0];
}
