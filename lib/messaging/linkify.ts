export type MessageTextToken =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string; href: string; internal: boolean };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[),.!?:;]+$/;
const INTERNAL_HOSTS = new Set(["mad-buddy.com", "www.mad-buddy.com"]);

/** Safe plain-text linkification: no HTML parsing and HTTP(S) only. */
export function tokenizeMessageText(text: string): MessageTextToken[] {
  const tokens: MessageTextToken[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) tokens.push({ kind: "text", value: text.slice(cursor, start) });
    const raw = match[0];
    const trailing = raw.match(TRAILING_PUNCTUATION)?.[0] ?? "";
    const candidate = trailing ? raw.slice(0, -trailing.length) : raw;
    try {
      const parsed = new URL(candidate);
      const internal = INTERNAL_HOSTS.has(parsed.hostname.toLowerCase());
      tokens.push({
        kind: "link",
        value: candidate,
        href: internal ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString(),
        internal
      });
    } catch {
      tokens.push({ kind: "text", value: candidate });
    }
    if (trailing) tokens.push({ kind: "text", value: trailing });
    cursor = start + raw.length;
  }
  if (cursor < text.length) tokens.push({ kind: "text", value: text.slice(cursor) });
  return tokens.length > 0 ? tokens : [{ kind: "text", value: text }];
}
