/**
 * @mentions: the parts that must be true regardless of any UI.
 *
 * PURE. No React, no database. Deciding who a message names is a security
 * question as much as a typing one, so the rules are arithmetic rather than
 * behaviour observed in a browser.
 *
 * IDENTITY IS THE USER ID, NEVER THE TEXT. A display name is presentation: it
 * changes, it repeats, and two people can share one. Matching "@Ama" against
 * names at send time would mean a rename silently redirects a mention, and two
 * Amas make it ambiguous. So the composer carries a structured list of chosen
 * user ids alongside the text, and the text is only ever a rendering of them.
 */

/** A member the sender picked, held apart from the text they typed. */
export type StructuredMention = {
  userId: string;
  /** The name as it was inserted, so the token can be found again in the text. */
  displayName: string;
};

/** A candidate the picker may offer. Mirrors the Circle's own member shape. */
export type MentionCandidate = {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
};

/**
 * The active `@` trigger at the caret, or null.
 *
 * A trigger is only live when the `@` begins a word -- at the start of the
 * text or after whitespace -- so an email address or a mid-word `@` never
 * opens the picker. The query runs to the caret and stops at whitespace,
 * because a mention is one token.
 */
export type MentionTrigger = {
  /** Index of the `@`. */
  start: number;
  /** Caret position, i.e. the end of the query. */
  end: number;
  /** What has been typed after the `@`, lowercased for matching. */
  query: string;
};

/** Longest name a mention query will chase before giving up. */
const MAX_QUERY_LENGTH = 40;

export function findMentionTrigger(text: string, caret: number): MentionTrigger | null {
  if (caret < 0 || caret > text.length) return null;

  // Walk back from the caret to the nearest "@", stopping at whitespace: a
  // mention token cannot contain a space, so whitespace means there is no
  // live trigger here.
  for (let index = caret - 1; index >= 0 && caret - index <= MAX_QUERY_LENGTH + 1; index -= 1) {
    const char = text[index];
    if (char === "@") {
      const before = index === 0 ? "" : text[index - 1];
      // Must begin a word, so "email@example.com" never triggers.
      if (before !== "" && !/\s/.test(before)) return null;
      return { start: index, end: caret, query: text.slice(index + 1, caret).toLowerCase() };
    }
    if (/\s/.test(char)) return null;
  }
  return null;
}

/**
 * Candidates for a query, best-first.
 *
 * Prefix matches rank above interior ones, so typing "am" offers Ama before
 * Kwame. Ordering is stable within each group, preserving whatever order the
 * caller's canonical membership list already applied.
 */
export function filterMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
  limit = 6
): MentionCandidate[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return candidates.slice(0, limit);

  const prefix: MentionCandidate[] = [];
  const contains: MentionCandidate[] = [];
  for (const candidate of candidates) {
    const name = candidate.displayName.toLowerCase();
    const handle = candidate.username.toLowerCase();
    if (name.startsWith(needle) || handle.startsWith(needle)) prefix.push(candidate);
    else if (name.includes(needle) || handle.includes(needle)) contains.push(candidate);
  }
  return [...prefix, ...contains].slice(0, limit);
}

/** Replace the trigger with the chosen name, and say where the caret lands. */
export function applyMentionSelection(
  text: string,
  trigger: MentionTrigger,
  candidate: MentionCandidate
): { text: string; caret: number } {
  // One trailing space, so the next word is typed without the picker
  // immediately reopening on the name just inserted.
  const token = `@${candidate.displayName} `;
  const next = text.slice(0, trigger.start) + token + text.slice(trigger.end);
  return { text: next, caret: trigger.start + token.length };
}

/**
 * Drop mentions whose token no longer survives in the text.
 *
 * Editing is destructive in ways structured state cannot see: deleting
 * "@Ama" leaves the id behind, and sending it would notify somebody whose
 * name is no longer in the message. Reconciling against the text on every
 * change keeps the two honest.
 *
 * Deliberately a SUBSET operation -- it can only remove. A mention is never
 * inferred from text, because that is the name-matching this design rejects.
 */
export function reconcileMentions(
  text: string,
  mentions: readonly StructuredMention[]
): StructuredMention[] {
  const seen = new Set<string>();
  return mentions.filter((mention) => {
    if (seen.has(mention.userId)) return false;
    if (!text.includes(`@${mention.displayName}`)) return false;
    seen.add(mention.userId);
    return true;
  });
}

/**
 * The ids to persist: unique, and never the sender.
 *
 * Mentioning yourself is legitimate in a sentence and must not notify you, so
 * the sender is dropped here rather than being filtered later in the
 * notification layer -- there is no reason to store a row that must always be
 * skipped. The database PK deduplicates too; doing it here keeps the payload
 * honest rather than relying on a conflict.
 */
export function mentionUserIdsForSend(
  mentions: readonly StructuredMention[],
  senderId: string
): string[] {
  return [...new Set(mentions.map((mention) => mention.userId))].filter((id) => id !== senderId);
}

/**
 * Split text into runs for rendering.
 *
 * The message stays one sentence in one bubble: a mention is emphasised text,
 * not a chip. Only the ids the SERVER stored are highlighted, so text that
 * merely looks like "@someone" is rendered plainly -- what is highlighted and
 * what was persisted can never disagree.
 */
export type MessageTextRun = { text: string; mentionedUserId: string | null };

export function splitTextWithMentions(
  text: string,
  mentions: readonly { userId: string; displayName: string; username?: string | null }[]
): MessageTextRun[] {
  if (!text || mentions.length === 0) return [{ text, mentionedUserId: null }];

  /**
   * A mention may have been written as EITHER of the names a person is known
   * by, so both are candidates for the match.
   *
   * The picker inserts whatever it displayed, and the surfaces that host a
   * picker do not all display the same thing: the inbox offers
   * `full_name || username`, while a Circle's member list comes from a
   * projection that can only supply a username for a member whose profile it
   * could not fully read. The renderer used to search for the projected
   * display name alone, so a mention inserted as "@ama_s" against a projection
   * of "Ama Serwaa" stored correctly, notified correctly, and then rendered as
   * ordinary text -- the name vanished the instant the message came back from
   * the server.
   *
   * Matching either name closes that gap for good, and it cannot over-claim:
   * every candidate here is an id the SERVER already stored as a mention on
   * THIS message. An alias is only ever offered for a person who really was
   * mentioned.
   */
  const aliases = mentions.flatMap((mention) => {
    const names = [mention.displayName, mention.username].filter(
      (name): name is string => Boolean(name && name.trim())
    );
    return [...new Set(names)].map((name) => ({ userId: mention.userId, name }));
  });

  // Longest name first, so "@Ama Serwaa" is not half-matched by "@Ama".
  const ordered = aliases.sort((a, b) => b.name.length - a.name.length);
  const runs: MessageTextRun[] = [];
  let rest = text;

  while (rest.length > 0) {
    let bestIndex = -1;
    let best: { userId: string; name: string } | null = null;
    for (const mention of ordered) {
      const index = rest.indexOf(`@${mention.name}`);
      if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
        bestIndex = index;
        best = mention;
      }
    }
    if (bestIndex === -1 || !best) {
      runs.push({ text: rest, mentionedUserId: null });
      break;
    }
    if (bestIndex > 0) runs.push({ text: rest.slice(0, bestIndex), mentionedUserId: null });
    const token = `@${best.name}`;
    runs.push({ text: token, mentionedUserId: best.userId });
    rest = rest.slice(bestIndex + token.length);
  }

  return runs.filter((run) => run.text.length > 0);
}
