import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const service = readFileSync(join(process.cwd(), "lib/plans/service.ts"), "utf8");
const plans = readFileSync(join(process.cwd(), "lib/social/plans.ts"), "utf8");

/**
 * Converting an UpFor must preserve the real window the UpFor already owns.
 *
 * This covers BOTH cases:
 *  - scheduled: the Plan keeps the future start chosen for the UpFor;
 *  - already running: the Plan keeps today's start/end instead of becoming
 *    undated just because starts_at is a few minutes or hours in the past.
 */
describe("UpFor to Plan preserves the source timing window", () => {
  it("passes the session's own start and end without replacing them with null", () => {
    expect(service).toContain("p_start_at: session.starts_at");
    expect(service).toContain("p_end_at: session.ends_at");
    expect(service).not.toContain("Date.parse(session.starts_at) > Date.now() ? session.starts_at : null");
    expect(service).not.toContain("Date.parse(session.starts_at) > Date.now() ? session.ends_at : null");
  });

  it("reads timing SERVER-SIDE from the UpFor row", () => {
    // Never from the caller: a client must not be able to post a start of its
    // choosing through the conversion path.
    expect(service).toContain('.select("activity_type, message, starts_at, ends_at, timezone, status")');
  });

  it("carries the session's timezone rather than assuming UTC", () => {
    expect(service).toContain('p_timezone: session.timezone || "UTC"');
  });

  it("lets a converted running UpFor remain an active Plan until its real end", () => {
    // The canonical phase helper already knows the correct lifecycle for
    // start <= now < end. Preserving both timestamps lets that existing rule
    // do its job instead of routing the Plan through the undated path.
    expect(plans).toContain('if (nowMs >= endMs) return "past"');
    expect(plans).toContain('if (nowMs >= startMs) return "active"');
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
