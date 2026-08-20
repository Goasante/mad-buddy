/**
 * Strip JS/TS comments from a source string.
 *
 * Used by the copy-policy tests: several source files carry comments that
 * deliberately NAME a banned word in order to state the rule forbidding it
 * ("the word LIVE is never shown"). Asserting on raw source would flag those
 * explanations; asserting on the stripped source checks what actually renders.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
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
