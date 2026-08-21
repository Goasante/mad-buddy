import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * The friendships query guard.
 *
 * `ended_at IS NULL` is the canonical definition of "currently Muddies". A read
 * of `friendships` that omits it treats an ENDED friendship as active — which
 * is not a cosmetic bug but an authorisation failure: unfriended people would
 * keep seeing Moments, keep being messageable, keep appearing in Socialize.
 *
 * The filter is easy to forget precisely because leaving it out looks correct
 * and passes every happy-path test (nothing has ended yet). So this scans the
 * source rather than trusting review, and fails on any new read that omits it.
 *
 * A read is ACCEPTED when either:
 *   - the chained call includes `.is("ended_at", null)` (or an explicit
 *     `ended_at` predicate inside `.or(...)`), or
 *   - it carries a `LIFE-HISTORICAL:` annotation saying why it deliberately
 *     wants ended rows too — a rebuild replaying history, an export of the
 *     user's own data, a recap counting friendships formed in a window.
 *
 * Writes are ignored: `.insert`, `.update` and `.delete` are not visibility
 * decisions, and an update that SETS `ended_at` obviously must not filter on
 * it being null.
 */

/** One `.from("friendships")` call site. */
export type FriendshipQuerySite = {
  file: string;
  line: number;
  /** The chained expression, as source. */
  snippet: string;
  kind: "read" | "write";
  hasEndedFilter: boolean;
  annotatedHistorical: boolean;
  /** A `.delete()` on friendships — a hard delete, which destroys identity. */
  isHardDelete: boolean;
};

export const HISTORICAL_ANNOTATION = "LIFE-HISTORICAL:";

/**
 * Marks a friendship hard delete that is intentional.
 *
 * Ending a relationship is a soft ending (`ended_at`) so its identity and
 * history survive and it can later reactivate. A DELETE destroys both, and is
 * legitimate in exactly one place — erasing an account — so it must say so.
 */
export const HARD_DELETE_ANNOTATION = "LIFE-HARD-DELETE:";

const SCAN_DIRECTORIES = ["app", "lib", "components"];
const SCAN_EXTENSIONS = [".ts", ".tsx"];
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  ".git",
  /* The guard's OWN fixtures.
   *
   * friendship-query-guard.test.ts writes throwaway source files -- including
   * one containing a deliberate hard delete -- under os.tmpdir(). On a machine
   * where the checkout itself lives beneath the temp directory (this repo is
   * routinely worked on from a temp worktree) those fixtures land INSIDE the
   * tree this scanner walks, and the deliberate delete is reported as a real
   * lifecycle regression. Intermittent, because it only fails when the two
   * suites overlap.
   *
   * Skipping the fixture prefix keeps the guard honest about product code and
   * blind to files written to test the guard. */
  "friendship-guard-fixtures"
]);

/** Fixture trees the guard writes for itself, matched by directory prefix. */
const FIXTURE_PREFIXES = ["friendship-guard-"];

/** Source files that participate in the guard. Tests are excluded. */
export function collectSourceFiles(root: string): string[] {
  const found: string[] = [];

  const walk = (directory: string) => {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(directory, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      if (FIXTURE_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!SCAN_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue;
      // A test may legitimately construct an unfiltered query as a fixture.
      if (entry.name.includes(".test.")) continue;
      found.push(full);
    }
  };

  for (const directory of SCAN_DIRECTORIES) walk(join(root, directory));
  return found;
}

/**
 * The chained expression that begins at `.from("friendships")`.
 *
 * Walks forward to the end of the statement rather than reading a fixed number
 * of lines: a chain may be one line or fifteen, and a fixed window would either
 * miss a filter below it or swallow the next statement's filter and call an
 * unfiltered query safe.
 *
 * The chain ends at the first `;`, `,` or blank line that is not nested inside
 * brackets opened by the chain itself. The COMMA matters: queries are commonly
 * written as elements of a `Promise.all([...])`, and stopping only at `;` would
 * run one element's chain through the rest of the array — reading a later
 * sibling's `.delete()` or `.is()` as if it belonged to this query.
 *
 * Depth starts at 0 and a closing bracket that would take it negative also
 * ends the chain, which is what terminates the LAST element of such an array.
 */
function chainFrom(source: string, startIndex: number): string {
  let depth = 0;
  let index = startIndex;
  for (; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") {
      // Unbalanced close: the chain's enclosing container is ending.
      if (depth === 0) break;
      depth -= 1;
    } else if ((character === ";" || character === ",") && depth <= 0) break;
    else if (character === "\n" && depth <= 0 && source.startsWith("\n\n", index)) break;
  }
  return source.slice(startIndex, index);
}

/**
 * Whether the annotation appears near the call site.
 *
 * Searched in the ~6 lines before `.from` and within the chain itself, because
 * the natural place to write it is either directly above the query or on the
 * `.from` line — as in `.from("friendships") // LIFE-HISTORICAL: ...`.
 */
function annotatedNearby(source: string, startIndex: number, chain: string, marker: string): boolean {
  if (chain.includes(marker)) return true;
  // Counted in LINES, not characters. A character budget silently shortens the
  // window when the comment explaining the exemption is itself long — which is
  // exactly when a well-documented exemption exists to be found.
  const lines = source.slice(0, startIndex).split(/\r?\n/).slice(-8);
  return lines.some((line) => line.includes(marker));
}

