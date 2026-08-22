import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * The form method guard.
 *
 * WHY THIS EXISTS. A `<form>` whose only submit path is an `onSubmit` handler
 * still submits NATIVELY when the page's JavaScript has not run — a failed or
 * blocked chunk, a slow network that drops the bundle, an extension, JS turned
 * off. A form with no `method` defaults to **GET**, so the browser appends every
 * field to the URL, where it is written to browser history, server access logs
 * and any intermediate proxy or CDN.
 *
 * This is not hypothetical. It shipped twice:
 *
 *   MB-GOD-003  /login and /signup produced
 *               `?email=...&password=...` in the address bar.
 *   MB-GOD-010  /admin/login did the same with ADMIN credentials, and was
 *               missed by the first fix because that fix was scoped to
 *               components/auth/ rather than to the defect's shape.
 *
 * The second occurrence is the reason this guard exists rather than another
 * round of careful review: the defect is structural, invisible in any test that
 * runs JavaScript, and looks completely correct while reading the JSX.
 *
 * WHAT IS ACCEPTED. A form is safe when it declares either:
 *   - `method` (`method="post"` — fields travel in the request body), or
 *   - `action` (React's own form handling, which posts by design).
 *
 * A form with neither AND an `onSubmit` handler is the failure shape.
 *
 * WHAT THIS DOES NOT CLAIM. `method="post"` does not create a working non-JS
 * submit path; there is no non-JS endpoint, so the attempt still fails closed.
 * It only changes WHAT LEAKS WHEN IT FAILS.
 */

export type FormSite = {
  file: string;
  line: number;
  /** The opening tag, as source. */
  snippet: string;
  hasMethod: boolean;
  hasAction: boolean;
  hasOnSubmit: boolean;
};

const SCAN_DIRECTORIES = ["app", "components"];
const SKIP_DIRECTORIES = new Set(["node_modules", ".next", "dist", "build", ".git"]);

/** Source files that participate in the guard. Tests are excluded. */
export function collectFormSourceFiles(root: string): string[] {
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
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".tsx")) continue;
      // A test may legitimately construct an unsafe form as a fixture.
      if (entry.name.includes(".test.")) continue;
      found.push(full);
    }
  };

  for (const directory of SCAN_DIRECTORIES) walk(join(root, directory));
  return found;
}

/**
 * Replace comment bodies with spaces, preserving length and newlines.
 *
 * Length-preserving on purpose: line numbers computed against the blanked text
 * stay valid for the original file. Quotes are tracked so a `//` inside a string
 * (a URL, a className) is not mistaken for a comment.
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

    index += 1;
  }

  return out.join("");
}

/**
 * Every `<form ...>` opening tag in one file.
 *
 * Matched with a bounded pattern rather than parsed: attributes may span many
 * lines, but a form's opening tag always terminates at the first `>` that is not
 * inside a brace expression. Good enough for a lint guard, and it fails loud
 * rather than silent — a tag it cannot read is reported, not skipped.
 */
export function analyzeFormFile(root: string, file: string): FormSite[] {
  const raw = readFileSync(file, "utf8");
  /* Prose is not markup.
   *
   * Comments are BLANKED rather than removed, so every offset computed below —
   * line numbers especially — still lines up with the real file. This guard's
   * own fix notes quote the very tag it searches for ("a <form> with no method
   * defaults to GET"), and the first version of this scanner duly reported
   * components/auth/login-form.tsx:98 — its own documentation. A scanner that
   * reports its own explanation is one nobody trusts, and worse, it teaches the
   * next person to ignore it. */
  const source = blankComments(raw);
  const sites: FormSite[] = [];

  const pattern = /<form[\s>]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    // Walk to the end of the opening tag, tracking brace depth so a `>` inside
    // an expression like `onSubmit={() => ...}` does not end it early.
    let depth = 0;
    let index = match.index;
    for (; index < source.length; index += 1) {
      const character = source[index]!;
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      else if (character === ">" && depth === 0) break;
    }
    const tag = source.slice(match.index, index + 1);

    sites.push({
      file: relative(root, file).split(sep).join("/"),
      line: source.slice(0, match.index).split(/\r?\n/).length,
      snippet: tag.replace(/\s+/g, " ").slice(0, 160),
      hasMethod: /\bmethod\s*=/.test(tag),
      hasAction: /\baction\s*=/.test(tag),
      hasOnSubmit: /\bonSubmit\s*=/.test(tag)
    });
  }

  return sites;
}

/** Every form across the scanned tree. */
export function collectFormSites(root: string): FormSite[] {
  return collectFormSourceFiles(root).flatMap((file) => analyzeFormFile(root, file));
}

/**
 * Forms that would submit as GET without JavaScript.
 *
 * A non-empty result is the guard's failure list: each of these puts its fields
 * in the URL whenever the page's JavaScript has not run.
 */
export function unsafeNativeSubmitForms(sites: readonly FormSite[]): FormSite[] {
  return sites.filter((site) => site.hasOnSubmit && !site.hasMethod && !site.hasAction);
}
