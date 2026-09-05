"use client";

import type { Route } from "next";
import Link from "next/link";
import { splitTextWithMentions } from "@/lib/messaging/mentions";
import { tokenizeMessageText } from "@/lib/messaging/linkify";

/**
 * A mention this message really carries, as the SERVER stored it.
 *
 * `username` is what makes it navigable -- the canonical profile route is
 * `/friends/{username}` -- and it is nullable because a member whose profile
 * the viewer cannot fully read still deserves to have their name rendered.
 */
type MessageMention = {
  userId: string;
  displayName: string;
  username: string | null;
};

type SafeMessageTextProps = {
  text: string;
  /**
   * Structured mention identity already validated by the messaging service.
   *
   * IDENTITY, NOT TEXT. Each entry is a user id the server persisted against
   * THIS message, so what is highlighted can never claim more than what was
   * stored and notified. Text that merely looks like "@someone" is rendered
   * plainly, and no amount of typing "@" can manufacture a link to an account.
   */
  mentions?: ReadonlyArray<MessageMention>;
};

/** The one profile route in the product. Never a raw user id. */
function profileHref(username: string): Route {
  return `/friends/${encodeURIComponent(username)}` as Route;
}

/**
 * Message text: safe links, and mentions that are real people.
 *
 * TWO PASSES, LINKS FIRST (BETA-013).
 *
 * `mentions` was declared on this component's props, passed in by every V4
 * bubble, and then dropped on the floor -- the implementation destructured
 * only `text`. So the structured identity the composer chose, the service
 * authorised and the database stored arrived at the renderer and was thrown
 * away, and "@Ama" reached the reader as grey prose.
 *
 * The ORDER of the two passes is the whole safety argument, and it is links
 * first for a reason that is easy to get backwards:
 *
 *   1. `tokenizeMessageText` finds the URLs. A URL is an indivisible span.
 *   2. `splitTextWithMentions` runs ONLY over the text between those URLs.
 *
 * Doing mentions first looks equally safe and is not: the mention splitter
 * searches for "@Name" anywhere in the string it is given, so a link like
 * `https://example.com/@Ama/photos` gets cut into three pieces and the URL is
 * destroyed -- half of it rendered as prose and somebody's name turned into a
 * profile link in the middle of a stranger's address. Reserving the URL spans
 * first makes that structurally impossible rather than merely unlikely.
 *
 * Within the text runs, identity is still the server's: `splitTextWithMentions`
 * only ever highlights ids stored against THIS message, and matches the LONGEST
 * alias first, so "@Ama Serwaa" is never half-claimed by a second member called
 * "Ama". Text that merely looks like "@someone" stays prose -- no regex ever
 * invents an account from what somebody typed.
 *
 * NO `dangerouslySetInnerHTML`, here or anywhere below. Every piece is a React
 * text child, so message text can never become markup.
 */
export function SafeMessageText({ text, mentions }: SafeMessageTextProps) {
  const list = mentions ?? [];

  return tokenizeMessageText(text).flatMap((token, tokenIndex) => {
    if (token.kind === "link") {
      return [
        token.internal ? (
          <Link key={`link-${tokenIndex}`} href={token.href as Route} className="break-all font-medium underline decoration-current/60 underline-offset-2">
            {token.value}
          </Link>
        ) : (
          <a key={`link-${tokenIndex}`} href={token.href} target="_blank" rel="noopener noreferrer" className="break-all font-medium underline decoration-current/60 underline-offset-2">
            {token.value}
          </a>
        )
      ];
    }

    return splitTextWithMentions(token.value, list).map((run, runIndex) => {
      const key = `${tokenIndex}-${runIndex}`;
      if (!run.mentionedUserId) return <span key={`text-${key}`}>{run.text}</span>;

      const mention = list.find((entry) => entry.userId === run.mentionedUserId);
      const username = mention?.username?.trim() || null;

      /* Emphasis with no destination, when there is nowhere honest to go.
       *
       * A member with no readable username has no profile route, and inventing
       * one -- or falling back to the user id -- would either 404 or publish an
       * internal identifier in the address bar. The name still reads as a
       * mention, because it genuinely is one; it simply is not a link. */
      if (!username) {
        return (
          <span
            key={`mention-${key}`}
            className="font-semibold text-primary"
            aria-label={`mentioned ${run.text.slice(1)}`}
          >
            {run.text}
          </span>
        );
      }

      return (
        <Link
          key={`mention-${key}`}
          href={profileHref(username)}
          prefetch={false}
          className="focus-ring rounded font-semibold text-primary underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current"
          aria-label={`View ${run.text.slice(1)}'s profile`}
        >
          {run.text}
        </Link>
      );
    });
  });
}