/**
 * Replace comment bodies with spaces, preserving length and newlines.
 *
 * Length-preserving on purpose: every offset computed on the blanked text —
 * line numbers, chain boundaries — stays valid against the original file.
 * Strings are tracked so a `//` inside a URL is not mistaken for a comment.
 */
function blankComments(source: string): string {
  const out = source.split("");
  let index = 0;
  let quote: string | null = null;

  while (index < source.length) {
    const character = source[index]!;

    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      index += 1;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      index += 1;
      continue;
    }

    if (source.startsWith("//", index)) {
      while (index < source.length && source[index] !== "\n") {
        out[index] = " ";
        index += 1;
      }
      continue;
    }

    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; index < stop; index += 1) {
        if (source[index] !== "\n") out[index] = " ";
      }
      continue;
    }

    // A regex literal must be consumed whole. Its character classes routinely
    // contain an unbalanced quote — this file's own matcher contains ["'] —
    // and treating that as a string opener desynchronises everything after it.
    if (character === "/" && startsRegex(source, index)) {
      index += 1;
      let inClass = false;
      for (; index < source.length; index += 1) {
        const current = source[index]!;
        if (current === "\\") index += 1;
        else if (current === "[") inClass = true;
        else if (current === "]") inClass = false;
        else if (current === "/" && !inClass) break;
        else if (current === "\n") break;
      }
      index += 1;
      continue;
    }

    index += 1;
  }

  return out.join("");
}

/**
 * Whether the `/` at `index` opens a regex literal rather than a division.
 *
 * Decided by the previous meaningful character: after a value (identifier,
 * number, closing bracket) a slash divides; after an operator, keyword or
 * opening bracket it starts a pattern. Good enough for source scanning —
 * this is a lint helper, not a JavaScript parser.
 */
function startsRegex(source: string, index: number): boolean {
  let back = index - 1;
  while (back >= 0 && /\s/.test(source[back]!)) back -= 1;
  if (back < 0) return true;
  const previous = source[back]!;
  if (/[)\]}\w$]/.test(previous)) {
    // `return /re/` and `typeof /re/` look like a value followed by a slash.
    const word = source.slice(Math.max(0, back - 9), back + 1).match(/[A-Za-z]+$/)?.[0];
    return word ? ["return", "typeof", "case", "in", "of", "new", "delete", "void"].includes(word) : false;
  }
  return true;
}

const FROM_FRIENDSHIPS = /\.from\((["'])friendships\1\)/g;

/** Every `.from("friendships")` site in one file. */
export function analyzeFile(root: string, file: string): FriendshipQuerySite[] {
  const raw = readFileSync(file, "utf8");
  // Prose is not a query. Comments are blanked (not removed) so line numbers
  // and offsets still line up with the real file — this guard's own
  // documentation quotes the very pattern it searches for, and a scanner that
  // reports its own docstring is a scanner nobody trusts.
  const source = blankComments(raw);
  const sites: FriendshipQuerySite[] = [];

  FROM_FRIENDSHIPS.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FROM_FRIENDSHIPS.exec(source)) !== null) {
    const chain = chainFrom(source, match.index);
    const isWrite = /\.(insert|update|upsert|delete)\s*\(/.test(chain);

    sites.push({
      file: relative(root, file).split(sep).join("/"),
      line: raw.slice(0, match.index).split(/\r?\n/).length,
      snippet: chain.trim().slice(0, 200),
      kind: isWrite ? "write" : "read",
      // Either the dedicated filter, or an ended_at predicate written inside a
      // composed .or(...) — both express the same thing to Postgres.
      hasEndedFilter:
        /\.is\(\s*(["'])ended_at\1\s*,\s*null\s*\)/.test(chain) || /ended_at\.is\.null/.test(chain),
      // Annotations live IN comments, so this reads the raw text. Offsets are
      // identical because blanking preserves length.
      annotatedHistorical: annotatedNearby(raw, match.index, chainFrom(raw, match.index), HISTORICAL_ANNOTATION),
      isHardDelete:
        /\.delete\s*\(/.test(chain) &&
        !annotatedNearby(raw, match.index, chainFrom(raw, match.index), HARD_DELETE_ANNOTATION)
    });
  }

  return sites;
}

/** Every site across the scanned tree. */
export function collectFriendshipQuerySites(root: string): FriendshipQuerySite[] {
  return collectSourceFiles(root).flatMap((file) => analyzeFile(root, file));
}

/**
 * Reads that neither filter on `ended_at` nor declare themselves historical.
 *
 * A non-empty result is the guard's failure list.
 */
export function unguardedFriendshipReads(sites: readonly FriendshipQuerySite[]): FriendshipQuerySite[] {
  return sites.filter(
    (site) => site.kind === "read" && !site.hasEndedFilter && !site.annotatedHistorical
  );
}

/**
 * Hard deletes that have not declared themselves.
 *
 * A DELETE destroys the pair's canonical identity, its created_at, and its
 * ability to reactivate — so ending a relationship must set `ended_at`
 * instead. Account erasure is the one legitimate exception and annotates
 * itself; anything else here is a lifecycle regression.
 */
export function undeclaredFriendshipDeletes(
  sites: readonly FriendshipQuerySite[]
): FriendshipQuerySite[] {
  return sites.filter((site) => site.isHardDelete);
}
