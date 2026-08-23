import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The account data export must select columns that actually exist.
 *
 * WHY THIS TEST EXISTS. `GET /api/account/export` returned **500 for every
 * user** because it selected `profiles.onboarding_complete`, a column that does
 * not exist — the real one is `is_onboarded`. Nothing caught it:
 *
 *  - TypeScript could not: the select list is a plain STRING, so a wrong column
 *    name is not a type error.
 *  - No test covered it, because the route needs a live database.
 *  - The route DISCARDED the Postgres error and returned a generic message, so
 *    the failure was invisible from the outside. It was found by a click-crawl
 *    noticing a 500 in the console, and only diagnosable after the error was
 *    given a log line.
 *
 * A data export failing silently is a compliance problem, not a cosmetic one:
 * it is the mechanism by which a user exercises their right to their own data.
 *
 * This guard compares every column named in the route's select lists against
 * the generated database types, which are derived from the real schema. It runs
 * without a database, so it fails in CI the moment a column is renamed out from
 * under the export.
 */

const ROUTE = "app/api/account/export/route.ts";
const TYPES = "lib/supabase/database.types.ts";

/** Every `.from("table").select("a, b, c")` pair in the route. */
function selectSites(source: string): Array<{ table: string; columns: string[] }> {
  const sites: Array<{ table: string; columns: string[] }> = [];
  const pattern = /\.from\("([a-z_]+)"\)\s*\.select\(\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const columns = match[2]!
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean)
      // `count`, embedded resources and `*` are not plain column names.
      .filter((column) => column !== "*" && !column.includes("(") && !column.includes(":"));
    sites.push({ table: match[1]!, columns });
  }
  return sites;
}

/**
 * The Row type block for one table, as source.
 *
 * Read out of the generated types rather than a hand-kept list, so this cannot
 * drift from the schema the app actually talks to.
 */
function rowBlock(types: string, table: string): string | null {
  const anchor = types.indexOf(`      ${table}: {`);
  if (anchor === -1) return null;
  /* Row is declared as `Row: RowWithTimestamps & {` — an INTERSECTION, not a
     bare object. A first version searched for `"Row: {"`, matched nothing, and
     reported thirty existing columns as missing (including profiles.full_name).
     Anchor on `Row:` and read to the closing brace of its own block. */
  const rowStart = types.indexOf("Row:", anchor);
  if (rowStart === -1) return null;
  const open = types.indexOf("{", rowStart);
  if (open === -1) return null;
  let depth = 0;
  let index = open;
  for (; index < types.length; index += 1) {
    if (types[index] === "{") depth += 1;
    else if (types[index] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const own = types.slice(open, index + 1);
  /* Columns shared by every table live in the intersected RowWithTimestamps
     (created_at, updated_at), so they belong to the row too. */
  const shared = types.slice(types.indexOf("type RowWithTimestamps = {"), types.indexOf("};", types.indexOf("type RowWithTimestamps = {")));
  return types.slice(rowStart, open).includes("RowWithTimestamps") ? own + shared : own;
}

describe("account data export", () => {
  const route = readFileSync(ROUTE, "utf8");
  const types = readFileSync(TYPES, "utf8");
  const sites = selectSites(route);

  it("actually inspects the export route (the scanner is running)", () => {
    // If a refactor moves these queries behind a helper this drops, which is
    // fine — but it must never silently reach zero and make the test vacuous.
    expect(sites.length).toBeGreaterThan(10);
  });

  it("selects only columns that exist in the database types", () => {
    const unknown: string[] = [];

    for (const site of sites) {
      const block = rowBlock(types, site.table);
      // A table absent from the generated types is out of scope here rather
      // than a failure — it would be a different defect with a different fix.
      if (!block) continue;
      for (const column of site.columns) {
        if (!new RegExp(`\\b${column}\\??:`).test(block)) {
          unknown.push(`${site.table}.${column}`);
        }
      }
    }

    expect(
      unknown,
      "These columns are selected by the data export but do not exist. Postgres " +
        "rejects the whole query with 42703 (undefined_column), so the export " +
        "returns 500 for EVERY user. This is how profiles.onboarding_complete " +
        "shipped: the select list is a string, so TypeScript cannot catch it."
    ).toEqual([]);
  });

  it("still exports the onboarding flag under its real name", () => {
    // The specific regression: the column is `is_onboarded`, and the export
    // asked for `onboarding_complete`.
    const profiles = sites.find((site) => site.table === "profiles");
    expect(profiles?.columns).toContain("is_onboarded");
    expect(profiles?.columns).not.toContain("onboarding_complete");
  });

  it("logs the Postgres error rather than swallowing it", () => {
    // The failure was undiagnosable because the error was discarded. The log
    // line carries the error TYPE (a Postgres code), never a user's data.
    expect(route).toContain("logBackendEvent");
    expect(route).toContain("errorType(failed.error)");
  });
});
