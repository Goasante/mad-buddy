/**
 * The narrow slice of a Linkr mutual connection that Home's Smart Card needs.
 *
 * Structurally satisfied by `ClickedPerson` from
 * lib/linkr/collections-service, so Home passes that reader's rows straight
 * through with no mapping layer. It is declared separately only because the
 * providers are pure and must not import a "server-only" module -- importing
 * the type would drag the whole service into the client bundle.
 *
 * PRIVACY. Only MUTUAL connections belong here. Linkr never reveals one-sided
 * interest, so a card built from this can say "you and Ama connected" without
 * telling anybody something the other person did not choose to share.
 */
export type LinkrMutualForCard = {
  userId: string;
  displayName: string;
  photo: string | null;
  /** Already talking. Not a moment, and not something to nag about. */
  hasConversation: boolean;
  /**
   * The Event this pair connected AT, or null.
   *
   * Read from `linkr_connections.event_id`, which the mutual-connect
   * transaction writes at the moment two people match through Event Mode. It is
   * the pair's OWN shared fact, not an overlap computed from two attendance
   * histories: people who both went to the same Event but connected through
   * ordinary Linkr carry null here, and the card must not claim they met there.
   */
  eventName?: string | null;
};
