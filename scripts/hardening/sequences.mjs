/**
 * Mission 1 Extremely Advanced — state-transition sequences.
 *
 * Advanced tested controls one at a time. This tests SEQUENCES, because the
 * defects that survive a per-control audit live in the transitions: a list that
 * does not refresh after a mutation, a second record created by a repeat, a
 * button that still offers an action the server will now refuse.
 *
 * Every assertion is made against a REAL browser and a REAL database. Where a
 * sequence must prove "no duplicate was created", it counts rows directly in
 * Postgres rather than trusting the UI, because a duplicate that the list
 * happens not to render is still a duplicate.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = process.env.MB_AUTH || "C:/mb-god/.hardening/auth-prod.json";
const SHOTS = "C:/mb-god/.hardening/sequences";
mkdirSync(SHOTS, { recursive: true });

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
export const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false }
});

/** Row count for a table, optionally filtered. Ground truth, not UI. */
export async function countRows(table, filters = {}) {
  let query = admin.from(table).select("id", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { count, error } = await query;
  if (error) return { error: error.message };
  return { count: count ?? 0 };
}

export async function openPage(options = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    ...(options.anonymous ? {} : { storageState: AUTH })
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Documented local/known artifacts; see scripts/hardening/README.md.
    if (/Content Security Policy|CHANNEL_ERROR|realtime|orb-off|profile\/avatar/i.test(t)) return;
    errors.push(t.slice(0, 200));
  });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 200)));
  return { browser, page, errors, go: (r) => page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded", timeout: 60000 }) };
}

/** Clicks a control by visible text, tolerating absence. Returns whether it fired. */
export async function tap(page, text, { role = null, timeout = 8000 } = {}) {
  const byRole = role ? page.getByRole(role, { name: text, exact: false }).first() : null;
  const target = byRole && (await byRole.count()) ? byRole : page.getByText(text, { exact: false }).first();
  if (!(await target.count())) return false;
  try {
    await target.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

export function result(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  return ok;
}
