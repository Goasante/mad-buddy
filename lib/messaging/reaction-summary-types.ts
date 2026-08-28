export type ReactionReactor = {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
};

export type ReactionAggregate = {
  reaction: "heart" | "laugh" | "thumbs_up" | "wave" | "fire" | "wow";
  count: number;
  reactors: ReactionReactor[];
};

export type MessageReactionSummaryMap = Record<string, ReactionAggregate[]>;
