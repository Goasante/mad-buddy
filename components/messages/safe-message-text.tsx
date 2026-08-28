"use client";

import type { Route } from "next";
import Link from "next/link";
import { tokenizeMessageText } from "@/lib/messaging/linkify";

type SafeMessageTextProps = {
  text: string;
  /**
   * Structured mention identity already validated by the messaging service.
   * The current renderer remains text/link focused, but accepting the context
   * keeps shared message surfaces type-safe while mention-specific styling is
   * layered in separately.
   */
  mentions?: ReadonlyArray<{
    userId: string;
    displayName: string;
    username: string | null;
  }>;
};

export function SafeMessageText({ text }: SafeMessageTextProps) {
  return tokenizeMessageText(text).map((token, index) =>
    token.kind === "text" ? (
      token.value
    ) : token.internal ? (
      <Link key={`${token.href}-${index}`} href={token.href as Route} className="break-all font-medium underline decoration-current/60 underline-offset-2">
        {token.value}
      </Link>
    ) : (
      <a key={`${token.href}-${index}`} href={token.href} target="_blank" rel="noopener noreferrer" className="break-all font-medium underline decoration-current/60 underline-offset-2">
        {token.value}
      </a>
    )
  );
}
