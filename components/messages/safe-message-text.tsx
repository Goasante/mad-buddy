"use client";

import type { Route } from "next";
import Link from "next/link";
import { tokenizeMessageText } from "@/lib/messaging/linkify";

export function SafeMessageText({ text }: { text: string }) {
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
