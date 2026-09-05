import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

const stripComments = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");

const hardening = stripComments(
  readFileSync(path.join(MIGRATIONS, "20260905180000_plan_participant_browser_authority.sql"), "utf8")
);
const browserGrants = stripComments(
  readFileSync(path.join(MIGRATIONS, "20260903140000_browser_role_grant_reproducibility.sql"), "utf8")
);
const lifecycle = stripComments(
  readFileSync(path.join(MIGRATIONS, "20260814200000_canonical_plan_lifecycle.sql"), "utf8")
);
const service = readFileSync(path.join(ROOT, "lib", "plans", "service.ts"), "utf8");

describe("SEC-002 plan participant authority", () => {
  it("removes browser-role INSERT, UPDATE, and DELETE", () => {
    expect(hardening).toMatch(
      /revoke\s+insert\s*,\s*update\s*,\s*delete\s+on\s+table\s+public\.plan_participants\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i
    );
    expect(hardening).not.toMatch(
      /grant\s+(?:all|insert|update|delete)[^;]*on\s+(?:table\s+)?public\.plan_participants[^;]*to\s+(?:public|anon|authenticated)/i
    );
  });

  it("removes the obsolete own-row UPDATE policy as defense in depth", () => {
    expect(hardening).toMatch(
      /drop\s+policy\s+if\s+exists\s+"participants update own rsvp"\s+on\s+public\.plan_participants/i
    );
  });

  it("preserves service_role as the canonical table mutation authority", () => {
    expect(hardening).not.toMatch(/from\s+service_role/i);
    expect(lifecycle).toMatch(
      /grant\s+insert\s+on\s+table[\s\S]*?public\.plan_participants[\s\S]*?to\s+service_role/i
    );
    expect(lifecycle).toMatch(
      /grant\s+update\s+on\s+table[\s\S]*?public\.plan_participants[\s\S]*?to\s+service_role/i
    );
  });

  it("matches the browser-grant contract: plan_participants is not a browser-write table", () => {
    expect(browserGrants).not.toMatch(
      /grant[^;]*\b(?:insert|update|delete)\b[^;]*public\.plan_participants[^;]*to\s+authenticated/i
    );
  });

  it("keeps RSVP and participant mutations behind service-role RPCs", () => {
    expect(service).toContain('admin.rpc("set_plan_participant_rsvp"');
    expect(service).toContain('admin.rpc("add_plan_participants"');
    expect(lifecycle).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.set_plan_participant_rsvp\([\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated/i
    );
    expect(lifecycle).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.add_plan_participants\([\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated/i
    );
  });
});
