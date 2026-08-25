import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Linkr reciprocal connect race migration", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260825120000_linkr_connect_race_lock.sql"),
    "utf8"
  );

  it("locks the canonical pair before either private action is written", () => {
    const low = migration.indexOf("v_low  := least(p_actor, p_target)");
    const high = migration.indexOf("v_high := greatest(p_actor, p_target)");
    const lock = migration.indexOf("pg_advisory_xact_lock");
    const action = migration.indexOf("insert into public.linkr_actions");

    expect(low).toBeGreaterThan(-1);
    expect(high).toBeGreaterThan(low);
    expect(lock).toBeGreaterThan(high);
    expect(action).toBeGreaterThan(lock);
  });

  it("keeps the repaired function server-only", () => {
    expect(migration).toContain(
      "revoke all on function public.linkr_record_connect(uuid, uuid, uuid) from public;"
    );
    expect(migration).toContain(
      "revoke all on function public.linkr_record_connect(uuid, uuid, uuid) from authenticated;"
    );
    expect(migration).toContain(
      "grant execute on function public.linkr_record_connect(uuid, uuid, uuid) to service_role;"
    );
  });
});
