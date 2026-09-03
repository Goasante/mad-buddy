#!/usr/bin/env node
/**
 * Browser-role ACL authority audit.
 *
 * Answers, per public table and per operation, whether `anon` / `authenticated`
 * SHOULD hold a base grant -- from migration history, not from guesswork and
 * not by mechanically mirroring pg_policies.
 *
 * Evidence precedence (deliberate, and the whole point of this script):
 *
 *   A. An explicit REVOKE in migration history WINS. Security hardening is
 *      never undone by a later inference.
 *   B. An explicit GRANT in migration history is authoritative.
 *   C. An RLS policy is REQUIRED evidence for browser access, but is not
 *      SUFFICIENT on its own -- a policy can outlive the client path, and a
 *      server-only table can carry a historical policy.
 *   D. The application must actually reach the table over a browser-role
 *      transport (user-scoped Supabase client / Bearer / Realtime), not only
 *      through the service-role admin client or a security-definer RPC.
 *
 * Output is a reviewable matrix. It proposes; a human decides what lands in the
 * migration, which is written as static, greppable SQL.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const OPS = ["SELECT", "INSERT", "UPDATE", "DELETE"];
const BROWSER_ROLES = ["anon", "authenticated"];

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

/** Strip `--` comments so prose about grants is never read as a grant. */
function sqlOf(text) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

const corpus = files.map((f) => ({ file: f, sql: sqlOf(readFileSync(path.join(MIGRATIONS, f), "utf8")) }));
const allSql = corpus.map((c) => c.sql).join("\n");

/* ---------- tables ---------- */
const tables = new Set();
for (const m of allSql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
  tables.add(m[1].toLowerCase());
}
for (const m of allSql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
  tables.delete(m[1].toLowerCase());
}

/* ---------- RLS ---------- */
const rlsEnabled = new Set();
for (const m of allSql.matchAll(/alter\s+table\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+enable\s+row\s+level\s+security/gi)) {
  rlsEnabled.add(m[1].toLowerCase());
}

/* ---------- policies ---------- */
/** table -> op -> [{name, roles, file}] */
const policies = new Map();
// Policies span many lines and contain semicolons inside expressions, so the
// body runs until the next top-level statement keyword rather than the next
// `;`. Getting this wrong silently under-counts and makes the audit useless.
const policyRe =
  /create\s+policy\s+"([^"]+)"\s+on\s+(?:public\.)?([a-z_][a-z0-9_]*)([\s\S]*?)(?=\n\s*(?:create\s+policy|create\s+table|create\s+index|create\s+unique|create\s+or\s+replace|alter\s+table|alter\s+publication|drop\s+|grant\s+|revoke\s+|comment\s+on|insert\s+into|do\s+\$\$|with\s+)|$)/gi;

for (const { file, sql } of corpus) {
  for (const m of sql.matchAll(policyRe)) {
    const [, name, table, body] = m;
    const t = table.toLowerCase();
    const forMatch = /\bfor\s+(all|select|insert|update|delete)\b/i.exec(body);
    const op = (forMatch?.[1] ?? "all").toUpperCase();
    const toMatch = /\bto\s+([a-z_,\s]+?)(?=\s+(?:using|with\s+check)\b|$)/i.exec(body);
    const roles = (toMatch?.[1] ?? "public")
      .split(",")
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean);

    if (!policies.has(t)) policies.set(t, new Map());
    const byOp = policies.get(t);
    const ops = op === "ALL" ? OPS : [op];
    for (const o of ops) {
      if (!byOp.has(o)) byOp.set(o, []);
      byOp.get(o).push({ name, roles, file, declaredFor: op });
    }
  }
}

/* ---------- explicit grants / revokes ---------- */
/** role -> table -> op -> [{file, kind}] */
const explicit = new Map();
for (const role of [...BROWSER_ROLES, "service_role"]) explicit.set(role, new Map());

