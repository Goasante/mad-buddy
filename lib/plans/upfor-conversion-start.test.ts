import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const service = readFileSync(join(process.cwd(), "lib/plans/service.ts"), "utf8");

/**
 * Converting a scheduled UpFor must keep the start it was created for.
 *
 * The runtime behaviour is proven against the database (an UpFor scheduled for
 * 15:29, converted at 12:59, produced a Plan starting 15:29). These assertions
 * pin the reasons, so the payload cannot quietly go back to null.
 */
describe("UpFor to Plan preserves the intended start", () => {
  it("passes the session's own start, not the conversion moment", () => {
    // `p_start_at: null` was the previous behaviour: an 18:30 UpFor converted
    // at 16:00 produced a Plan with no date at all.
    expect(service).toContain("p_start_at: Date.parse(session.starts_at) > Date.now() ? session.starts_at : null");
  });

  it("reads the start SERVER-SIDE from the session row", () => {
    // Never from the caller: a client must not be able to post a start of its
    // choosing through the conversion path.
    expect(service).toContain('.select("activity_type, message, starts_at, ends_at, timezone, status")');
  });

  it("carries the session's timezone rather than assuming UTC", () => {
    expect(service).toContain('p_timezone: session.timezone || "UTC"');
  });

  it("leaves an already-running UpFor with the previous semantics", () => {
    // Its start is in the past; a Plan dated in the past is worse than one
    // with no date, so that case still passes null.
    expect(service).toContain("Date.parse(session.starts_at) > Date.now() ? session.ends_at : null");
  });

  it("still uses the canonical lifecycle, with no second conversion path", () => {
    expect(service).toContain('admin.rpc("create_plan_lifecycle"');
    expect(service).toContain("p_source_hangout_id: hangoutId");
    // The source UpFor's id is the retry key, which is what makes a replayed
    // conversion return the same Plan instead of creating another.
    expect(service).toContain("p_request_key: hangoutId");
  });

  it("still derives participants server-side, accepting no caller list", () => {
    expect(service).toContain("p_invitee_ids: []");
    expect(service).toContain("p_initial_going_ids: []");
  });
});
