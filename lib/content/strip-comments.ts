/**
 * Strip JS/TS comments from a source string.
 *
 * Used by the copy-policy tests: several source files carry comments that
 * deliberately NAME a banned word in order to state the rule forbidding it
 * ("the word LIVE is never shown"). Asserting on raw source would flag those
 * explanations; asserting on the stripped source checks what actually renders.
 */
export function stripComments(source: string): string {
  /* STRING-AWARE, because the naive regex silently ate real code.
   *
   * `accept="image/*"` contains `/*`, so a plain /\*[\s\S]*?\*\/ match treated
   * the rest of the file as a comment until it found a `*​/` -- deleting
   * everything in between. Source-scan tests then asserted against a mangled
   * file and reported the code as missing when it was right there. A test that
   * fails for a reason unrelated to the product is worse than no test.
   *
   * So this walks the source once, tracking whether it is inside a quote, and
   * only treats `/*` and `//` as comment starts outside one. */
  let out = "";
  let i = 0;
  let quote: string | null = null;

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (quote) {
      out += char;
      // A backslash escapes the next character, including the closing quote.
      if (char === "\\") {
        out += source[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      out += char;
      i += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }

    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}

/**
 * Comment-stripped source with every run of whitespace collapsed to one space.
 *
 * WHY. Source-scan tests assert that a rule is expressed in the code, but a
 * formatter can rewrap the same JSX across three lines without changing a
 * single thing it does -- and an exact-match assertion then fails for a reason
 * that has nothing to do with the product. That noise is worse than useless:
 * it trains you to "fix" tests reflexively, which is how a genuinely broken
 * assertion gets waved through.
 *
 * Collapsing whitespace keeps the assertion about MEANING. Use the plain
 * stripComments where indentation is itself the subject.
 */
export function stripFormatting(source: string): string {
  return stripComments(source).replace(/\s+/g, " ");
}
