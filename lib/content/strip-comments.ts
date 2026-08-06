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
