import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * One extension intent must produce exactly one extension.
 *
 * Extend is deliberately cumulative -- two separate decisions to add ten
 * minutes should add twenty. But two activations of the SAME decision were
 * also adding twenty, because nothing carried a mutation identity. Measured
 * against unmodified authority: two concurrent extend calls moved
 * expected_arrival_at by 20 minutes and wrote two `extended` events, and
 * replaying a committed call did the same.
 *
 * That is release-significant rather than cosmetic: expected_arrival_at is the
 * clock that decides when contacts are told somebody has not arrived, so a
 * duplicate extension postpones the alert.
 *
 * The repair is deliberately two-layered, and these tests hold both:
 *   - a synchronous client guard, because `isPending` only disables buttons
 *     after React renders the transition and two taps can both get in first;
 *   - a canonical claim inside the RPC, because a lock in one browser cannot
 *     stop a retried or replayed request.
 */

const ROOT = process.cwd();
const migration = readFileSync(
  path.join(ROOT, "supabase/migrations/20260904200000_safe_arrival_extend_idempotency.sql"),
  "utf8"
);
const page = readFileSync(path.join(ROOT, "components/safety/safe-arrival-page.tsx"), "utf8");
const actions = readFileSync(path.join(ROOT, "app/(app)/safe-arrival-actions.ts"), "utf8");
const authority = readFileSync(path.join(ROOT, "lib/safety/safe-arrival-authority.ts"), "utf8");

/** Strip `--` comments so prose about a rule is never read as the rule. */
const sqlOf = (text: string) =>
  text.split(/\r?\n/).map((l) => (l.indexOf("--") === -1 ? l : l.slice(0, l.indexOf("--")))).join("\n");
const sql = sqlOf(migration);

describe("canonical claim", () => {
  it("stores the mutation id on the audit event, not a side table", () => {
    // The claim and the evidence live on the same row, so they cannot drift.
    expect(sql).toMatch(/alter table public\.safe_arrival_events[\s\S]*?add column if not exists client_mutation_id uuid/i);
  });

  it("enforces uniqueness per session, event type and mutation id", () => {
    expect(sql).toMatch(/create unique index[\s\S]*?safe_arrival_events\(session_id, event_type, client_mutation_id\)/i);
  });

  it("keeps the index PARTIAL so historical and server events stay valid", () => {
    // Without `where client_mutation_id is not null`, every pre-existing NULL
    // row would collide with every other one.
    expect(sql).toMatch(/create unique index[\s\S]*?where client_mutation_id is not null/i);
  });

  it("returns the canonical clock instead of extending again on a replay", () => {
    const extend = /elsif p_action='extend' then([\s\S]*?)else raise exception 'safe_arrival_invalid_action'/.exec(sql)?.[1] ?? "";
    expect(extend).not.toBe("");
    expect(extend).toMatch(/if p_client_mutation_id is not null and exists \([\s\S]*?event_type='extended'[\s\S]*?client_mutation_id=p_client_mutation_id/i);
    // Reported as changed=false: nothing happened on THIS call.
    expect(extend).toMatch(/client_mutation_id=p_client_mutation_id[\s\S]*?return query select v\.id,v\.status,false,v\.expected_arrival_at/i);
  });

  it("claims inside the row lock the transition already holds", () => {
    // Atomicity: "has this been applied" and "apply it" must not straddle a
    // network gap, or two callers both read "no" and both write.
    const lock = sql.indexOf("for update");
    const claim = sql.indexOf("client_mutation_id=p_client_mutation_id");
    expect(lock).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(lock);
  });

  it("writes the id onto the extended event it authorises", () => {
    expect(sql).toMatch(/insert into public\.safe_arrival_events\(session_id,event_type,created_by,metadata,client_mutation_id\)/i);
  });

  it("restores the service_role grant after replacing the function", () => {
    // Recreating a function drops its grants; the server is the only caller.
    expect(sql).toMatch(/grant execute on function public\.transition_safe_arrival\(uuid, uuid, text, integer, uuid\) to service_role/i);
  });

  it("still refuses to extend a terminal journey", () => {
    const extend = /elsif p_action='extend' then([\s\S]*?)else raise exception/.exec(sql)?.[1] ?? "";
    expect(extend).toMatch(/if v\.status in \('completed','cancelled','expired'\) then/);
  });

  it("keeps the extension bounds", () => {
    expect(sql).toMatch(/p_extra_minutes not between 5 and 120/);
  });

  it("carries no location or watcher data in the identity", () => {
    const comment = /comment on column public\.safe_arrival_events\.client_mutation_id is[\s\S]*?;/i.exec(migration)?.[0] ?? "";
    expect(comment).toMatch(/no location/i);
    for (const leak of ["latitude", "longitude", "coordinate", "distance", "destination_label"]) {
      expect(sql.toLowerCase()).not.toContain(`client_mutation_id ${leak}`);
    }
  });
});

describe("the id reaches the claim", () => {
  it("the action accepts a mutation id", () => {
    expect(actions).toMatch(/export async function extendSafeArrivalAction\([\s\S]{0,300}clientMutationId\?: string/);
  });

  it("the action forwards it to the canonical transition", () => {
    expect(actions).toMatch(/transitionSafeArrival\(admin, \{[\s\S]{0,200}clientMutationId/);
  });

  it("the authority passes it to the RPC", () => {
    expect(authority).toMatch(/p_client_mutation_id: input\.clientMutationId \?\? null/);
  });

  it("a replay of a live journey reads as success, not as a closed journey", () => {
    // changed=false now means "already applied" as well as "closed". Telling
    // somebody their live journey is closed would be worse than the bug.
    expect(actions).toMatch(/if \(!result\.changed\) \{[\s\S]{0,400}Already extended/);
  });

  it("the UI mints one id per activation", () => {
    expect(page).toMatch(/onExtend=\{\(minutes\) => \{[\s\S]{0,400}crypto\.randomUUID\(\)[\s\S]{0,200}extendSafeArrivalAction\([^)]*mutationId/);
  });
});

describe("the synchronous client guard", () => {
  it("uses a ref, not isPending, to reject a duplicate activation", () => {
    expect(page).toMatch(/const inFlightRef = useRef\(false\)/);
    expect(page).toMatch(/function runAction\([\s\S]{0,200}if \(inFlightRef\.current\) return;\s*\n\s*inFlightRef\.current = true;/);
  });

  it("sets the lock before handing control to the transition", () => {
    const fn = /function runAction\([\s\S]*?\n  \}/.exec(page)?.[0] ?? "";
    expect(fn).not.toBe("");
    expect(fn.indexOf("inFlightRef.current = true")).toBeLessThan(fn.indexOf("startTransition"));
  });

  it("releases the lock even when the action throws", () => {
    // Otherwise one failure strands every later mutation on the screen.
    const fn = /function runAction\([\s\S]*?\n  \}/.exec(page)?.[0] ?? "";
    expect(fn).toMatch(/finally \{[\s\S]*?inFlightRef\.current = false;/);
  });

  it("keeps the visual pending state as well", () => {
    // The ref stops the duplicate request; isPending still explains why the
    // controls are inert.
    expect(page).toMatch(/disabled=\{isPending\}/);
  });
});
