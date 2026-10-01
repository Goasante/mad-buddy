export type ConferenceSort = "fresh" | "hot";
export type ConferenceVote = "hype" | "pass";
export type ConferenceReportReason =\n  | "spam"\n  | "harassment"\n  | "hate_or_discrimination"\n  | "threat_or_violence"\n  | "private_information"\n  | "other";
export type ConferenceTargetType = "topic" | "reply";

export type ConferenceReply = {
  id: string;
  voiceLabel: string;
  body: string;
  createdAt: string;
  hypeCount: number;
  passCount: number;
  yourVote: ConferenceVote | null;
};

export type ConferenceTopic = {
  id: string;
  voiceLabel: string;
  body: string;
  createdAt: string;
  hypeCount: number;
  passCount: number;
  replyCount: number;
  yourVote: ConferenceVote | null;
};

export type ConferenceTopicDetail = ConferenceTopic & {
  replies: ConferenceReply[];
};

export type ConferenceFeedResult = {
  locationAvailable: boolean;
  locationStale: boolean;
  topics: ConferenceTopic[];
};

export type ConferenceActionResult = {
  ok: boolean;
  message: string;
  topicId?: string;
};
