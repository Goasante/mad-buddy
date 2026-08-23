/**
 * Database contract checker — the MB-GOD-020 defect class, repo-wide.
 *
 * `GET /api/account/export` returned 500 for EVERY user because it selected
 * `profiles.onboarding_complete`, a column that does not exist. TypeScript
 * cannot catch that: a Supabase select list is a plain string. The route also
 * discarded the Postgres error, so the failure was invisible.
 *
 * The brief's instruction is explicit — do not assume the export was the only
 * place. This checks every `.from("table").select("...")` and `.eq("column",…)`
 * in server code against the GENERATED database types, which are derived from
 * the real schema.
 *
 * Deliberately NOT a coverage exercise. It reports only what would actually
 * break at runtime: a column Postgres will reject with 42703. Embedded
 * resources, aliases, aggregates and computed selects are skipped rather than
 * guessed at, because a checker that cries wolf is a checker people mute.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = "C:/mb-god";
const TYPES = readFileSync(join(ROOT, "lib/supabase/database.types.ts"), "utf8");

/** Column names for one table, read out of the generated Row type. */
function columnsFor(table) {
  const anchor = TYPES.indexOf(`      ${table}: {`);
  if (anchor === -1) return null;
  const rowStart = TYPES.indexOf("Row:", anchor);
  if (rowStart === -1) return null;
  const open = TYPES.indexOf("{", rowStart);
  let depth = 0;
  let index = open;
  for (; index < TYPES.length; index += 1) {
    if (TYPES[index] === "{") depth += 1;
    else if (TYPES[index] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  let block = TYPES.slice(open, index + 1);
  // `Row: RowWithTimestamps & { … }` — the shared columns belong to the row too.
  if (TYPES.slice(rowStart, open).includes("RowWithTimestamps")) {
    const sharedStart = TYPES.indexOf("type RowWithTimestamps = {");
    block += TYPES.slice(sharedStart, TYPES.indexOf("};", sharedStart));
  }
  /* Column names are matched after `{` or `;`, NOT at line starts.
     Some Row types are declared multi-line and others on a single line
     (`Row: { id: string; user_id: string; ... }`). A line-anchored pattern
     matched nothing for the single-line ones, so all 8 such tables reported
     EVERY column as unknown — 161 false findings. Verified against the real
     database: earned_premium_rewards has 15 columns and exists. */
  const names = new Set();
  /* A column may follow `{`, `;` OR a comment line, so newlines count as
     separators too. Requiring `{`/`;` alone missed every column preceded by a
     comment (e.g. profiles.username_normalized, which sits under "Added by the
     batch-9 profiles migration") and reported 8 existing columns as unknown. */
  for (const match of block.matchAll(/^\s*(?:\/\/[^\n]*\n\s*)?([a-z_][a-z0-9_]*)\??\s*:/gm)) {
    names.add(match[1]);
  }
  // Single-line Row types (`Row: { id: string; user_id: string; … }`) have no
  // line starts to anchor on, so those are read off the semicolons.
  for (const match of block.matchAll(/[{;]\s*([a-z_][a-z0-9_]*)\??\s*:/g)) {
    names.add(match[1]);
  }
  return names;
}

function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (["node_modules", ".next", ".git", ".hardening"].includes(e.name)) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith(".ts") && !e.name.endsWith(".tsx")) continue;
      if (e.name.includes(".test.")) continue;
      out.push(full);
    }
  };
  walk(dir);
  return out;
}

const files = [
  ...sourceFiles(join(ROOT, "app")),
  ...sourceFiles(join(ROOT, "lib"))
];

const findings = [];
const unknownTables = new Set();
let checkedSelects = 0;
let checkedFilters = 0;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const rel = relative(ROOT, file).split(sep).join("/");

  // .from("table") … .select("a, b, c") — the select must follow the from.
  for (const m of source.matchAll(/\.from\(\s*"([a-z_]+)"\s*\)([\s\S]{0,400}?)\.select\(\s*"([^"]*)"/g)) {
    const [, table, between, list] = m;
    // Another .from() in between means these are not the same chain.
    if (between.includes(".from(")) continue;
    const columns = columnsFor(table);
    if (!columns) { unknownTables.add(table); continue; }
    checkedSelects += 1;
    /* Remove EMBEDDED RELATIONS before splitting on commas.
       `plans!inner(status, completed_at, end_at)` belongs to the embedded table,
       not to the one being selected from — but a naive split on "," turns its
       inner columns into apparent columns of the outer table. That produced the
       only three findings that survived the first correction
       (tour_versions.title/description, plan_participants.completed_at), and all
       three were verified against the live schema as belonging to the embed. */
    const flat = list.replace(/[a-z_]+!?[a-z]*\([^()]*\)/gi, "");
    for (const raw of flat.split(",")) {
      const col = raw.trim();
      // Skip what is not a plain column: *, aliases, aggregates, counts.
      if (!col || col === "*" || /[(){}:!*]/.test(col)) continue;
      if (!columns.has(col)) {
        const line = source.slice(0, m.index).split(/\r?\n/).length;
        findings.push({ kind: "select", file: rel, line, table, column: col });
      }
    }
  }

  // .from("table") … .eq("column", …) / .neq / .gt / .lt / .is / .in / .order
  for (const m of source.matchAll(
    /\.from\(\s*"([a-z_]+)"\s*\)([\s\S]{0,600}?)\.(eq|neq|gt|gte|lt|lte|is|in|order)\(\s*"([a-z_][a-z0-9_]*)"/g
  )) {
    const [, table, between, op, column] = m;
    if (between.includes(".from(")) continue;
    const columns = columnsFor(table);
    if (!columns) { unknownTables.add(table); continue; }
    checkedFilters += 1;
    if (!columns.has(column)) {
      const line = source.slice(0, m.index).split(/\r?\n/).length;
      findings.push({ kind: op, file: rel, line, table, column });
    }
  }
}

console.log(`=== DATABASE CONTRACT CHECK ===`);
console.log(`files scanned      : ${files.length}`);
console.log(`select lists checked: ${checkedSelects}`);
console.log(`filters checked     : ${checkedFilters}`);
console.log(`tables not in generated types (skipped): ${unknownTables.size}`);
if (unknownTables.size) console.log(`  ${[...unknownTables].sort().join(", ")}`);

if (!findings.length) {
  console.log(`\nNo unknown columns. MB-GOD-020's defect class does not recur.`);
} else {
  console.log(`\n${findings.length} REFERENCE(S) TO COLUMNS NOT IN THE GENERATED TYPES:\n`);
  for (const f of findings) {
    console.log(`  ${f.file}:${f.line}`);
    console.log(`      ${f.table}.${f.column}   (.${f.kind})`);
  }
}
