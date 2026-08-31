"use client";

import {
  MessageComposerV3,
  type OptimisticSendDraftV3
} from "@/components/messaging/message-composer-v3";
import type { MentionCandidate } from "@/lib/messaging/mentions";
import type { VoiceRecorderConfig } from "@/lib/messaging/voice-recording";

export type OptimisticSendDraft = OptimisticSendDraftV3;

type MessageComposerProps = {
  conversationId: string;
  placeholder: string;
  onFeedback: (message: string) => void;
  onSent: () => void | Promise<void>;
  onOptimisticSend?: (message: OptimisticSendDraft) => void;
  onOptimisticSettled?: (clientMessageId: string, outcome: "sent" | "failed") => void;
  voiceRecorderConfig: VoiceRecorderConfig;
  className?: string;
  isGroup?: boolean;
  mentionCandidates?: readonly MentionCandidate[];
};

/**
 * Canonical compatibility entrypoint.
 *
 * Messaging V5 converges every legacy caller onto the richer V3 composer
 * rather than maintaining a second microphone, attachment picker, or mention
 * implementation. Group/Plan/Circle surfaces can keep importing
 * `MessageComposer`; their backend contracts and caller props do not change.
 */
export function MessageComposer(props: MessageComposerProps) {
  return <MessageComposerV3 {...props} />;
}
