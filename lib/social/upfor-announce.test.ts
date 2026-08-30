import { describe, expect, it, vi } from "vitest";
import { announceUpForToAudience } from "@/lib/social/upfor-announce";

type ClaimResult = { data: boolean | null; error: { message: string } | null };

/** Minimal admin double: only `rpc` is reached by this function. */
function adminWith(claim: ClaimResult) {
  return { rpc: vi.fn().mockResolvedValue(claim) } as never;
}

function args(overrides: Partial<Parameters<typeof announceUpForToAudience>[1]> = {}) {
  return {
    sessionId: "11111111-1111-4111-8111-111111111111",
    ownerId: "22222222-2222-4222-8222-222222222222",
    requireStarted: true,
    resolveRecipients: vi.fn().mockResolvedValue(["a", "b"]),
    senderName: vi.fn().mockResolvedValue("Ama"),
    note: null,
    deliver: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe("the audience is announced exactly once", () => {
  it("sends when this caller won the claim", async () => {
    const a = args();
    const result = await announceUpForToAudience(adminWith({ data: true, error: null }), a);
    expect(result).toEqual({ claimed: true, recipients: 2 });
    expect(a.deliver).toHaveBeenCalledTimes(2);
  });

  it("sends NOTHING when another actor already claimed it", async () => {
    // The exact race this exists for: creation and the polling worker both
    // wanting to announce the same session. The loser must stay silent rather
    // than notify the audience a second time.
    const a = args();
    const result = await announceUpForToAudience(adminWith({ data: false, error: null }), a);
    expect(result).toEqual({ claimed: false, recipients: 0 });
    expect(a.deliver).not.toHaveBeenCalled();
    expect(a.resolveRecipients).not.toHaveBeenCalled();
  });

  it("stays silent when the claim errors, rather than sending unclaimed", async () => {
    const a = args();
    const result = await announceUpForToAudience(
      adminWith({ data: null, error: { message: "boom" } }),
      a
    );
    expect(result.claimed).toBe(false);
    expect(a.deliver).not.toHaveBeenCalled();
  });

  it("claims BEFORE resolving or sending", async () => {
    // Claim-after-send would mean a crash mid-fan-out leaves the row unclaimed
    // and the next tick re-announces to everyone who already heard.
    const order: string[] = [];
    const admin = {
      rpc: vi.fn().mockImplementation(async () => {
        order.push("claim");
        return { data: true, error: null };
      })
    } as never;
    await announceUpForToAudience(admin, args({
      resolveRecipients: vi.fn().mockImplementation(async () => {
        order.push("resolve");
        return ["a"];
      }),
      deliver: vi.fn().mockImplementation(async () => {
        order.push("deliver");
      })
    }));
    expect(order).toEqual(["claim", "resolve", "deliver"]);
  });

  it("passes the started requirement through to the database", async () => {
    // The worker must never claim a session that has not begun; the creation
    // path for an immediate UpFor passes false so a millisecond of clock skew
    // between app server and database cannot drop the announcement.
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const admin = { rpc } as never;
    await announceUpForToAudience(admin, args({ requireStarted: true }));
    expect(rpc).toHaveBeenCalledWith("claim_upfor_announcement", {
      p_session_id: "11111111-1111-4111-8111-111111111111",
      p_require_started: true
    });
  });

  it("still counts as claimed when the audience is empty", async () => {
    // Nobody to tell is not a failure, and the claim must stand so a later
    // tick does not keep retrying a session with no eligible recipients.
    const a = args({ resolveRecipients: vi.fn().mockResolvedValue([]) });
    const result = await announceUpForToAudience(adminWith({ data: true, error: null }), a);
    expect(result).toEqual({ claimed: true, recipients: 0 });
    expect(a.deliver).not.toHaveBeenCalled();
  });

  it("re-derives recipients rather than trusting a caller-supplied list", async () => {
    // Audience membership is resolved at SEND time, so somebody who blocked the
    // owner between creation and start is excluded at the moment that matters.
    const a = args();
    await announceUpForToAudience(adminWith({ data: true, error: null }), a);
    expect(a.resolveRecipients).toHaveBeenCalledTimes(1);
  });
});
