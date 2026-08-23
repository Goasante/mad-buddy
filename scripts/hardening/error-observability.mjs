/**
 * Error observability — the OTHER half of MB-GOD-020.
 *
 * The wrong column was the bug; the DISCARDED error is why it survived. A route
 * that turns a Postgres failure into a generic 500 without recording the cause
 * is undiagnosable from outside: it just silently stops working.
 *
 * Finds API routes that return a 500 (or a generic failure) while never calling
 * the structured logger. The user-facing message may stay vague — that is
 * correct — but the internal record must exist.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = "C:/mb-god";
function routes(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { routes(full, out); continue; }
    if (e.name === "route.ts") out.push(full);
  }
  return out;
}

const files = routes(join(ROOT, "app/api"));
const findings = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const rel = relative(ROOT, file).split(sep).join("/");
  /* Only 500-level responses count, and 503 "not configured" guards are
     excluded: they report a MISSING ENV VAR, not a swallowed database error,
     and the message already says everything there is to record. Matching any
     5xx made app/api/billing/trials a permanent false positive — its only 5xx
     is `status: 503` for absent Supabase config. */
  const returns500 = /status:\s*50[0124]/.test(source);
  if (!returns500) continue;
  const logs = /logBackendEvent|logApiEvent|console\.error/.test(source);
  // Does it actually inspect a database error it then throws away?
  const touchesDbError = /\.error\b|error\s*\)/.test(source);
  if (!logs && touchesDbError) {
    const line = source.split(/\r?\n/).findIndex((l) => /status:\s*5\d\d/.test(l)) + 1;
    findings.push({ file: rel, line });
  }
}

console.log(`=== ERROR OBSERVABILITY ===`);
console.log(`API routes scanned: ${files.length}`);
if (!findings.length) {
  console.log(`\nEvery route that returns 5xx records the cause.`);
} else {
  console.log(`\n${findings.length} route(s) return 5xx without logging the cause:\n`);
  for (const f of findings) console.log(`  ${f.file}:${f.line}`);
}
