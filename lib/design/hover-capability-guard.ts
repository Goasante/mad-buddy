import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * The hover-capability guard.
 *
 * WHY THIS EXISTS. `group-hover:` and `hover:` are POINTER capabilities. A
 * finger cannot produce a hover, so any affordance whose only route to being
 * visible is a hover state is, on a phone, permanently invisible.
 *
 * This shipped as MB-GOD-040. The message action row (React / Edit / Delete)
 * carried `opacity-0 transition-opacity group-hover:opacity-100`. On desktop it
 * was a considered piece of design — a quiet thread, actions on approach. On
 * every touch device it meant:
 *
 *   - the row sat at opacity 0 permanently, while `pointer-events` stayed
 *     `auto`, so three invisible controls remained tappable under the message;
 *   - the emoji picker lived in the same row, so the `React` item in the
 *     long-press menu — the ONE action offered on every message to every user —
 *     opened a picker nobody could see.
 *
 * Reading the JSX, none of that is visible. `group-hover:opacity-100` looks
 * like the reveal mechanism, and on the machine a developer is using, it is.
 *
 * THE FAILURE SHAPE. An element that is `opacity-0` (or `invisible`) whose only
 * un-hiding classes are hover-conditional. `focus-within:` does not rescue it:
 * a long-press has no keyboard equivalent, so on touch plus assistive
 * technology there is still no route.
 *
 * WHAT IS ACCEPTED. Gating the fade on `@media (any-hover: hover)` in CSS, the
 * way `.message-actions` does, so a device that cannot hover shows the control
 * permanently. Decorative changes (`group-hover:text-*`, `group-hover:scale-*`,
 * `group-hover:bg-*`) are fine — losing them costs a touch user nothing,
 * because the control was visible the whole time.
 */

export type HoverHiddenSite = {
  file: string;
  line: number;
  /** The className string, as source. */
  source: string;
};

/** Blanks comments length-preservingly so documentation cannot self-report. */
export function blankComments(source: string): string {
  let out = "";
  let i = 0;
  let state: "code" | "line" | "block" | "string" = "code";
  let quote = "";
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    const ch = source[i];
    if (state === "code") {
      if (two === "//") { state = "line"; out += "  "; i += 2; continue; }
      if (two === "/*") { state = "block"; out += "  "; i += 2; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { state = "string"; quote = ch; out += ch; i += 1; continue; }
      out += ch; i += 1; continue;
    }
    if (state === "string") {
      if (ch === "\\") { out += source.slice(i, i + 2); i += 2; continue; }
      if (ch === quote) state = "code";
      out += ch; i += 1; continue;
    }
    // Inside a comment: preserve newlines so line numbers stay truthful.
    if (state === "line" && ch === "\n") { state = "code"; out += "\n"; i += 1; continue; }
    if (state === "block" && two === "*/") { state = "code"; out += "  "; i += 2; continue; }
    out += ch === "\n" ? "\n" : " ";
    i += 1;
  }
  return out;
}

/**
 * Classes that HIDE an element outright. Only these make a hover dependency
 * dangerous; a colour or scale change does not hide anything.
 */
const HIDING = /(^|[\s"'`:])(opacity-0|invisible)(?=$|[\s"'`])/;

/** A hover-conditional class that restores visibility. */
const HOVER_REVEAL = /(group-hover|hover):(opacity-(?!0)\d+|visible)/;

/**
 * Finds elements hidden at rest whose only reveal is a hover.
 *
 * Works on the className string as written. A className built at runtime from
 * variables is out of scope — this catches the shape that shipped, and the
 * runtime probes in scripts/hardening cover behaviour.
 */
export function findHoverHiddenSites(source: string, file: string): HoverHiddenSite[] {
  const scrubbed = blankComments(source);
  const sites: HoverHiddenSite[] = [];

  const lines = scrubbed.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    // A className often spans several lines; join a small window so a class
    // list broken across lines is still seen as one declaration.
    const window = lines.slice(index, index + 4).join(" ");
    if (!HIDING.test(lines[index])) continue;
    if (!HOVER_REVEAL.test(window)) continue;
    sites.push({ file, line: index + 1, source: lines[index].trim().slice(0, 160) });
  }
  return sites;
}

function walk(dir: string, out: string[]): void {
  let entries: Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, out); continue; }
    if (/\.tsx$/.test(entry.name)) out.push(full);
  }
}

/**
 * Scans the app for the failure shape.
 *
 * Returns the file count alongside the sites so a scan that processed NOTHING
 * cannot be read as a clean bill of health -- the "zero files scanned must
 * fail" rule this program adopted after a Safe Arrival copy check pointed at
 * the wrong directory, found no files, and reported PASS.
 */
export function scanWithCount(roots: string[], repoRoot: string): { sites: HoverHiddenSite[]; scanned: number } {
  const files: string[] = [];
  for (const root of roots) walk(root, files);

  const sites: HoverHiddenSite[] = [];
  for (const file of files) {
    const rel = relative(repoRoot, file).split(sep).join("/");
    sites.push(...findHoverHiddenSites(readFileSync(file, "utf8"), rel));
  }
  return { sites, scanned: files.length };
}
