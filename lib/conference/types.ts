export type ConferenceSort = "fresh" | "hot";
export type ConferenceVote = "hype" | "pass";
export type ConferenceReportReason =
  | "harassment"
  | "threat_or_violence"
  | "sexual_content"
  | "hate_or_discrimination"
  | "spam"
  | "scam"
  | "impersonation"
  | "private_information"
  | "unwanted_contact"
  | "dangerous_location_sharing"
  | "other";
export type ConferenceTargetType = "topic" | "reply";

export type ConferenceReplyContext = {
  id: string;
  voiceLabel: string;
  body: string;
};

export type ConferenceReply = {
  id: string;
  voiceLabel: string;
  body: string;
  createdAt: string;
  hypeCount: number;
  passCount: number;
  yourVote: ConferenceVote | null;
  isYours: boolean;
  replyTo: ConferenceReplyContext | null;
};

export type ConferenceTopic = {
  id: string;
  voiceLabel: string;
  body: string;
  createdAt: string;
  lastActivityAt: string;
  hypeCount: number;
  passCount: number;
  replyCount: number;
  uniqueVoiceCount: number;
  yourVote: ConferenceVote | null;
  isYours: boolean;
};

export type ConferenceTopicDetail = ConferenceTopic & {
  replies: ConferenceReply[];
};

export type ConferenceFeedResult = {
  locationAvailable: boolean;
  locationStale: boolean;
  accessRestricted: boolean;
  topics: ConferenceTopic[];
};

export type ConferenceActionResult = {
  ok: boolean;
  message: string;
  topicId?: string;
  replyId?: string;
  createdAt?: string;
  stale?: boolean;
};
