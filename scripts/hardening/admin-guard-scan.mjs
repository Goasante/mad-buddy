/**
 * Mission 4 Extreme, Axis 5 — every admin mutation must be authorized.
 *
 * A missing server-side role check would be P0: admin UI that merely hides a
 * control is not enforcement, and these actions are directly reachable.
 *
 * Follows LOCAL WRAPPERS rather than guessing their names. Three earlier
 * attempts flagged 19 false positives because the authorization lives in a
 * per-file helper called `guard()`, `authorizeBilling()` or similar. A scanner
 * that only recognises the names it expects finds gaps that do not exist.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = "C:/mb-god";
const PRIMITIVES = /requireAdminPermission|requireAdminPagePermission|requireSafetyAdmin|getSafetyAdminContext/;

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name === "actions.ts") out.push(full);
  }
}
const files = [];
walk(join(ROOT, "app/(admin)"), files);

const unguarded = [];
let checked = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = file.split("\\").join("/").replace(ROOT + "/", "");

  /* Local helpers that themselves call an authorization primitive. These are
     what the exported actions delegate to. */
  const localGuards = new Set();
  for (const m of src.matchAll(/(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g)) {
    /* Scan from the DECLARATION, generously.
     *
     * The first version sliced 900 chars from the `(` and required the body to
     * start immediately. `tours/actions.ts` declares
     * `async function authorize(): Promise<AuthorizeResult> {` -- a return type
     * annotation between the parens and the brace -- and its authorization sits
     * a little further in, so three genuinely guarded actions were reported as
     * unguarded. A P0-shaped false positive is the most expensive kind. */
    const body = src.slice(m.index, m.index + 1400);
    if (PRIMITIVES.test(body)) localGuards.add(m[1]);
  }

  const exported = [...src.matchAll(/^export async function (\w+)/gm)];
  for (let i = 0; i < exported.length; i += 1) {
    const name = exported[i][1];
    const from = exported[i].index;
    const to = i + 1 < exported.length ? exported[i + 1].index : src.length;
    const body = src.slice(from, to);
    checked += 1;

    const direct = PRIMITIVES.test(body);
    // Plain substring, not a constructed regex: the helper names are ordinary
    // identifiers, and building a pattern from them was one escaping mistake
    // away from a crash that reads like a finding.
    const viaLocal = [...localGuards].some((g) => body.includes(`${g}(`));
    if (!direct && !viaLocal) unguarded.push(`${rel} :: ${name}`);
  }
}

console.log(`admin action files : ${files.length}`);
console.log(`exported actions   : ${checked}`);
console.log(`unguarded          : ${unguarded.length}`);
for (const u of unguarded) console.log(`  ⚠ ${u}`);
if (unguarded.length === 0) {
  console.log("\nevery exported admin action reaches an authorization primitive,");
  console.log("directly or through a local wrapper that calls one.");
}