const grantRe =
  /\b(grant|revoke)\s+([a-z,\s]+?)\s+on\s+(?:table\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+(?:to|from)\s+([a-z_,\s]+?)\s*;/gi;

for (const { file, sql } of corpus) {
  for (const m of sql.matchAll(grantRe)) {
    const [, kindRaw, privsRaw, table, rolesRaw] = m;
    const kind = kindRaw.toLowerCase();
    const t = table.toLowerCase();
    if (!tables.has(t)) continue;

    const privs = privsRaw.toLowerCase().includes("all")
      ? OPS
      : OPS.filter((o) => new RegExp(`\\b${o}\\b`, "i").test(privsRaw));
    if (!privs.length) continue;

    for (const role of rolesRaw.split(",").map((r) => r.trim().toLowerCase())) {
      if (!explicit.has(role)) continue;
      const byTable = explicit.get(role);
      if (!byTable.has(t)) byTable.set(t, new Map());
      const byOp = byTable.get(t);
      for (const op of privs) {
        if (!byOp.has(op)) byOp.set(op, []);
        byOp.get(op).push({ file, kind });
      }
    }
  }
}

/** Latest explicit verdict for role/table/op: "grant" | "revoke" | null. */
function explicitVerdict(role, table, op) {
  const entries = explicit.get(role)?.get(table)?.get(op);
  if (!entries?.length) return null;
  return entries[entries.length - 1].kind;
}

/* ---------- realtime publication ---------- */
const realtime = new Set();
for (const m of allSql.matchAll(
  /alter\s+publication\s+supabase_realtime\s+add\s+table\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi
)) {
  realtime.add(m[1].toLowerCase());
}
// The chats_v4 migration adds a list of tables via a format() loop.
for (const m of allSql.matchAll(/'(conversation_presence|conversation_message_pins|chat_polls|chat_poll_votes|messages)'/g)) {
  realtime.add(m[1]);
}

/* ---------- application transport ---------- */
/**
 * Does the app reach this table over a BROWSER-role transport?
 *
 * Browser transport = the user-scoped client: `createSupabaseBrowserClient`,
 * `createSupabaseServerClient` (cookie session, runs as `authenticated`), the
 * Bearer client from resolveApiUser, or a Realtime subscription.
 *
 * NOT browser transport = the service-role admin client, which bypasses RLS
 * and needs no browser grant.
 */
function scanAppUsage() {
  const dirs = ["app", "lib", "components"].map((d) => path.join(ROOT, d)).filter(existsSync);
  const usage = new Map(); // table -> { browser:Set<op>, adminOnly:boolean, files:Set }

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;

      const src = readFileSync(full, "utf8");
      // Which client(s) does this file construct?
      const hasAdmin = /createSupabaseServiceRoleClient|createAdminClient|SUPABASE_SERVICE_ROLE_KEY|\badmin\b\s*=\s*create/i.test(src);
      const hasBrowser =
        /createSupabaseBrowserClient|createSupabaseServerClient|resolveApiUser|auth\.supabase|supabase\.channel/i.test(src);

      for (const m of src.matchAll(/\b(\w+)\s*\.\s*from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)([\s\S]{0,120})/g)) {
        const [, receiver, table, tail] = m;
        if (!tables.has(table)) continue;
        if (!usage.has(table)) usage.set(table, { browser: new Set(), admin: false, files: new Set() });
        const rec = usage.get(table);
        rec.files.add(path.relative(ROOT, full).replace(/\\/g, "/"));

        const viaAdmin = /admin|service/i.test(receiver);
        if (viaAdmin || (hasAdmin && !hasBrowser)) {
          rec.admin = true;
          continue;
        }
        if (!hasBrowser && !hasAdmin) continue;

        if (/\.insert\(/.test(tail)) rec.browser.add("INSERT");
        else if (/\.update\(/.test(tail)) rec.browser.add("UPDATE");
        else if (/\.delete\(/.test(tail)) rec.browser.add("DELETE");
        else if (/\.upsert\(/.test(tail)) { rec.browser.add("INSERT"); rec.browser.add("UPDATE"); }
        else rec.browser.add("SELECT");
      }
    }
  };

  for (const d of dirs) walk(d);
  return usage;
}

const appUsage = scanAppUsage();

/* ---------- decide ---------- */
const rows = [];
for (const table of [...tables].sort()) {
  const byOp = policies.get(table);
  const usage = appUsage.get(table);

  for (const role of BROWSER_ROLES) {
    for (const op of OPS) {
      const verdict = explicitVerdict(role, table, op);
      const policyList = (byOp?.get(op) ?? []).filter(
        (p) => p.roles.includes(role) || p.roles.includes("public")
      );
      const hasPolicy = policyList.length > 0;
      const appBrowser = usage?.browser.has(op) ?? false;
      const isRealtimeRead = op === "SELECT" && realtime.has(table);

      let decision = "no";
      let rationale;

      if (verdict === "revoke") {
        decision = "no";
        rationale = "explicit REVOKE in migration history (security hardening -- preserved)";
      } else if (verdict === "grant") {
        decision = "already";
        rationale = "explicit GRANT already in migration history";
      } else if (!hasPolicy) {
        decision = "no";
        rationale = rlsEnabled.has(table)
          ? "no RLS policy for this role/op"
          : "no policy; table not RLS-guarded for this role";
      } else if (!rlsEnabled.has(table)) {
        decision = "stop";
        rationale = "policy exists but RLS not enabled -- needs human review";
      } else if (role === "anon") {
        // Deliberately conservative: a generic auth.uid() policy applies to
        // PUBLIC but was almost certainly written for signed-in callers.
        const explicitlyAnon = policyList.some((p) => p.roles.includes("anon"));
        decision = explicitlyAnon && (appBrowser || isRealtimeRead) ? "grant" : "no";
        rationale = explicitlyAnon
          ? decision === "grant"
            ? "policy names anon AND a signed-out app path uses it"
            : "policy names anon but no signed-out app path found"
          : "policy does not name anon (generic policy is not anon evidence)";
      } else if (appBrowser || isRealtimeRead) {
        decision = "grant";
        rationale = isRealtimeRead && !appBrowser
          ? `RLS ${op} policy + published to supabase_realtime (subscribers need base SELECT)`
          : `RLS ${op} policy + app reaches table over a browser-role transport`;
      } else {
        decision = "no";
        rationale = "policy exists but no browser-role app path found (server-only)";
      }

      rows.push({ table, role, op, decision, rationale, hasPolicy, rls: rlsEnabled.has(table), realtime: realtime.has(table) });
    }
  }
}

/* ---------- report ---------- */
const proposed = rows.filter((r) => r.decision === "grant");
// (rows already granted in history are intentionally not reported separately)
const stop = rows.filter((r) => r.decision === "stop");
const revoked = rows.filter((r) => /REVOKE/.test(r.rationale));

console.log("BROWSER-ROLE ACL AUDIT");
console.log("=".repeat(74));
console.log(`public tables               ${tables.size}`);
console.log(`RLS-enabled tables          ${rlsEnabled.size}`);
console.log(`policy declarations         ${[...policies.values()].reduce((n, m) => n + [...m.values()].reduce((k, a) => k + a.length, 0), 0)}`);
console.log(`realtime-published tables   ${realtime.size}`);
console.log(`explicit browser REVOKEs    ${revoked.length}`);
console.log("");

for (const role of BROWSER_ROLES) {
  console.log(`${role.toUpperCase()} -- proposed base grants`);
  const mine = proposed.filter((r) => r.role === role);
  if (!mine.length) console.log("  (none)");
  const byTable = new Map();
  for (const r of mine) {
    if (!byTable.has(r.table)) byTable.set(r.table, []);
    byTable.get(r.table).push(r.op);
  }
  for (const [t, ops] of [...byTable].sort()) {
    console.log(`  ${t.padEnd(38)} ${ops.join(", ")}`);
  }
  console.log(`  tables: ${byTable.size}, statements: ${mine.length}`);
  console.log("");
}

if (stop.length) {
  console.log("NEEDS HUMAN REVIEW (policy without RLS enabled)");
  for (const r of stop.slice(0, 20)) console.log(`  ${r.table} ${r.role} ${r.op}: ${r.rationale}`);
  console.log("");
}

console.log("PRESERVED EXPLICIT REVOKES (must never be undone)");
const revTables = [...new Set(revoked.map((r) => `${r.table} ${r.role} ${r.op}`))];
for (const r of revTables.slice(0, 40)) console.log(`  ${r}`);
console.log(`  total: ${revTables.length}`);
console.log("");

if (process.argv.includes("--sql")) {
  console.log("-- Proposed static grants (review before committing)");
  for (const role of BROWSER_ROLES) {
    const byTable = new Map();
    for (const r of proposed.filter((x) => x.role === role)) {
      if (!byTable.has(r.table)) byTable.set(r.table, []);
      byTable.get(r.table).push(r.op.toLowerCase());
    }
    for (const [t, ops] of [...byTable].sort()) {
      console.log(`grant ${ops.join(", ")} on public.${t} to ${role};`);
    }
  }
}
